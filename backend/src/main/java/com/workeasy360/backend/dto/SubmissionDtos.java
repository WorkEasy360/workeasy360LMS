package com.workeasy360.backend.dto;

import com.workeasy360.backend.domain.Submission;

import java.time.Instant;

public class SubmissionDtos {
    public record SubmitRequest(String body) {}
    public record ReviewRequest(String feedback) {}

    public record SubmissionDto(String id, String userId, String lessonId, String courseId, String body,
                                 String status, String feedback, Instant submittedAt, Instant reviewedAt) {
        public static SubmissionDto of(Submission s) {
            return new SubmissionDto(s.getId(), s.getUserId(), s.getLessonId(), s.getCourseId(), s.getBody(),
                    s.getStatus().name(), s.getFeedback(), s.getSubmittedAt(), s.getReviewedAt());
        }
    }
}
