package com.workeasy360.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.Video;
import com.workeasy360.backend.util.Json;

import java.time.Instant;

public class VideoDtos {
    public record VideoDto(
            String id, String sourceType, String sourceUrl, String title, String description,
            Double duration, Integer width, Integer height, Long fileSize, String mimeType,
            String originalFileName, String status, String visibility, boolean hasThumbnail,
            JsonNode captions, Instant createdAt
    ) {
        public static VideoDto of(Video v) {
            return new VideoDto(v.getId(), v.getSourceType().name(), v.getSourceUrl(), v.getTitle(), v.getDescription(),
                    v.getDurationSeconds(), v.getWidth(), v.getHeight(), v.getFileSize(), v.getMimeType(),
                    v.getOriginalFileName(), v.getStatus().name(), v.getVisibility().name(), v.getThumbnailKey() != null,
                    Json.read(v.getCaptionsJson()), v.getCreatedAt());
        }
    }

    public record UpdateVideoRequest(String title, String description, String visibility, JsonNode captions) {}
    public record ExternalVideoRequest(String sourceType, String sourceUrl, String title) {}
}
