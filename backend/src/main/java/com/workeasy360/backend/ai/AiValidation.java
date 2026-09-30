package com.workeasy360.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.util.Json;

import java.util.List;
import java.util.Set;

/**
 * AI output is untrusted draft content. This turns a provider's raw text into a validated, normalised structure
 * (lengths capped, enums checked, answers consistent, unknown fields dropped) or throws Invalid with a clear reason.
 * Source references are kept only when they name a source that was actually supplied — never fabricated.
 */
public final class AiValidation {
    public static class Invalid extends Exception { public Invalid(String m) { super(m); } }

    private static final Set<String> LESSON_TYPES = Set.of("lesson", "reading", "video", "quiz", "assignment", "discussion");
    private static final Set<String> BLOCK_TYPES = Set.of("heading", "text", "callout", "checklist");
    private static final Set<String> QUESTION_TYPES = Set.of("mc", "multi", "tf", "short");
    private static final Set<String> DIFFICULTIES = Set.of("easy", "medium", "hard");

    /** Parses the model text as one JSON object (tolerating ```json fences and leading prose). */
    public static JsonNode parseObject(String text) throws Invalid {
        if (text == null || text.isBlank()) throw new Invalid("empty response");
        String t = text.trim();
        if (t.startsWith("```")) { t = t.replaceFirst("^```(json)?", "").replaceFirst("```\\s*$", "").trim(); }
        int start = t.indexOf('{'), end = t.lastIndexOf('}');
        if (start < 0 || end <= start) throw new Invalid("response is not a JSON object");
        try {
            JsonNode n = Json.MAPPER.readTree(t.substring(start, end + 1));
            if (n == null || !n.isObject()) throw new Invalid("response is not a JSON object");
            return n;
        } catch (Invalid e) { throw e; }
        catch (Exception e) { throw new Invalid("response is not valid JSON: " + e.getMessage()); }
    }

    public static ObjectNode course(JsonNode in, Set<String> sourceNames, int maxQuestions) throws Invalid {
        ObjectNode out = Json.MAPPER.createObjectNode();
        out.put("title", req(in, "title", 200));
        out.put("summary", opt(in, "summary", 1000));
        JsonNode mods = in.path("modules");
        if (!mods.isArray() || mods.isEmpty()) throw new Invalid("course has no modules");
        if (mods.size() > 12) throw new Invalid("too many modules (" + mods.size() + ")");
        ArrayNode modules = out.putArray("modules");
        int lessonsTotal = 0;
        for (JsonNode m : mods) {
            ObjectNode mo = modules.addObject();
            mo.put("title", req(m, "title", 200));
            mo.put("description", opt(m, "description", 1000));
            JsonNode ls = m.path("lessons");
            if (!ls.isArray() || ls.isEmpty()) throw new Invalid("module “" + mo.get("title").asText() + "” has no lessons");
            if (ls.size() > 10) throw new Invalid("too many lessons in a module (" + ls.size() + ")");
            ArrayNode lessons = mo.putArray("lessons");
            for (JsonNode l : ls) {
                lessonsTotal++;
                ObjectNode lo = lessons.addObject();
                lo.put("title", req(l, "title", 200));
                String type = l.path("type").asText("lesson").toLowerCase();
                if (!LESSON_TYPES.contains(type)) throw new Invalid("unknown lesson type “" + type + "”");
                lo.put("type", type);
                lo.put("objective", opt(l, "objective", 500));
                lo.put("durationMin", Math.max(1, Math.min(240, l.path("durationMin").asInt(10))));
                ArrayNode blocks = lo.putArray("blocks");
                JsonNode bs = l.path("blocks");
                if (bs.isArray()) { int n = 0; for (JsonNode b : bs) { if (++n > 20) break; blocks.add(block(b, sourceNames)); } }
                ArrayNode acts = lo.putArray("activities");
                JsonNode as = l.path("activities");
                if (as.isArray()) { int n = 0; for (JsonNode a : as) { if (++n > 10) break; String s = a.asText("").trim(); if (!s.isEmpty()) acts.add(cut(s, 400)); } }
                if (type.equals("quiz")) {
                    JsonNode qz = l.path("quiz");
                    ObjectNode qo = lo.putObject("quiz");
                    qo.put("passScore", Math.max(0, Math.min(100, qz.path("passScore").asInt(70))));
                    qo.set("questions", questions(qz.path("questions"), sourceNames, maxQuestions));
                } else lo.putNull("quiz");
                if (type.equals("assignment")) {
                    JsonNode asg = l.path("assignment");
                    ObjectNode ao = lo.putObject("assignment");
                    ao.put("brief", cut(asg.path("brief").asText("Describe how you would apply what you learned in this module."), 2000));
                    ArrayNode rub = ao.putArray("rubric");
                    if (asg.path("rubric").isArray()) for (JsonNode r : asg.path("rubric")) { if (rub.size() >= 8) break; String s = r.asText("").trim(); if (!s.isEmpty()) rub.add(cut(s, 300)); }
                } else lo.putNull("assignment");
            }
        }
        if (lessonsTotal > 60) throw new Invalid("too many lessons (" + lessonsTotal + ")");
        return out;
    }

    public static ArrayNode questions(JsonNode qs, Set<String> sourceNames, int maxQuestions) throws Invalid {
        if (!qs.isArray() || qs.isEmpty()) throw new Invalid("no questions generated");
        if (qs.size() > maxQuestions) throw new Invalid("too many questions (" + qs.size() + ", max " + maxQuestions + ")");
        ArrayNode out = Json.MAPPER.createArrayNode();
        int i = 0;
        for (JsonNode q : qs) {
            i++;
            ObjectNode o = out.addObject();
            String type = q.path("type").asText("mc").toLowerCase();
            if (!QUESTION_TYPES.contains(type)) throw new Invalid("question " + i + ": unknown type “" + type + "”");
            o.put("type", type);
            o.put("prompt", req(q, "prompt", 500));
            switch (type) {
                case "mc" -> {
                    List<String> opts = options(q, 2, 6, i);
                    int c = q.path("correctIndex").asInt(-1);
                    if (c < 0 || c >= opts.size()) throw new Invalid("question " + i + ": correctIndex out of range");
                    ArrayNode oa = o.putArray("options"); opts.forEach(oa::add); o.put("correctIndex", c);
                }
                case "multi" -> {
                    List<String> opts = options(q, 3, 8, i);
                    ArrayNode ci = o.putArray("correctIndices");
                    JsonNode cs = q.path("correctIndices");
                    if (!cs.isArray() || cs.isEmpty()) throw new Invalid("question " + i + ": correctIndices missing");
                    for (JsonNode c : cs) { int v = c.asInt(-1); if (v < 0 || v >= opts.size()) throw new Invalid("question " + i + ": correctIndices out of range"); if (!contains(ci, v)) ci.add(v); }
                    ArrayNode oa = o.putArray("options"); opts.forEach(oa::add);
                }
                case "tf" -> { if (!q.path("answer").isBoolean()) throw new Invalid("question " + i + ": true/false answer missing"); o.put("answer", q.path("answer").asBoolean()); }
                default -> {
                    ArrayNode acc = o.putArray("acceptedAnswers");
                    JsonNode a = q.path("acceptedAnswers");
                    if (a.isArray()) for (JsonNode k : a) { if (acc.size() >= 10) break; String s = k.asText("").trim(); if (!s.isEmpty()) acc.add(cut(s, 120)); }
                    if (acc.isEmpty()) throw new Invalid("question " + i + ": short answer has no accepted answers");
                }
            }
            o.put("explanation", opt(q, "explanation", 1000));
            String d = q.path("difficulty").asText("medium").toLowerCase();
            o.put("difficulty", DIFFICULTIES.contains(d) ? d : "medium");
            o.put("objective", opt(q, "objective", 300));
            String ref = q.path("sourceRef").asText(null);
            if (ref != null && sourceNames.contains(ref)) o.put("sourceRef", ref); else o.putNull("sourceRef");
        }
        return out;
    }

    private static ObjectNode block(JsonNode b, Set<String> sourceNames) throws Invalid {
        ObjectNode o = Json.MAPPER.createObjectNode();
        String type = b.path("type").asText("text").toLowerCase();
        if (!BLOCK_TYPES.contains(type)) type = "text";
        o.put("type", type);
        o.put("text", cut(b.path("text").asText(""), 4000));
        if (type.equals("checklist")) { ArrayNode items = o.putArray("items"); if (b.path("items").isArray()) for (JsonNode it : b.path("items")) { if (items.size() >= 12) break; String s = it.asText("").trim(); if (!s.isEmpty()) items.add(cut(s, 300)); } }
        String ref = b.path("sourceRef").asText(null);
        if (ref != null && sourceNames.contains(ref)) o.put("sourceRef", ref); else o.putNull("sourceRef");
        return o;
    }

    private static List<String> options(JsonNode q, int min, int max, int i) throws Invalid {
        JsonNode os = q.path("options");
        if (!os.isArray()) throw new Invalid("question " + i + ": options missing");
        List<String> out = new java.util.ArrayList<>();
        for (JsonNode x : os) { String s = x.asText("").trim(); if (!s.isEmpty()) out.add(cut(s, 300)); }
        if (out.size() < min || out.size() > max) throw new Invalid("question " + i + ": expected " + min + "-" + max + " options, got " + out.size());
        return out;
    }
    private static boolean contains(ArrayNode a, int v) { for (JsonNode n : a) if (n.asInt() == v) return true; return false; }
    private static String req(JsonNode n, String field, int max) throws Invalid { String s = n.path(field).asText("").trim(); if (s.isEmpty()) throw new Invalid("missing “" + field + "”"); return cut(s, max); }
    private static String opt(JsonNode n, String field, int max) { return cut(n.path(field).asText("").trim(), max); }
    private static String cut(String s, int max) { return s.length() <= max ? s : s.substring(0, max - 1) + "…"; }
    private AiValidation() {}
}
