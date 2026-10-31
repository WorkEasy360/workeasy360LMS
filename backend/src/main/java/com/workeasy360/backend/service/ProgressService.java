package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.ProgressStatus;
import com.workeasy360.backend.dto.LearningDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/** Lesson progress + the completion loop (progress → unlock next → course completion → certificate). */
@Service
@Transactional
public class ProgressService {
    private final LessonProgressRepo progress;
    private final EnrollmentRepo enrollments;
    private final LessonRepo lessons;
    private final CourseService courseService;
    private final CertificateService certificates;

    private final SkillService skillService;
    private final NotificationService notifications;
    private final AccessService access;
    public ProgressService(LessonProgressRepo progress, EnrollmentRepo enrollments, LessonRepo lessons, SkillService skillService,
                            CourseService courseService, CertificateService certificates, NotificationService notifications, AccessService access) {
        this.access = access;
        this.progress = progress; this.enrollments = enrollments; this.lessons = lessons;
        this.courseService = courseService; this.certificates = certificates; this.skillService = skillService; this.notifications = notifications;
    }

    public List<LessonProgressDto> forCourse(String userId, String courseId) {
        return progress.findByUserIdAndCourseId(userId, courseId).stream().map(LessonProgressDto::of).toList();
    }

    private LessonProgress row(String userId, String lessonId, String courseId) {
        return progress.findByUserIdAndLessonId(userId, lessonId).orElseGet(() -> LessonProgress.builder()
                .userId(userId).lessonId(lessonId).courseId(courseId).status(ProgressStatus.NOT_STARTED)
                .percentage(0).lastPosition(0d).watchPercentage(0d).videoCompleted(false).build());
    }

    public CompletionResult update(com.workeasy360.backend.security.CurrentUser user, String lessonId, ProgressUpdateRequest req) {
        String userId = user.getId();
        Lesson lesson = lessons.findById(lessonId).orElseThrow(() -> ApiException.notFound("Lesson"));
        String courseId = courseService.getModule(lesson.getModuleId()).getCourseId();
        access.requireContentAccess(user, courseId); // paid courses need an entitlement; a free course enrols on first progress
        Enrollment enrollment = enrollments.findByUserIdAndCourseId(userId, courseId)
                .orElseGet(() -> enrollments.save(Enrollment.builder().userId(userId).courseId(courseId)
                        .status(Enums.EnrollmentStatus.IN_PROGRESS).enrolledAt(Instant.now()).startedAt(Instant.now())
                        .bookmarksJson("[]").build()));

        LessonProgress p = row(userId, lessonId, courseId);
        boolean wasCompleted = p.getStatus() == ProgressStatus.COMPLETED;
        var beforeSummary = courseSummary(userId, courseId);

        if (req.lastPosition() != null) p.setLastPosition(req.lastPosition());
        if (req.watchPercentage() != null) p.setWatchPercentage(req.watchPercentage());
        if (req.videoCompleted() != null && req.videoCompleted()) p.setVideoCompleted(true);
        if (req.percentage() != null) p.setPercentage(req.percentage());
        if (req.note() != null) p.setNote(req.note());
        boolean shouldComplete = Boolean.TRUE.equals(req.complete()) || "COMPLETED".equalsIgnoreCase(req.status());
        if (shouldComplete && !wasCompleted) { p.setStatus(ProgressStatus.COMPLETED); p.setCompletedAt(Instant.now()); p.setPercentage(100); }
        else if (p.getStatus() != ProgressStatus.COMPLETED) p.setStatus(ProgressStatus.IN_PROGRESS);
        progress.save(p);

        enrollment.setLastActiveAt(Instant.now());
        enrollment.setLastLessonId(lessonId);
        if (enrollment.getStartedAt() == null) enrollment.setStartedAt(Instant.now());
        if (enrollment.getStatus() == Enums.EnrollmentStatus.NOT_STARTED) enrollment.setStatus(Enums.EnrollmentStatus.IN_PROGRESS);

        boolean nowCompleted = !wasCompleted && p.getStatus() == ProgressStatus.COMPLETED;
        String nextLessonId = null;
        String certId = null;
        boolean courseCompleted = false;

        if (nowCompleted) {
            List<Lesson> ordered = courseService.orderedLessons(courseId);
            int idx = -1;
            for (int i = 0; i < ordered.size(); i++) if (ordered.get(i).getId().equals(lessonId)) { idx = i; break; }
            if (idx >= 0 && idx + 1 < ordered.size()) nextLessonId = ordered.get(idx + 1).getId();

            long completedCount = ordered.stream().filter(l -> progress.findByUserIdAndLessonId(userId, l.getId())
                    .map(x -> x.getStatus() == ProgressStatus.COMPLETED).orElse(false)).count();
            if (!ordered.isEmpty() && completedCount == ordered.size() && enrollment.getCompletedAt() == null) {
                enrollment.setCompletedAt(Instant.now());
                enrollment.setStatus(Enums.EnrollmentStatus.COMPLETED);
                courseCompleted = true;
                certId = certificates.issueIfAbsent(userId, courseId).getCertificateNumber();
                notifications.notify(userId, "achievement", "You completed " + courseService.get(courseId).getTitle(), "Your certificate " + certId + " is ready to view and share.", "/certificates");
            }
        }
        enrollments.save(enrollment);
        if (nowCompleted) skillService.scheduleRecalculate(userId); // lesson/course completion → skill evidence (after commit)

        var afterSummary = courseSummary(userId, courseId);
        return new CompletionResult(wasCompleted, beforeSummary, afterSummary, courseCompleted, nextLessonId, certId);
    }

    private int courseSummary(String userId, String courseId) {
        List<Lesson> ordered = courseService.orderedLessons(courseId);
        if (ordered.isEmpty()) return 0;
        long done = ordered.stream().filter(l -> progress.findByUserIdAndLessonId(userId, l.getId())
                .map(p -> p.getStatus() == ProgressStatus.COMPLETED).orElse(false)).count();
        return (int) Math.round((done * 100.0) / ordered.size());
    }

    public Optional<LessonProgress> get(String userId, String lessonId) { return progress.findByUserIdAndLessonId(userId, lessonId); }
}
