package com.workeasy360.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.AiGeneration;
import com.workeasy360.backend.util.Json;

import java.time.Instant;
import java.util.List;

public class AiDtos {
    /** kind: text (pasted) | lms (existing course/lesson content). pdf / docx / url are recognised but not yet supported. */
    public record SourceInput(String kind, String name, String text, String courseId, String lessonId, String url) {}

    public record GenerateCourseRequest(String topic, String audience, String difficulty, Integer durationMinutes, List<String> objectives, List<SourceInput> sources, String courseId) {}
    public record GenerateQuizRequest(String courseId, String lessonId, String context, List<String> objectives, Integer count, String difficulty, String questionType, List<SourceInput> sources) {}
    public record ApplyRequest(String courseId, String lessonId) {}

    public record StatusDto(boolean enabled, String provider, String model, boolean mock, boolean configured, int maxInputChars, int maxQuestions, List<String> supportedSourceKinds, String promptVersion) {}

    public record GenerationDto(String id, String userId, String type, String status, String provider, String model, String promptVersion,
                                JsonNode input, JsonNode result, JsonNode sources, String error, Instant createdAt, Instant completedAt,
                                String appliedCourseId, String appliedLessonId, boolean deduplicated) {
        public static GenerationDto of(AiGeneration g, boolean deduplicated) {
            return new GenerationDto(g.getId(), g.getUserId(), g.getType().name(), g.getStatus().name(), g.getProvider(), g.getModel(), g.getPromptVersion(),
                    Json.read(g.getInputJson()), g.getResultJson() == null ? null : Json.read(g.getResultJson()), g.getSourcesJson() == null ? null : Json.read(g.getSourcesJson()),
                    g.getError(), g.getCreatedAt(), g.getCompletedAt(), g.getAppliedCourseId(), g.getAppliedLessonId(), deduplicated);
        }
    }
}
