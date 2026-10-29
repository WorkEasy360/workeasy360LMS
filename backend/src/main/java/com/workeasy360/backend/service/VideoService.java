package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.repo.SettingsRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.storage.VideoStorageService;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class VideoService {
    private static final List<String> ALLOWED_EXT = List.of(".mp4", ".webm", ".mov");
    private static final List<String> ALLOWED_MIME = List.of("video/mp4", "video/webm", "video/quicktime");

    private final VideoRepo videos;
    private final CourseRepo courses;
    private final EnrollmentRepo enrollments;
    private final SettingsRepo settingsRepo;
    private final VideoStorageService storage;
    private final PermissionService perm;

    private final AccessService access;
    public VideoService(VideoRepo videos, CourseRepo courses, EnrollmentRepo enrollments, SettingsRepo settingsRepo,
                         VideoStorageService storage, PermissionService perm, AccessService access) {
        this.access = access;
        this.videos = videos; this.courses = courses; this.enrollments = enrollments;
        this.settingsRepo = settingsRepo; this.storage = storage; this.perm = perm;
    }

    public Video get(String id) { return videos.findById(id).orElseThrow(() -> ApiException.notFound("Video")); }

    private void requireCourseEdit(CurrentUser user, String courseId) {
        if (courseId == null) return;
        Course c = courses.findById(courseId).orElseThrow(() -> ApiException.notFound("Course"));
        if (!perm.canEditCourse(user, c)) throw ApiException.forbidden("You can only add videos to your own courses");
    }

    public Video upload(CurrentUser user, String courseId, MultipartFile file, String title, Double duration,
                        Integer width, Integer height, String thumbnailBase64) {
        requireCourseEdit(user, courseId);
        if (file == null || file.isEmpty()) throw ApiException.badRequest("No file was uploaded");
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        boolean extOk = ALLOWED_EXT.stream().anyMatch(name::endsWith);
        boolean mimeOk = ALLOWED_MIME.contains(file.getContentType());
        if (!extOk && !mimeOk) throw ApiException.badRequest("That file type isn't supported. Use MP4, WebM or MOV.");
        long maxBytes = (long) settingsRepo.findById("singleton").map(Settings::getMaxVideoMb).orElse(200) * 1024 * 1024;
        if (file.getSize() > maxBytes) throw ApiException.badRequest("That file is too large. The maximum is " + (maxBytes / 1024 / 1024) + " MB.");
        if (file.getSize() == 0) throw ApiException.badRequest("That file is empty.");

        byte[] thumbBytes = null;
        if (thumbnailBase64 != null && !thumbnailBase64.isBlank()) {
            String b64 = thumbnailBase64.contains(",") ? thumbnailBase64.substring(thumbnailBase64.indexOf(',') + 1) : thumbnailBase64;
            try { thumbBytes = Base64.getDecoder().decode(b64); }
            catch (IllegalArgumentException e) { throw ApiException.badRequest("The thumbnail could not be read."); }
            if (thumbBytes.length > 2 * 1024 * 1024) throw ApiException.badRequest("The thumbnail is too large (2 MB max)."); // the video has its own limit; its thumbnail must not smuggle more
        }
        try {
            String key = storage.store(file.getInputStream(), "videos", file.getOriginalFilename());
            String thumbKey = thumbBytes == null ? null : storage.store(new ByteArrayInputStream(thumbBytes), "thumbs", "thumb.jpg");
            Video v = Video.builder()
                    .ownerId(user.getId()).courseId(courseId).sourceType(VideoSourceType.NATIVE)
                    .storageKey(key).originalFileName(file.getOriginalFilename()).mimeType(file.getContentType())
                    .fileSize(file.getSize()).thumbnailKey(thumbKey).durationSeconds(duration == null ? 0 : duration)
                    .width(width).height(height).status(VideoStatus.READY)
                    .title(title == null || title.isBlank() ? cleanTitle(file.getOriginalFilename()) : title)
                    .description("").visibility(VideoVisibility.COURSE).captionsJson("[]")
                    .build();
            return videos.save(v);
        } catch (Exception e) {
            throw new ApiException(org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR, "Video upload failed. Please try again.");
        }
    }

    public Video addExternal(CurrentUser user, String courseId, String sourceType, String sourceUrl, String title) {
        requireCourseEdit(user, courseId);
        // The URL ends up as an <iframe>/<video> src in every learner's browser: only absolute http(s) links
        // (never javascript: or data:), and inside the column's length.
        if (sourceUrl == null || sourceUrl.length() > 900 || !sourceUrl.matches("(?i)^https?://\\S+$"))
            throw ApiException.badRequest("Enter a full video link starting with http:// or https://.");
        VideoSourceType type;
        try { type = VideoSourceType.valueOf(String.valueOf(sourceType).toUpperCase()); }
        catch (RuntimeException e) { throw ApiException.badRequest("Unknown video source type."); }
        Video v = Video.builder().ownerId(user.getId()).courseId(courseId)
                .sourceType(type).sourceUrl(sourceUrl)
                .status(VideoStatus.READY).title(title == null ? "" : title.length() > 300 ? title.substring(0, 300) : title).description("")
                .visibility(VideoVisibility.COURSE).captionsJson("[]").build();
        return videos.save(v);
    }

    public Video updateMeta(CurrentUser user, String id, String title, String description, String visibility) {
        Video v = get(id);
        requireCourseEdit(user, v.getCourseId());
        if (title != null) v.setTitle(title.length() > 300 ? title.substring(0, 300) : title);
        if (description != null) v.setDescription(description);
        if (visibility != null) {
            try { v.setVisibility(VideoVisibility.valueOf(visibility.toUpperCase())); }
            catch (RuntimeException e) { throw ApiException.badRequest("Unknown visibility."); }
        }
        return videos.save(v);
    }

    public void delete(CurrentUser user, String id) {
        Video v = get(id);
        requireCourseEdit(user, v.getCourseId());
        storage.delete(v.getStorageKey());
        storage.delete(v.getThumbnailKey());
        videos.delete(v);
    }

    /** Mirrors the frontend's videoAccess(): admin, the course's instructor, or a learner enrolled in a published course. */
    public boolean canAccess(CurrentUser user, Video v) {
        if (v.getCourseId() == null) return true;
        Course c = courses.findById(v.getCourseId()).orElse(null);
        if (c == null) return false;
        return access.canAccessContent(user, c); // editors, entitled learners, or anyone on a free published course
    }

    private String cleanTitle(String fileName) {
        if (fileName == null) return "";
        String base = fileName.contains(".") ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
        return base.replaceAll("[-_]+", " ").trim();
    }
}
