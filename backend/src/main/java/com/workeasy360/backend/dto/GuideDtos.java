package com.workeasy360.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.GuideProgress;
import com.workeasy360.backend.util.Json;

public class GuideDtos {
    public record UpdateProgressRequest(String status, Integer stepIndex, JsonNode completedSteps) {}
    public record AnalyticsEventRequest(String event, Integer step, Long durationMs) {}

    public record ProgressDto(String guideId, String status, int stepIndex, JsonNode completedSteps) {
        public static ProgressDto of(GuideProgress p) {
            return new ProgressDto(p.getGuideId(), p.getStatus().name(), p.getStepIndex(), Json.read(p.getCompletedStepsJson()));
        }
    }
}
