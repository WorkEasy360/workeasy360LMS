package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.EnrollmentStatus;
import com.workeasy360.backend.dto.LearningDtos.CourseProgressDto;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class EnrollmentService {
    private final EnrollmentRepo enrollments;
    private final LessonProgressRepo progress;
    private final CourseService courseService;
    private final PermissionService perm;
    private final NotificationService notifications;
    private final UserRepo users;

    public EnrollmentService(EnrollmentRepo enrollments, LessonProgressRepo progress, CourseService courseService, PermissionService perm, NotificationService notifications, UserRepo users) {
        this.enrollments = enrollments; this.progress = progress; this.courseService = courseService; this.perm = perm; this.notifications = notifications; this.users = users;
    }

    /** Instructor/admin assigns a learner to a course (idempotent; an existing enrolment keeps its progress, due date is updated when given). */
    public Enrollment assign(CurrentUser actor, Course course, String userId, Long dueAt) {
        if (!perm.canManageEnrollments(actor, course)) throw ApiException.forbidden("Not allowed to manage enrollments for this course");
        if (users.findById(userId).isEmpty()) throw ApiException.notFound("User");
        boolean existed = enrollments.findByUserIdAndCourseId(userId, course.getId()).isPresent();
        Enrollment e = enroll(userId, course.getId(), dueAt, "ASSIGNED", null);
        if (existed && dueAt != null) { e.setDueAt(Instant.ofEpochMilli(dueAt)); e = enrollments.save(e); }
        if (!existed && !userId.equals(actor.getId()) && notifications.ruleEnabled("enrolmentNotifications"))
            notifications.notify(userId, "enrolment", "You've been enrolled in " + course.getTitle(),
                    e.getDueAt() == null ? "Start whenever you're ready." : "Due " + e.getDueAt().toString().substring(0, 10) + ".", "/learn/" + course.getId());
        return e;
    }

    public Enrollment get(String userId, String courseId) { return enrollments.findByUserIdAndCourseId(userId, courseId).orElse(null); }

    /** Self-enrolment (the caller). Free published courses only: a paid course needs a purchase (402) or an assignment. */
    public Enrollment selfEnroll(CurrentUser user, String courseId, Long dueAt) {
        Course c = courseService.get(courseId);
        Optional<Enrollment> existing = enrollments.findByUserIdAndCourseId(user.getId(), courseId);
        if (existing.isPresent()) return existing.get();
        if (!perm.canEditCourse(user, c)) {
            if (c.getStatus() != com.workeasy360.backend.domain.Enums.CourseStatus.PUBLISHED) throw ApiException.forbidden("This course is not available to you");
            if (!AccessService.isFree(c)) throw new com.workeasy360.backend.web.ApiException(org.springframework.http.HttpStatus.PAYMENT_REQUIRED, "This course must be purchased first.");
        }
        return enroll(user.getId(), courseId, dueAt, "FREE", null);
    }

    public Enrollment enroll(String userId, String courseId, Long dueAt) { return enroll(userId, courseId, dueAt, "FREE", null); }
    public Enrollment enroll(String userId, String courseId, Long dueAt, String source, String orderId) {
        return enrollments.findByUserIdAndCourseId(userId, courseId).orElseGet(() -> {
            Enrollment e = Enrollment.builder().userId(userId).courseId(courseId).status(EnrollmentStatus.NOT_STARTED)
                    .enrolledAt(Instant.now()).dueAt(dueAt == null ? null : Instant.ofEpochMilli(dueAt))
                    .bookmarksJson("[]").source(source).orderId(orderId).build();
            return enrollments.save(e);
        });
    }

    public List<Enrollment> mine(String userId) { return enrollments.findByUserId(userId); }

    public List<Enrollment> forCourse(CurrentUser user, Course course) {
        if (!perm.canManageEnrollments(user, course)) throw ApiException.forbidden("Not allowed to view enrollments for this course");
        return enrollments.findByCourseId(course.getId());
    }

    public void remove(CurrentUser user, Course course, String userId) {
        if (!perm.canManageEnrollments(user, course)) throw ApiException.forbidden("Not allowed to manage enrollments for this course");
        enrollments.findByUserIdAndCourseId(userId, course.getId()).ifPresent(enrollments::delete);
    }

    public CourseProgressDto progress(String userId, String courseId) {
        var lessons = courseService.orderedLessons(courseId);
        int total = lessons.size();
        long done = lessons.stream().filter(l -> progress.findByUserIdAndLessonId(userId, l.getId())
                .map(p -> p.getStatus() == com.workeasy360.backend.domain.Enums.ProgressStatus.COMPLETED).orElse(false)).count();
        int pct = total == 0 ? 0 : (int) Math.round((done * 100.0) / total);
        Optional<Enrollment> e = enrollments.findByUserIdAndCourseId(userId, courseId);
        String status = e.isEmpty() ? "NOT_STARTED" : pct >= 100 ? "COMPLETED" : done > 0 ? "IN_PROGRESS" : "NOT_STARTED";
        return new CourseProgressDto((int) done, total, pct, status);
    }
}
