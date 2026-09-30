package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.ai.*;
import com.workeasy360.backend.ai.AiProvider.AiException;
import com.workeasy360.backend.ai.AiProvider.Completion;
import com.workeasy360.backend.ai.AiProvider.Prompt;
import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.dto.AiDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
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
 * AI course-outline and quiz generation on top of the provider abstraction.
 *  - RBAC: reuses PermissionService (create-course / edit-course); learners are refused.
 *  - Limits: input size, question count, provider timeout (AiProperties).
 *  - Dedupe: an identical request (same user, same canonical input) completed within `dedupeMinutes` is returned
 *    instead of generated again.
 *  - Trust: provider output is parsed + validated (AiValidation); a malformed reply is retried once, then the
 *    generation is recorded as FAILED and a recoverable 422 is returned.
 *  - Audit: every attempt is an AiGeneration row (inputs, provider/model/prompt version, result, sources, error).
 * Nothing here publishes anything: results are drafts the client applies through the normal Course Builder flow.
 */
@Service
@Transactional
public class AiService {
    public static final List<String> SUPPORTED_SOURCE_KINDS = List.of("text", "lms");
    private final AiProvider provider;
    private final AiProperties props;
    private final AiGenerationRepo generations;
    private final CourseRepo courses; private final ModuleRepo modules; private final LessonRepo lessons;
    private final PermissionService perm;
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AiService.class);

    public AiService(AiProvider provider, AiProperties props, AiGenerationRepo generations, CourseRepo courses, ModuleRepo modules, LessonRepo lessons, PermissionService perm) {
        this.provider = provider; this.props = props; this.generations = generations; this.courses = courses; this.modules = modules; this.lessons = lessons; this.perm = perm;
    }

    public StatusDto status() {
        return new StatusDto(props.isEnabled(), provider.name(), provider.model(), props.usesMock(), provider.configured(), props.getMaxInputChars(), props.getMaxQuestions(), SUPPORTED_SOURCE_KINDS, Prompts.VERSION);
    }

    private void requireAuthor(CurrentUser u) { if (u.getRole() == Role.LEARNER) throw ApiException.forbidden("AI course and quiz generation is available to instructors and administrators"); }

    // ---------------------------------------------------------------- course outline
    /** noRollbackFor: a FAILED generation is reported as a 422 *and* must stay persisted for auditing. */
    @Transactional(noRollbackFor = ApiException.class)
    public GenerationDto generateCourse(CurrentUser u, GenerateCourseRequest req) {
        requireAuthor(u);
        if (!perm.canCreateCourse(u)) throw ApiException.forbidden("You are not allowed to create courses");
        if (req.courseId() != null && !req.courseId().isBlank()) { Course c = courses.findById(req.courseId()).orElseThrow(() -> ApiException.notFound("Course")); if (!perm.canEditCourse(u, c)) throw ApiException.forbidden("You can only generate into courses you manage"); }
        String topic = clean(req.topic(), 200);
        if (topic.isEmpty()) throw ApiException.badRequest("Give the course a topic or title");
        ObjectNode input = Json.MAPPER.createObjectNode();
        input.put("topic", topic);
        input.put("audience", clean(req.audience(), 200).isEmpty() ? "general staff" : clean(req.audience(), 200));
        input.put("difficulty", normalizeDifficulty(req.difficulty()));
        input.put("durationMinutes", Math.max(10, Math.min(2400, req.durationMinutes() == null ? 60 : req.durationMinutes())));
        ArrayNode objs = input.putArray("objectives");
        if (req.objectives() != null) for (String o : req.objectives()) { String s = clean(o, 300); if (!s.isEmpty() && objs.size() < 10) objs.add(s); }
        if (objs.isEmpty()) throw ApiException.badRequest("Add at least one learning objective");
        if (req.courseId() != null && !req.courseId().isBlank()) input.put("courseId", req.courseId());
        Sources src = resolveSources(u, req.sources());
        input.set("sourceMeta", src.meta);
        return run(u, AiGeneration.Type.COURSE, input, src, (p) -> provider.generateCourse(p), Prompts.COURSE_SYSTEM, Prompts.courseUser(input, src.text),
                (json) -> AiValidation.course(json, src.names, props.getMaxQuestions()));
    }

    // ---------------------------------------------------------------- quiz
    @Transactional(noRollbackFor = ApiException.class)
    public GenerationDto generateQuiz(CurrentUser u, GenerateQuizRequest req) {
        requireAuthor(u);
        Course course = null; Lesson lesson = null;
        if (req.lessonId() != null && !req.lessonId().isBlank()) {
            lesson = lessons.findById(req.lessonId()).orElseThrow(() -> ApiException.notFound("Lesson"));
            CourseModule m = modules.findById(lesson.getModuleId()).orElseThrow(() -> ApiException.notFound("Module"));
            course = courses.findById(m.getCourseId()).orElseThrow(() -> ApiException.notFound("Course"));
        } else if (req.courseId() != null && !req.courseId().isBlank()) course = courses.findById(req.courseId()).orElseThrow(() -> ApiException.notFound("Course"));
        if (course != null) { if (!perm.canEditCourse(u, course)) throw ApiException.forbidden("You can only generate quizzes for courses you manage"); }
        else if (!perm.canCreateCourse(u)) throw ApiException.forbidden("You are not allowed to create assessments");
        ObjectNode input = Json.MAPPER.createObjectNode();
        String context = clean(req.context(), 1000);
        if (context.isEmpty()) context = (course != null ? course.getTitle() : "") + (lesson != null ? " · " + lesson.getTitle() : "");
        input.put("context", context.trim());
        if (course != null) input.put("courseId", course.getId());
        if (lesson != null) input.put("lessonId", lesson.getId());
        int count = Math.max(1, Math.min(props.getMaxQuestions(), req.count() == null ? 5 : req.count()));
        input.put("count", count);
        String d = req.difficulty() == null ? "medium" : req.difficulty().trim().toLowerCase();
        input.put("difficulty", Set.of("easy", "medium", "hard").contains(d) ? d : "medium");
        String qt = req.questionType() == null ? "mixed" : req.questionType().trim().toLowerCase();
        input.put("questionType", Set.of("mc", "multi", "tf", "short", "mixed").contains(qt) ? qt : "mixed");
        ArrayNode objs = input.putArray("objectives");
        if (req.objectives() != null) for (String o : req.objectives()) { String s = clean(o, 300); if (!s.isEmpty() && objs.size() < 10) objs.add(s); }
        List<SourceInput> sources = new ArrayList<>(req.sources() == null ? List.of() : req.sources());
        if (lesson != null && sources.stream().noneMatch(s -> "lms".equals(s.kind()))) sources.add(new SourceInput("lms", lesson.getTitle(), null, course.getId(), lesson.getId(), null));
        if (objs.isEmpty() && context.isBlank() && sources.isEmpty()) throw ApiException.badRequest("Give the quiz some context, objectives or source material");
        Sources src = resolveSources(u, sources);
        input.set("sourceMeta", src.meta);
        return run(u, AiGeneration.Type.QUIZ, input, src, (p) -> provider.generateQuiz(p), Prompts.QUIZ_SYSTEM, Prompts.quizUser(input, src.text),
                (json) -> { ObjectNode out = Json.MAPPER.createObjectNode(); out.set("questions", AiValidation.questions(json.path("questions"), src.names, props.getMaxQuestions())); return out; });
    }

    // ---------------------------------------------------------------- shared pipeline
    @FunctionalInterface interface Call { Completion go(Prompt p) throws AiException; }
    @FunctionalInterface interface Validate { ObjectNode apply(JsonNode json) throws AiValidation.Invalid; }

    private GenerationDto run(CurrentUser u, AiGeneration.Type type, ObjectNode input, Sources src, Call call, String system, String user, Validate validate) {
        if (user.length() > props.getMaxInputChars() + 4000) throw ApiException.badRequest("Request too large — shorten the source material (max " + props.getMaxInputChars() + " characters)");
        String hash = sha256(type + "|" + input.toString());
        Instant since = Instant.now().minusSeconds(60L * props.getDedupeMinutes());
        for (AiGeneration g : generations.findByUserIdAndInputHashAndStatusOrderByCreatedAtDesc(u.getId(), hash, AiGeneration.Status.COMPLETED))
            if (g.getCreatedAt().isAfter(since)) return GenerationDto.of(g, true);
        if (!provider.configured()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "AI is enabled but the provider '" + provider.name() + "' is not configured (set AI_API_KEY and AI_MODEL)");

        AiGeneration g = generations.save(AiGeneration.builder().userId(u.getId()).type(type).status(AiGeneration.Status.PENDING)
                .provider(provider.name()).model(provider.model()).promptVersion(Prompts.VERSION).inputHash(hash)
                .inputJson(input.toString()).sourcesJson(src.meta.toString()).build());
        Prompt prompt = new Prompt(system, user, props.getMaxOutputTokens());
        String failure = null;
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                Completion c = call.go(attempt == 1 ? prompt : new Prompt(system, user + Prompts.RETRY_HINT, props.getMaxOutputTokens()));
                ObjectNode result = validate.apply(AiValidation.parseObject(c.text()));
                g.setModel(c.model()); g.setResultJson(result.toString()); g.setStatus(AiGeneration.Status.COMPLETED); g.setCompletedAt(Instant.now()); g.setError(null);
                return GenerationDto.of(generations.save(g), false);
            } catch (AiValidation.Invalid e) {
                failure = "The AI reply could not be used (" + e.getMessage() + ")";
                log.warn("AI {} generation {} attempt {} invalid: {}", type, g.getId(), attempt, e.getMessage());
            } catch (AiException e) {
                failure = e.getMessage();
                log.warn("AI {} generation {} attempt {} provider error: {}", type, g.getId(), attempt, e.getMessage());
                if (!e.isRetryable()) break;
            }
        }
        g.setStatus(AiGeneration.Status.FAILED); g.setCompletedAt(Instant.now()); g.setError(cut(failure, 2000));
        generations.save(g);
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, failure + ". Nothing was saved — adjust the inputs and try again.");
    }

    public GenerationDto get(CurrentUser u, String id) {
        AiGeneration g = generations.findById(id).orElseThrow(() -> ApiException.notFound("Generation"));
        if (!g.getUserId().equals(u.getId()) && !perm.isAdmin(u)) throw ApiException.forbidden("Not your generation");
        return GenerationDto.of(g, false);
    }
    /** A user's own generation records (authors: course/quiz drafts; learners: their coach turns). Always own rows only. */
    public List<GenerationDto> mine(CurrentUser u) { return generations.findByUserIdOrderByCreatedAtDesc(u.getId()).stream().limit(50).map(g -> GenerationDto.of(g, false)).toList(); }

    /** Records where a (possibly edited) result was applied by the client through the normal Course Builder sync. */
    public GenerationDto markApplied(CurrentUser u, String id, ApplyRequest req) {
        AiGeneration g = generations.findById(id).orElseThrow(() -> ApiException.notFound("Generation"));
        if (!g.getUserId().equals(u.getId()) && !perm.isAdmin(u)) throw ApiException.forbidden("Not your generation");
        if (g.getStatus() != AiGeneration.Status.COMPLETED) throw ApiException.badRequest("Only a completed generation can be applied");
        if (req.courseId() != null) { courses.findById(req.courseId()).ifPresent(c -> { if (!perm.canEditCourse(u, c)) throw ApiException.forbidden("You can only apply to courses you manage"); }); g.setAppliedCourseId(req.courseId()); }
        if (req.lessonId() != null) g.setAppliedLessonId(req.lessonId());
        return GenerationDto.of(generations.save(g), false);
    }

    // ---------------------------------------------------------------- sources
    private record Sources(String text, Set<String> names, ArrayNode meta) {}

    private Sources resolveSources(CurrentUser u, List<SourceInput> inputs) {
        ArrayNode meta = Json.MAPPER.createArrayNode();
        Set<String> names = new LinkedHashSet<>();
        StringBuilder text = new StringBuilder();
        if (inputs == null) return new Sources("", names, meta);
        int budget = props.getMaxInputChars();
        int n = 0;
        for (SourceInput s : inputs) {
            if (s == null || ++n > 8) break;
            String kind = s.kind() == null ? "text" : s.kind().trim().toLowerCase();
            if (!SUPPORTED_SOURCE_KINDS.contains(kind)) throw ApiException.badRequest("Source type '" + kind + "' is not supported yet (supported: pasted text, existing course content)");
            String body; String ref;
            if (kind.equals("lms")) {
                if (s.lessonId() != null && !s.lessonId().isBlank()) {
                    Lesson l = lessons.findById(s.lessonId()).orElseThrow(() -> ApiException.notFound("Lesson"));
                    CourseModule m = modules.findById(l.getModuleId()).orElseThrow(() -> ApiException.notFound("Module"));
                    Course c = courses.findById(m.getCourseId()).orElseThrow(() -> ApiException.notFound("Course"));
                    if (!perm.canEditCourse(u, c) && c.getStatus() != Enums.CourseStatus.PUBLISHED) throw ApiException.forbidden("You can't use that lesson as source material");
                    body = lessonText(l); ref = "lesson:" + l.getId();
                } else if (s.courseId() != null && !s.courseId().isBlank()) {
                    Course c = courses.findById(s.courseId()).orElseThrow(() -> ApiException.notFound("Course"));
                    if (!perm.canEditCourse(u, c) && c.getStatus() != Enums.CourseStatus.PUBLISHED) throw ApiException.forbidden("You can't use that course as source material");
                    StringBuilder sb = new StringBuilder(c.getTitle()).append(". ").append(c.getDescription() == null ? "" : c.getDescription()).append('\n');
                    for (CourseModule m : modules.findByCourseIdOrderByPositionAsc(c.getId())) for (Lesson l : lessons.findByModuleIdOrderByPositionAsc(m.getId())) sb.append(l.getTitle()).append(". ").append(lessonText(l)).append('\n');
                    body = sb.toString(); ref = "course:" + c.getId();
                } else throw ApiException.badRequest("An existing-content source needs a courseId or lessonId");
            } else { body = s.text() == null ? "" : s.text(); ref = "text"; }
            body = body.replaceAll("[\\p{Cntrl}&&[^\n\t]]", " ").trim();
            if (body.isEmpty()) continue;
            String name = clean(s.name(), 120).isEmpty() ? (kind.equals("lms") ? "Existing content" : "Pasted text") + " " + (names.size() + 1) : clean(s.name(), 120);
            boolean truncated = body.length() > budget;
            if (truncated) body = body.substring(0, Math.max(0, budget));
            budget -= body.length();
            names.add(name);
            ObjectNode m = meta.addObject();
            m.put("kind", kind); m.put("name", name); m.put("chars", body.length()); m.put("truncated", truncated); m.put("hash", sha256(body).substring(0, 16)); m.put("ref", ref);
            text.append("[source: ").append(name).append("]\n").append(body).append('\n');
            if (budget <= 0) break;
        }
        return new Sources(text.toString(), names, meta);
    }

    private static String lessonText(Lesson l) {
        StringBuilder sb = new StringBuilder();
        if (l.getDescription() != null) sb.append(l.getDescription()).append(' ');
        JsonNode content = l.getContentJson() == null ? null : Json.read(l.getContentJson());
        if (content != null && content.isArray()) for (JsonNode b : content) {
            if (b.hasNonNull("text")) sb.append(b.get("text").asText()).append(' ');
            if (b.path("items").isArray()) for (JsonNode it : b.path("items")) sb.append(it.path("text").asText(it.asText(""))).append(". ");
            if (b.path("question").hasNonNull("prompt")) sb.append(b.path("question").path("prompt").asText()).append(' ');
        }
        JsonNode quiz = l.getQuizJson() == null ? null : Json.read(l.getQuizJson());
        if (quiz != null) for (JsonNode q : quiz.path("questions")) sb.append(q.path("prompt").asText("")).append(' ');
        JsonNode asg = l.getAssignmentJson() == null ? null : Json.read(l.getAssignmentJson());
        if (asg != null) sb.append(asg.path("brief").asText("")).append(' ');
        return sb.toString().replaceAll("<[^>]+>", " ").replaceAll("\\s+", " ").trim();
    }

    private static String normalizeDifficulty(String d) { if (d == null) return "Beginner"; String t = d.trim().toLowerCase(); return t.startsWith("adv") ? "Advanced" : t.startsWith("int") ? "Intermediate" : "Beginner"; }
    private static String clean(String s, int max) { if (s == null) return ""; String t = s.replaceAll("[\\p{Cntrl}&&[^\n\t]]", " ").trim(); return t.length() > max ? t.substring(0, max) : t; }
    private static String cut(String s, int max) { return s == null ? null : s.length() <= max ? s : s.substring(0, max); }
    private static String sha256(String s) {
        try { byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)); StringBuilder sb = new StringBuilder(); for (byte b : d) sb.append(String.format("%02x", b)); return sb.toString(); }
        catch (Exception e) { return Integer.toHexString(s.hashCode()); }
    }
}
