package com.workeasy360.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.QuizAttempt;
import com.workeasy360.backend.util.Json;

import java.time.Instant;

public class QuizDtos {
    public record SubmitAttemptRequest(JsonNode responses, Integer score, Boolean passed) {}

    public record AttemptDto(String id, String lessonId, Integer score, boolean passed, int attemptNumber, Instant submittedAt) {
        public static AttemptDto of(QuizAttempt a) {
            return new AttemptDto(a.getId(), a.getLessonId(), a.getScore(), a.getPassed(), a.getAttemptNumber(), a.getSubmittedAt());
        }
    }
}
