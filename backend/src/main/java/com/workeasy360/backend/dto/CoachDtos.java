package com.workeasy360.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.CoachEntities.*;
import com.workeasy360.backend.util.Json;

import java.time.Instant;
import java.util.List;

public class CoachDtos {
    public record RecommendationDto(String id, String type, String title, String reason, List<String> facts, Integer minutes, String courseId, String lessonId, String skillId, String pathId,
                                    String status, String feedback, String href, Integer progressPct, String skillName, Instant createdAt) {}
    public record FeedbackRequest(String value) {}

    public record PlanItemDto(String id, int position, String kind, String courseId, String lessonId, String title, int minutes, boolean done, String href) {}
    public record LearningPlanDto(String id, String title, int minutes, String status, String source, String courseId, Instant createdAt, Instant startedAt, Instant completedAt, List<PlanItemDto> items, int doneCount) {}
    public record CreatePlanRequest(Integer minutes, String courseId) {}

    public record MessageDto(String id, String role, String content, JsonNode actions, String generationId, Instant at) {
        public static MessageDto of(CoachMessage m) { return new MessageDto(m.getId(), m.getRole(), m.getContent(), m.getActionsJson() == null ? null : Json.read(m.getActionsJson()), m.getGenerationId(), m.getAt()); }
    }
    public record ConversationDto(String id, String title, String lessonId, Instant createdAt, Instant updatedAt, List<MessageDto> messages) {}
    public record SendMessageRequest(String conversationId, String text, String lessonId) {}
    public record CoachReply(String conversationId, MessageDto user, MessageDto coach, LearningPlanDto plan, boolean deduplicated) {}
}
