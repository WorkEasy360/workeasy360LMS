package com.workeasy360.backend.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.NullNode;

/** Thin helper around Jackson for the flexible *_json TEXT columns (content blocks, quiz payloads, etc.) —
 *  these stay as a JsonNode tree end-to-end so the frontend's existing flexible block shapes pass through
 *  unchanged, instead of forcing a rigid Java class per content-block type. */
public final class Json {
    public static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule()).disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    private Json() {}

    public static String write(JsonNode node) {
        if (node == null || node.isNull()) return null;
        try { return MAPPER.writeValueAsString(node); } catch (Exception e) { throw new RuntimeException(e); }
    }

    public static JsonNode read(String json) {
        if (json == null || json.isBlank()) return NullNode.getInstance();
        try { return MAPPER.readTree(json); } catch (Exception e) { throw new RuntimeException(e); }
    }
}
