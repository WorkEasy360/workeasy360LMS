package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Enums.SubmissionStatus;
import com.workeasy360.backend.domain.Submission;
import com.workeasy360.backend.repo.Repos.SubmissionRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class SubmissionService {
    private final SubmissionRepo submissions;
    private final CourseService courseService;
    private final PermissionService perm;

    private final SkillService skillService;
    private final NotificationService notifications;
    private final AccessService access;
    public SubmissionService(SubmissionRepo submissions, CourseService courseService, PermissionService perm, SkillService skillService, NotificationService notifications, AccessService access) {
        this.submissions = submissions; this.courseService = courseService; this.perm = perm; this.skillService = skillService; this.notifications = notifications; this.access = access;
    }

    public Submission submit(CurrentUser user, String lessonId, String body) {
        String userId = user.getId();
        String courseId = courseService.courseIdOfLesson(lessonId);
        access.requireContentAccess(user, courseId);
        Submission s = submissions.findByUserIdAndLessonId(userId, lessonId).orElseGet(() ->
                Submission.builder().userId(userId).lessonId(lessonId).courseId(courseId).build());
        s.setBody(body);
        s.setStatus(SubmissionStatus.SUBMITTED);
        s.setSubmittedAt(Instant.now());
        s.setFeedback(null);
        s.setReviewedAt(null);
        Submission saved = submissions.save(s);
        skillService.recordAssessment(userId, lessonId, "ASSIGNMENT", null, false); // submitted → partial evidence
        return saved;
    }

    public Optional<Submission> mine(String userId, String lessonId) { return submissions.findByUserIdAndLessonId(userId, lessonId); }

    public List<Submission> pendingForCourse(CurrentUser user, String courseId) {
        if (!perm.canEditCourse(user, courseService.get(courseId))) throw ApiException.forbidden("Not allowed to view submissions for this course");
        return submissions.findByCourseIdAndStatus(courseId, SubmissionStatus.SUBMITTED);
    }

    public Submission review(CurrentUser user, String id, String feedback) {
        Submission s = submissions.findById(id).orElseThrow(() -> ApiException.notFound("Submission"));
        if (!perm.canEditCourse(user, courseService.get(s.getCourseId()))) throw ApiException.forbidden("Not allowed to review this submission");
        s.setStatus(SubmissionStatus.REVIEWED);
        s.setFeedback(feedback);
        s.setReviewedAt(Instant.now());
        s.setReviewedBy(user.getId());
        Submission saved = submissions.save(s);
        skillService.recordAssessment(s.getUserId(), s.getLessonId(), "ASSIGNMENT", null, true); // reviewed → full evidence
        if (notifications.ruleEnabled("reviewNotifications"))
            notifications.notify(s.getUserId(), "review", "Your assignment was reviewed", feedback == null || feedback.isBlank() ? "Open the lesson to see the outcome." : feedback,
                    "/learn/" + s.getCourseId() + "/" + s.getLessonId(), java.time.Duration.ofMinutes(1));
        return saved;
    }
}
