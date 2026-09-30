package com.workeasy360.backend.dto;

import com.workeasy360.backend.domain.Enrollment;
import com.workeasy360.backend.domain.LessonProgress;

import java.time.Instant;

public class LearningDtos {
    public record EnrollRequest(Long dueAt) {}

    public record EnrollmentDto(
            String id, String userId, String courseId, String status, Instant enrolledAt, Instant startedAt,
            Instant completedAt, Instant lastActiveAt, String lastLessonId, Instant dueAt, String source, String orderId
    ) {
        public static EnrollmentDto of(Enrollment e) {
            return new EnrollmentDto(e.getId(), e.getUserId(), e.getCourseId(), e.getStatus().name(), e.getEnrolledAt(),
                    e.getStartedAt(), e.getCompletedAt(), e.getLastActiveAt(), e.getLastLessonId(), e.getDueAt(), e.getSource() == null ? "FREE" : e.getSource(), e.getOrderId());
        }
    }

    public record CourseProgressDto(int done, int total, int pct, String status) {}

    public record ProgressUpdateRequest(
            String status, Integer percentage, Double lastPosition, Double watchPercentage,
            Boolean videoCompleted, String note, Boolean complete
    ) {}

    public record LessonProgressDto(
            String lessonId, String status, int percentage, Double lastPosition, Double watchPercentage,
            boolean videoCompleted, Instant completedAt, Instant updatedAt
    ) {
        public static LessonProgressDto of(LessonProgress p) {
            return new LessonProgressDto(p.getLessonId(), p.getStatus().name(), p.getPercentage(), p.getLastPosition(),
                    p.getWatchPercentage(), p.getVideoCompleted(), p.getCompletedAt(), p.getUpdatedAt());
        }
    }

    public record CompletionResult(
            boolean alreadyCompleted, int courseBefore, int courseAfter, boolean courseCompleted,
            String nextLessonId, String certificateId
    ) {}
}
