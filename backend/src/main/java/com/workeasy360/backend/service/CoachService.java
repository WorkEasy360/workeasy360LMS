package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.ai.*;
import com.workeasy360.backend.ai.AiProvider.AiException;
import com.workeasy360.backend.ai.AiProvider.Completion;
import com.workeasy360.backend.ai.AiProvider.Prompt;
import com.workeasy360.backend.domain.AiGeneration;
import com.workeasy360.backend.domain.CoachEntities.*;
import com.workeasy360.backend.domain.Lesson;
import com.workeasy360.backend.dto.CoachDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.LearnerContextService.Context;
import com.workeasy360.backend.util.Json;
import com.workeasy360.backend.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/**
 * Learning Coach: a grounded AI turn over the learner's own context (LearnerContextService) plus the deterministic
 * recommendations. The provider's JSON reply is validated: action types are whitelisted and every course / lesson /
 * skill / path id must exist in the learner's accessible context (ids are never invented or leaked); plans are built
 * only from accessible lessons and persisted via LearningPlanService. Every turn is audited as an AiGeneration of
 * type COACH; a malformed reply is retried once, then recorded as FAILED and returned as a recoverable error.
 * Conversations are private to the learner.
 */
@Service
@Transactional(noRollbackFor = ApiException.class)
public class CoachService {
    private static final Set<String> ACTIONS = Set.of("CONTINUE_LESSON", "VIEW_COURSE", "VIEW_SKILL", "VIEW_JOURNEY", "START_PLAN");
    private static final Set<String> KINDS = Set.of("LESSON", "PRACTICE", "QUIZ", "REVIEW");
    private final AiProvider provider; private final AiProperties props; private final AiGenerationRepo generations;
    private final LearnerContextService contextService; private final RecommendationService recommendations; private final LearningPlanService plansService;
    private final CoachConversationRepo conversations; private final CoachMessageRepo messages; private final LessonRepo lessons;
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(CoachService.class);

    public CoachService(AiProvider provider, AiProperties props, AiGenerationRepo generations, LearnerContextService contextService, RecommendationService recommendations,
                        LearningPlanService plansService, CoachConversationRepo conversations, CoachMessageRepo messages, LessonRepo lessons) {
        this.provider = provider; this.props = props; this.generations = generations; this.contextService = contextService; this.recommendations = recommendations;
        this.plansService = plansService; this.conversations = conversations; this.messages = messages; this.lessons = lessons;
    }

    /** Snapshot for the Coach screen: greeting facts + recommendations + lesson context (no AI call). */
    public ObjectNode context(CurrentUser u, String lessonId) {
        Context ctx = contextService.build(u);
        List<RecommendationDto> recs = recommendations.refresh(u.getId(), ctx);
        ObjectNode o = contextService.toJson(ctx, recommendations.activeRows(u.getId()));
        o.set("recommendationCards", Json.MAPPER.valueToTree(recs));
        o.put("aiAvailable", provider.configured());
        o.put("aiProvider", provider.name());
        if (lessonId != null && !lessonId.isBlank()) { ObjectNode l = lessonJson(ctx, lessonId); if (l != null) o.set("currentLesson", l); }
        return o;
    }

    public CoachReply message(CurrentUser u, SendMessageRequest req) {
        String text = req.text() == null ? "" : req.text().replaceAll("[\\p{Cntrl}&&[^\n\t]]", " ").trim();
        if (text.isEmpty()) throw ApiException.badRequest("Ask the coach something first");
        if (text.length() > 1000) text = text.substring(0, 1000);
        Context ctx = contextService.build(u);
        List<Recommendation> recRows = new ArrayList<>(); recommendations.refresh(u.getId(), ctx); recRows.addAll(recommendations.activeRows(u.getId()));
        CoachConversation conv = req.conversationId() == null || req.conversationId().isBlank() ? null : conversations.findById(req.conversationId()).orElseThrow(() -> ApiException.notFound("Conversation"));
        if (conv != null && !conv.getUserId().equals(u.getId())) throw ApiException.forbidden("Not your conversation");
        ObjectNode lessonJson = req.lessonId() == null || req.lessonId().isBlank() ? null : lessonJson(ctx, req.lessonId());
        if (req.lessonId() != null && !req.lessonId().isBlank() && lessonJson == null) throw ApiException.forbidden("That lesson isn't available to you");
        if (conv == null) conv = conversations.save(CoachConversation.builder().userId(u.getId()).title(text.length() > 60 ? text.substring(0, 57) + "…" : text).lessonId(lessonJson == null ? null : req.lessonId()).build());
        List<String[]> history = messages.findByConversationIdOrderByAtAsc(conv.getId()).stream().skip(Math.max(0, messages.findByConversationIdOrderByAtAsc(conv.getId()).size() - 6)).map(m -> new String[]{ m.getRole().equals("USER") ? "Learner" : "Coach", m.getContent().length() > 400 ? m.getContent().substring(0, 400) : m.getContent() }).toList();
        CoachMessage userMsg = messages.save(CoachMessage.builder().conversationId(conv.getId()).role("USER").content(text).build());
        conv.setUpdatedAt(Instant.now()); conversations.save(conv);

        String contextJson = contextService.toJson(ctx, recRows).toString();
        String user = Prompts.coachUser(contextJson, lessonJson == null ? null : lessonJson.toString(), history, text);
        String hash = sha256("COACH|" + u.getId() + "|" + text + "|" + (req.lessonId() == null ? "" : req.lessonId()) + "|" + contextJson.hashCode());
        if (!provider.configured()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "The learning coach isn't available right now (AI provider '" + provider.name() + "' is not configured). Your recommendations still work.");
        AiGeneration g = generations.save(AiGeneration.builder().userId(u.getId()).type(AiGeneration.Type.COACH).status(AiGeneration.Status.PENDING).provider(provider.name()).model(provider.model())
                .promptVersion(Prompts.COACH_VERSION).inputHash(hash).inputJson(Json.MAPPER.createObjectNode().put("question", text).put("lessonId", req.lessonId()).put("conversationId", conv.getId()).toString()).build());
        String failure = null;
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                Completion c = provider.generateCoach(new Prompt(Prompts.COACH_SYSTEM, attempt == 1 ? user : user + Prompts.RETRY_HINT, Math.min(props.getMaxOutputTokens(), 1500)));
                JsonNode raw = AiValidation.parseObject(c.text());
                ObjectNode validated = validate(raw, ctx);
                LearningPlanDto plan = null;
                if (validated.has("planItems")) {
                    List<LearningPlanService.ItemSpec> specs = new ArrayList<>();
                    for (JsonNode it : validated.get("planItems")) specs.add(new LearningPlanService.ItemSpec(it.get("kind").asText(), it.get("courseId").asText(), it.hasNonNull("lessonId") ? it.get("lessonId").asText() : null, it.get("title").asText(), it.get("minutes").asInt()));
                    plan = plansService.createFromSpecs(u, validated.get("planMinutes").asInt(), specs, "COACH", ctx);
                    ObjectNode a = ((ArrayNode) validated.get("actions")).addObject(); a.put("type", "START_PLAN"); a.put("label", "Start " + plan.minutes() + "-minute plan"); a.put("planId", plan.id());
                    validated.remove("planItems"); validated.remove("planMinutes");
                }
                g.setModel(c.model()); g.setResultJson(validated.toString()); g.setStatus(AiGeneration.Status.COMPLETED); g.setCompletedAt(Instant.now()); generations.save(g);
                CoachMessage reply = messages.save(CoachMessage.builder().conversationId(conv.getId()).role("COACH").content(validated.get("reply").asText()).actionsJson(validated.get("actions").toString()).generationId(g.getId()).build());
                return new CoachReply(conv.getId(), MessageDto.of(userMsg), MessageDto.of(reply), plan, false);
            } catch (AiValidation.Invalid e) { failure = "The coach's reply couldn't be used (" + e.getMessage() + ")"; log.warn("Coach generation {} attempt {} invalid: {}", g.getId(), attempt, e.getMessage()); }
            catch (AiException e) { failure = e.getMessage(); log.warn("Coach generation {} attempt {} provider error: {}", g.getId(), attempt, e.getMessage()); if (!e.isRetryable()) break; }
        }
        g.setStatus(AiGeneration.Status.FAILED); g.setCompletedAt(Instant.now()); g.setError(failure); generations.save(g);
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, failure + ". Please try asking again — your recommendations and courses are unaffected.");
    }

    /** Structural + referential validation: whitelisted action types, ids restricted to the learner's accessible context. */
    ObjectNode validate(JsonNode raw, Context ctx) throws AiValidation.Invalid {
        ObjectNode out = Json.MAPPER.createObjectNode();
        String reply = raw.path("reply").asText("").trim();
        if (reply.isEmpty()) throw new AiValidation.Invalid("missing reply");
        out.put("reply", reply.length() > 2000 ? reply.substring(0, 1999) + "…" : reply);
        ArrayNode actions = out.putArray("actions");
        Set<String> skillIds = new HashSet<>(); ctx.skills().forEach(s -> skillIds.add(s.skillId()));
        Set<String> pathIds = new HashSet<>(); ctx.journeys().forEach(j -> pathIds.add(j.id()));
        if (raw.path("actions").isArray()) for (JsonNode a : raw.path("actions")) {
            if (actions.size() >= 3) break;
            String type = a.path("type").asText("");
            if (!ACTIONS.contains(type) || type.equals("START_PLAN")) continue;
            String courseId = a.path("courseId").asText(null), lessonId = a.path("lessonId").asText(null), skillId = a.path("skillId").asText(null), pathId = a.path("pathId").asText(null);
            boolean ok = switch (type) {
                case "CONTINUE_LESSON" -> courseId != null && lessonId != null && ctx.accessibleCourseIds().contains(courseId) && ctx.accessibleLessonIds().contains(lessonId);
                case "VIEW_COURSE" -> courseId != null && ctx.accessibleCourseIds().contains(courseId);
                case "VIEW_SKILL" -> skillId != null && skillIds.contains(skillId);
                default -> pathId != null && pathIds.contains(pathId);
            };
            if (!ok) continue; // an unknown / inaccessible id is dropped, never surfaced
            ObjectNode o = actions.addObject(); o.put("type", type); o.put("label", cut(a.path("label").asText(defaultLabel(type)), 80));
            if (courseId != null) o.put("courseId", courseId); if (lessonId != null) o.put("lessonId", lessonId); if (skillId != null) o.put("skillId", skillId); if (pathId != null) o.put("pathId", pathId);
            o.put("href", type.equals("CONTINUE_LESSON") ? "/learn/" + courseId + "/" + lessonId : type.equals("VIEW_COURSE") ? "/explore/" + courseId : type.equals("VIEW_SKILL") ? "/skills" : "/journeys");
        }
        JsonNode plan = raw.path("plan");
        if (plan.isObject() && plan.path("items").isArray() && !plan.path("items").isEmpty()) {
            int minutes = Math.max(5, Math.min(240, plan.path("minutes").asInt(20)));
            ArrayNode items = Json.MAPPER.createArrayNode();
            for (JsonNode it : plan.path("items")) {
                if (items.size() >= 8) break;
                String kind = it.path("kind").asText("LESSON").toUpperCase(); if (!KINDS.contains(kind)) kind = "LESSON";
                String courseId = it.path("courseId").asText(null), lessonId = it.path("lessonId").asText(null);
                if (courseId == null || !ctx.accessibleCourseIds().contains(courseId)) continue;
                if (lessonId != null && !ctx.accessibleLessonIds().contains(lessonId)) continue;
                if (lessonId == null && !kind.equals("REVIEW")) continue;
                ObjectNode o = items.addObject(); o.put("kind", kind); o.put("courseId", courseId); if (lessonId != null) o.put("lessonId", lessonId); else o.putNull("lessonId");
                o.put("title", cut(it.path("title").asText(lessonId != null ? ctx.lessonTitles().getOrDefault(lessonId, "Lesson") : "Review"), 200)); o.put("minutes", Math.max(1, Math.min(120, it.path("minutes").asInt(5))));
            }
            if (!items.isEmpty()) { out.set("planItems", items); out.put("planMinutes", minutes); }
        }
        return out;
    }

    private ObjectNode lessonJson(Context ctx, String lessonId) {
        if (!ctx.accessibleLessonIds().contains(lessonId)) return null;
        Lesson l = lessons.findById(lessonId).orElse(null);
        if (l == null) return null;
        ObjectNode o = Json.MAPPER.createObjectNode();
        o.put("lessonId", l.getId()); o.put("title", l.getTitle()); o.put("type", l.getLessonType().name().toLowerCase()); o.put("minutes", l.getDurationMin() == null ? 5 : l.getDurationMin());
        String courseId = ctx.courses().stream().filter(s -> s.remaining().stream().anyMatch(x -> x.getId().equals(lessonId)) || ctx.lessonTitles().containsKey(lessonId)).map(LearnerContextService.CourseState::courseId).findFirst().orElse(null);
        if (courseId != null) { o.put("courseId", courseId); o.put("courseTitle", ctx.courseTitles().getOrDefault(courseId, "")); }
        StringBuilder text = new StringBuilder();
        if (l.getDescription() != null) text.append(l.getDescription()).append(' ');
        JsonNode content = l.getContentJson() == null ? null : Json.read(l.getContentJson());
        if (content != null && content.isArray()) for (JsonNode b : content) { if (b.hasNonNull("text")) text.append(b.get("text").asText()).append(' '); if (b.path("items").isArray()) for (JsonNode it : b.path("items")) text.append(it.path("text").asText(it.asText(""))).append(". "); }
        JsonNode quiz = l.getQuizJson() == null ? null : Json.read(l.getQuizJson());
        if (quiz != null) for (JsonNode q : quiz.path("questions")) text.append("Question: ").append(q.path("prompt").asText("")).append(' ');
        String t = text.toString().replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
        o.put("content", t.length() > 3000 ? t.substring(0, 3000) : t);
        return o;
    }

    public List<ConversationDto> conversations(CurrentUser u) {
        return conversations.findByUserIdOrderByUpdatedAtDesc(u.getId()).stream().limit(20).map(c -> new ConversationDto(c.getId(), c.getTitle(), c.getLessonId(), c.getCreatedAt(), c.getUpdatedAt(), List.of())).toList();
    }
    public ConversationDto conversation(CurrentUser u, String id) {
        CoachConversation c = conversations.findById(id).orElseThrow(() -> ApiException.notFound("Conversation"));
        if (!c.getUserId().equals(u.getId())) throw ApiException.forbidden("Not your conversation");
        return new ConversationDto(c.getId(), c.getTitle(), c.getLessonId(), c.getCreatedAt(), c.getUpdatedAt(), messages.findByConversationIdOrderByAtAsc(id).stream().map(MessageDto::of).toList());
    }

    private static String defaultLabel(String type) { return switch (type) { case "CONTINUE_LESSON" -> "Continue lesson"; case "VIEW_COURSE" -> "View course"; case "VIEW_SKILL" -> "View skills"; default -> "View journey"; }; }
    private static String cut(String s, int max) { return s.length() <= max ? s : s.substring(0, max - 1) + "…"; }
    private static String sha256(String s) { try { byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)); StringBuilder sb = new StringBuilder(); for (byte b : d) sb.append(String.format("%02x", b)); return sb.toString(); } catch (Exception e) { return Integer.toHexString(s.hashCode()); } }
}
