package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Video;
import com.workeasy360.backend.dto.VideoDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.VideoService;
import com.workeasy360.backend.storage.VideoStorageService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.ResourceRegion;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRange;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.util.List;

@RestController
@RequestMapping("/api/videos")
public class VideoController {
    private final VideoService service;
    private final VideoStorageService storage;

    public VideoController(VideoService service, VideoStorageService storage) { this.service = service; this.storage = storage; }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public VideoDto upload(@AuthenticationPrincipal CurrentUser user,
                            @RequestParam MultipartFile file,
                            @RequestParam(required = false) String courseId,
                            @RequestParam(required = false) String title,
                            @RequestParam(required = false) Double duration,
                            @RequestParam(required = false) Integer width,
                            @RequestParam(required = false) Integer height,
                            @RequestParam(required = false) String thumbnailBase64) {
        Video v = service.upload(user, courseId, file, title, duration, width, height, thumbnailBase64);
        return VideoDto.of(v);
    }

    @PostMapping("/external")
    public VideoDto addExternal(@AuthenticationPrincipal CurrentUser user, @RequestParam String courseId, @RequestBody ExternalVideoRequest req) {
        return VideoDto.of(service.addExternal(user, courseId, req.sourceType(), req.sourceUrl(), req.title()));
    }

    @GetMapping("/{id}")
    public VideoDto get(@PathVariable String id) { return VideoDto.of(service.get(id)); }

    @PutMapping("/{id}")
    public VideoDto update(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody UpdateVideoRequest req) {
        return VideoDto.of(service.updateMeta(user, id, req.title(), req.description(), req.visibility()));
    }

    @DeleteMapping("/{id}")
    public void delete(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.delete(user, id); }

    /** Streams the raw bytes with HTTP Range support (seek/scrub), after a real server-side access check —
     *  never a bare, unauthenticated file URL. Auth via Authorization header OR ?access_token=<jwt> (needed
     *  because a plain <video src> can't set headers) — JwtAuthFilter accepts both. */
    @GetMapping("/{id}/stream")
    public ResponseEntity<ResourceRegion> stream(@AuthenticationPrincipal CurrentUser user, @PathVariable String id,
                                                  @RequestHeader HttpHeaders headers) throws IOException {
        if (user == null) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        Video v = service.get(id);
        if (!service.canAccess(user, v)) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        if (v.getStorageKey() == null || !storage.exists(v.getStorageKey())) return ResponseEntity.notFound().build();

        FileSystemResource resource = new FileSystemResource(storage.resolve(v.getStorageKey()));
        long contentLength = resource.contentLength();
        MediaType mediaType = v.getMimeType() != null ? MediaType.parseMediaType(v.getMimeType()) : MediaType.valueOf("video/mp4");

        List<HttpRange> ranges = headers.getRange();
        ResourceRegion region = ranges.isEmpty()
                ? new ResourceRegion(resource, 0, contentLength)
                : HttpRange.toResourceRegions(ranges, resource).get(0);

        return ResponseEntity.status(ranges.isEmpty() ? HttpStatus.OK : HttpStatus.PARTIAL_CONTENT)
                .contentType(mediaType)
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
                .body(region);
    }

    @GetMapping("/{id}/thumbnail")
    public ResponseEntity<byte[]> thumbnail(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) throws IOException {
        Video v = service.get(id);
        if (v.getThumbnailKey() == null || !storage.exists(v.getThumbnailKey())) return ResponseEntity.notFound().build();
        byte[] bytes = Files.readAllBytes(storage.resolve(v.getThumbnailKey()));
        return ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).header(HttpHeaders.CACHE_CONTROL, "private, max-age=86400").body(bytes);
    }
}
