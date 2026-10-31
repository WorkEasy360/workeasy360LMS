package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.ProgressStatus;
import com.workeasy360.backend.domain.SkillEntities.*;
import com.workeasy360.backend.dto.SkillDtos;
import com.workeasy360.backend.dto.SkillDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.util.Json;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.concurrent.ConcurrentHashMap;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Skills library, course/lesson mappings, and deterministic skill progress.
 *
 * Progress is recomputed from stored evidence, never guessed:
 *   completed lesson  → + that lesson's mapped contribution % (unmapped lesson: an equal share of the course weight)
 *   completed course  → + the remainder of the course mapping's weight
 *   passed quiz       → + up to 15 pts scaled by score (recorded as a SkillAssessment)
 *   reviewed assignment → + 10 pts (submitted-but-unreviewed → + 5)
 * capped at 100. Level: 1 Novice <25 · 2 Developing <55 · 3 Proficient <80 · 4 Advanced ≥80 — and levels 3/4
 * require at least one assessment on record, so finishing videos alone never reads as "proficient".
 */
@Service
@Transactional
public class SkillService {
    public static final String[] LEVEL_LABELS = { "", "Novice", "Developing", "Proficient", "Advanced" };

    private final SkillRepo skills; private final SkillCategoryRepo categories;
    private final CourseSkillRepo courseSkills; private final LessonSkillRepo lessonSkills;
    private final UserSkillRepo userSkills; private final SkillAssessmentRepo assessments;
    private final CourseRepo courses; private final ModuleRepo modules; private final LessonRepo lessons;
    private final EnrollmentRepo enrollments; private final LessonProgressRepo progress;
    private final LearningPathRepo paths; private final LearningPathNodeRepo pathNodes;
    private final PermissionService perm;
    private final TransactionTemplate recalcTx;
    private final ConcurrentHashMap<String, Object> recalcLocks = new ConcurrentHashMap<>();
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SkillService.class);

    public SkillService(SkillRepo skills, SkillCategoryRepo categories, CourseSkillRepo courseSkills, LessonSkillRepo lessonSkills,
                        UserSkillRepo userSkills, SkillAssessmentRepo assessments, CourseRepo courses, ModuleRepo modules, LessonRepo lessons,
                        EnrollmentRepo enrollments, LessonProgressRepo progress, LearningPathRepo paths, LearningPathNodeRepo pathNodes, PermissionService perm,
                        PlatformTransactionManager txManager) {
        this.skills = skills; this.categories = categories; this.courseSkills = courseSkills; this.lessonSkills = lessonSkills;
        this.userSkills = userSkills; this.assessments = assessments; this.courses = courses; this.modules = modules; this.lessons = lessons;
        this.enrollments = enrollments; this.progress = progress; this.paths = paths; this.pathNodes = pathNodes; this.perm = perm;
        this.recalcTx = new TransactionTemplate(txManager);
        this.recalcTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Recalculates a learner's standing once the calling transaction (progress save, quiz attempt, submission…)
     * has committed, in its own transaction and serialised per learner. Two requests for the same learner arriving
     * together used to recalculate concurrently inside their own uncommitted transactions, both insert the same
     * new user_skills row, and the loser's whole request (e.g. the submission) rolled back with a unique-key error.
     * A recalculation problem is logged, never surfaced as a failure of the learner's save.
     */
    public void scheduleRecalculate(String userId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) { recalculateSerialized(userId); return; }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() { recalculateSerialized(userId); }
        });
    }
    private void recalculateSerialized(String userId) {
        synchronized (recalcLocks.computeIfAbsent(userId, k -> new Object())) {
            try { recalcTx.executeWithoutResult(status -> recalculate(userId)); }
            catch (RuntimeException e) { log.warn("Skill recalculation for {} failed: {}", userId, e.getMessage()); }
        }
    }

    // ---------- library ----------
    public List<SkillDto> listSkills(String orgId, boolean includeInactive) {
        Map<String, String> catNames = new HashMap<>();
        categories.findByOrgId(orgId).forEach(c -> catNames.put(c.getId(), c.getName()));
        return skills.findByOrgId(orgId).stream().filter(s -> includeInactive || s.getActive())
                .sorted(Comparator.comparing(Skill::getName))
                .map(s -> new SkillDto(s.getId(), s.getName(), s.getDescription(), s.getCategoryId(), catNames.getOrDefault(s.getCategoryId(), "General"), s.getIcon(), SkillDtos.levelsOf(s), s.getActive()))
                .toList();
    }
    public List<CategoryDto> listCategories(String orgId) { return categories.findByOrgId(orgId).stream().sorted(Comparator.comparing(SkillCategory::getPosition)).map(CategoryDto::of).toList(); }

    public Skill upsertSkill(CurrentUser user, UpsertSkillRequest req) {
        if (!perm.isAdmin(user)) throw ApiException.forbidden("Only an admin can manage the skills library");
        Skill s = req.id() != null ? skills.findById(req.id()).orElseGet(() -> Skill.builder().id(req.id()).orgId(user.getOrgId()).build()) : Skill.builder().orgId(user.getOrgId()).build();
        if (s.getOrgId() != null && !s.getOrgId().equals(user.getOrgId())) throw ApiException.notFound("Skill"); // tenant boundary
        if (req.name() != null) s.setName(req.name());
        if (s.getName() == null || s.getName().isBlank()) throw ApiException.badRequest("A skill needs a name");
        if (req.description() != null) s.setDescription(req.description());
        if (req.categoryId() != null) s.setCategoryId(req.categoryId().isBlank() || categories.findById(req.categoryId()).isEmpty() ? null : req.categoryId()); // blank/unknown → uncategorised, never an FK error
        if (req.icon() != null) s.setIcon(req.icon());
        if (req.levels() != null) s.setLevelsJson(Json.write(req.levels()));
        if (s.getLevelsJson() == null) s.setLevelsJson(defaultLevels());
        if (req.active() != null) s.setActive(req.active());
        return skills.save(s);
    }
    public void setActive(CurrentUser user, String id, boolean active) {
        if (!perm.isAdmin(user)) throw ApiException.forbidden("Only an admin can manage the skills library");
        Skill s = skills.findById(id).orElseThrow(() -> ApiException.notFound("Skill"));
        if (s.getOrgId() != null && !s.getOrgId().equals(user.getOrgId())) throw ApiException.notFound("Skill");
        s.setActive(active); skills.save(s);
    }
    public SkillCategory upsertCategory(CurrentUser user, UpsertCategoryRequest req) {
        if (!perm.isAdmin(user)) throw ApiException.forbidden("Only an admin can manage skill categories");
        SkillCategory c = req.id() != null ? categories.findById(req.id()).orElseGet(() -> SkillCategory.builder().id(req.id()).orgId(user.getOrgId()).build()) : SkillCategory.builder().orgId(user.getOrgId()).build();
        if (c.getOrgId() != null && !c.getOrgId().equals(user.getOrgId())) throw ApiException.notFound("Category");
        if (req.name() != null) c.setName(req.name());
        if (req.description() != null) c.setDescription(req.description());
        if (req.position() != null) c.setPosition(req.position());
        if (c.getName() == null) throw ApiException.badRequest("A category needs a name");
        return categories.save(c);
    }
    public static String defaultLevels() {
        return "[{\"level\":1,\"label\":\"Novice\",\"description\":\"Has been introduced to the skill.\"},{\"level\":2,\"label\":\"Developing\",\"description\":\"Applies it with guidance.\"},{\"level\":3,\"label\":\"Proficient\",\"description\":\"Applies it independently, with assessed evidence.\"},{\"level\":4,\"label\":\"Advanced\",\"description\":\"Consistently strong, assessed results.\"}]";
    }

    // ---------- mappings ----------
    /** Read-side tenant boundary for a course's skill mappings. */
    public void requireSameOrgCourse(CurrentUser user, String courseId) {
        Course c = courses.findById(courseId).orElseThrow(() -> ApiException.notFound("Course"));
        if (!perm.sameOrg(user, c)) throw ApiException.notFound("Course");
    }
    private Course editableCourse(CurrentUser user, String courseId) {
        Course c = courses.findById(courseId).orElseThrow(() -> ApiException.notFound("Course"));
        if (!perm.canEditCourse(user, c)) throw ApiException.forbidden("You can map skills only on courses you manage");
        return c;
    }
    public List<CourseSkillDto> courseSkills(String courseId) { return courseSkills.findByCourseId(courseId).stream().map(CourseSkillDto::of).toList(); }
    public List<LessonSkillDto> lessonSkills(String lessonId) { return lessonSkills.findByLessonId(lessonId).stream().map(LessonSkillDto::of).toList(); }
    /** Lesson → skill mappings (as JSON) for many lessons in one query. */
    public Map<String, com.fasterxml.jackson.databind.JsonNode> lessonSkillsBulk(java.util.Collection<String> lessonIds) {
        Map<String, List<LessonSkillDto>> grouped = new HashMap<>();
        if (!lessonIds.isEmpty()) lessonSkills.findByLessonIdIn(lessonIds).forEach(ls -> grouped.computeIfAbsent(ls.getLessonId(), k -> new ArrayList<>()).add(LessonSkillDto.of(ls)));
        Map<String, com.fasterxml.jackson.databind.JsonNode> out = new HashMap<>();
        grouped.forEach((k, v) -> out.put(k, com.workeasy360.backend.util.Json.MAPPER.valueToTree(v)));
        return out;
    }

    public List<CourseSkillDto> setCourseSkills(CurrentUser user, String courseId, List<CourseSkillDto> mappings) {
        editableCourse(user, courseId);
        replaceCourseSkills(courseId, mappings);
        return courseSkills(courseId);
    }
    /** Internal (no permission check) — also used when the Course Builder saves its `skills` JSON. */
    /** Diff-based (update in place / insert / delete) rather than delete-all + insert, so a re-sent identical mapping is a no-op. */
    public void replaceCourseSkills(String courseId, List<CourseSkillDto> mappings) {
        Map<String, CourseSkill> existing = new HashMap<>();
        courseSkills.findByCourseId(courseId).forEach(cs -> existing.put(cs.getSkillId(), cs));
        Set<String> seen = new HashSet<>();
        for (CourseSkillDto m : mappings) {
            if (m.skillId() == null || !seen.add(m.skillId()) || skills.findById(m.skillId()).isEmpty()) continue;
            CourseSkill cs = existing.getOrDefault(m.skillId(), CourseSkill.builder().courseId(courseId).skillId(m.skillId()).build());
            cs.setTargetLevel(clamp(m.targetLevel(), 1, 4, 3)); cs.setWeight(clamp(m.weight(), 0, 100, 30));
            courseSkills.save(cs);
        }
        existing.forEach((skillId, cs) -> { if (!seen.contains(skillId)) courseSkills.delete(cs); });
    }
    public void replaceCourseSkillsFromJson(String courseId, JsonNode skillsJson) {
        List<CourseSkillDto> out = new ArrayList<>();
        if (skillsJson != null && skillsJson.isArray()) for (JsonNode n : skillsJson)
            out.add(new CourseSkillDto(n.path("skillId").asText(null), n.path("targetLevel").asInt(3), n.path("points").asInt(n.path("weight").asInt(30))));
        replaceCourseSkills(courseId, out);
    }

    public List<LessonSkillDto> setLessonSkills(CurrentUser user, String lessonId, List<LessonSkillDto> mappings) {
        editableCourse(user, courseIdOfLesson(lessonId));
        replaceLessonSkills(lessonId, mappings);
        return lessonSkills(lessonId);
    }
    public void replaceLessonSkills(String lessonId, List<LessonSkillDto> mappings) {
        Map<String, LessonSkill> existing = new HashMap<>();
        lessonSkills.findByLessonId(lessonId).forEach(ls -> existing.put(ls.getSkillId(), ls));
        Set<String> seen = new HashSet<>();
        for (LessonSkillDto m : mappings) {
            if (m.skillId() == null || !seen.add(m.skillId()) || skills.findById(m.skillId()).isEmpty()) continue;
            LessonSkill ls = existing.getOrDefault(m.skillId(), LessonSkill.builder().lessonId(lessonId).skillId(m.skillId()).build());
            ls.setContributionPercentage(clamp(m.contribution(), 1, 100, 10));
            lessonSkills.save(ls);
        }
        existing.forEach((skillId, ls) -> { if (!seen.contains(skillId)) lessonSkills.delete(ls); });
    }
    public void replaceLessonSkillsFromJson(String lessonId, JsonNode json) {
        List<LessonSkillDto> out = new ArrayList<>();
        if (json != null && json.isArray()) for (JsonNode n : json) out.add(new LessonSkillDto(n.path("skillId").asText(null), n.path("contribution").asInt(10)));
        replaceLessonSkills(lessonId, out);
    }
    private static int clamp(int v, int lo, int hi, int dflt) { return v <= 0 ? dflt : Math.max(lo, Math.min(hi, v)); }

    public String courseIdOfLesson(String lessonId) {
        Lesson l = lessons.findById(lessonId).orElseThrow(() -> ApiException.notFound("Lesson"));
        return modules.findById(l.getModuleId()).orElseThrow(() -> ApiException.notFound("Module")).getCourseId();
    }
    /** Skills a lesson counts toward: its own mappings, else its course's. */
    private List<String> skillsForLesson(String lessonId) {
        List<String> own = lessonSkills.findByLessonId(lessonId).stream().map(LessonSkill::getSkillId).toList();
        if (!own.isEmpty()) return own;
        return courseSkills.findByCourseId(courseIdOfLesson(lessonId)).stream().map(CourseSkill::getSkillId).toList();
    }

    // ---------- evidence ----------
    public void recordAssessment(String userId, String lessonId, String kind, Integer score, boolean passed) {
        String courseId = courseIdOfLesson(lessonId);
        for (String skillId : skillsForLesson(lessonId)) {
            SkillAssessment a = assessments.findFirstByUserIdAndSkillIdAndLessonIdAndKind(userId, skillId, lessonId, kind)
                    .orElseGet(() -> SkillAssessment.builder().userId(userId).skillId(skillId).lessonId(lessonId).courseId(courseId).kind(kind).build());
            if (score != null && (a.getScore() == null || score > a.getScore())) a.setScore(score);
            a.setPassed(Boolean.TRUE.equals(a.getPassed()) || passed); // new row: passed is still null
            a.setAt(Instant.now());
            assessments.save(a);
        }
        scheduleRecalculate(userId);
    }

    // ---------- progress ----------
    public List<UserSkill> recalculate(String userId) {
        Map<String, Integer> points = new HashMap<>();
        Map<String, ArrayNode> evidence = new HashMap<>();
        Map<String, String> skillNames = new HashMap<>();
        skills.findAll().forEach(s -> skillNames.put(s.getId(), s.getName()));
        var add = new Object() {
            void pts(String skillId, int p, String source, String refId, String label) {
                if (!skillNames.containsKey(skillId) || p <= 0) return;
                points.merge(skillId, p, Integer::sum);
                ObjectNode e = Json.MAPPER.createObjectNode();
                e.put("source", source); e.put("refId", refId); e.put("label", label); e.put("points", p);
                evidence.computeIfAbsent(skillId, k -> Json.MAPPER.createArrayNode()).add(e);
            }
        };
        // completed lessons — an explicitly mapped lesson earns its contribution; an unmapped lesson earns an equal
        // share of each course-skill weight (so progress is visible lesson by lesson), and finishing the course
        // tops the weight up to exactly 100% of it. Mirrored client-side by learning.js's projectedGain().
        // One query per table for the learner's whole record (not one per enrolment / progress row): this runs on
        // every progress save, quiz attempt and submission, so it must stay cheap as the record grows.
        List<Enrollment> myEnrollments = enrollments.findByUserId(userId);
        Set<String> myCourseIds = myEnrollments.stream().map(Enrollment::getCourseId).collect(Collectors.toSet());
        Map<String, List<CourseSkill>> courseSkillsByCourse = myCourseIds.isEmpty() ? Map.of() : courseSkills.findByCourseIdIn(myCourseIds).stream().collect(Collectors.groupingBy(CourseSkill::getCourseId));
        Map<String, Course> courseById = myCourseIds.isEmpty() ? Map.of() : courses.findAllById(myCourseIds).stream().collect(Collectors.toMap(Course::getId, c -> c));
        List<CourseModule> myModules = myCourseIds.isEmpty() ? List.of() : modules.findByCourseIdIn(myCourseIds);
        Map<String, List<Lesson>> lessonsByModule = myModules.isEmpty() ? Map.of() : lessons.findByModuleIdIn(myModules.stream().map(CourseModule::getId).toList()).stream().collect(Collectors.groupingBy(Lesson::getModuleId));
        Map<String, Integer> lessonCountByCourse = new HashMap<>();
        Map<String, Lesson> lessonById = new HashMap<>();
        for (CourseModule m : myModules) for (Lesson l : lessonsByModule.getOrDefault(m.getId(), List.of())) { lessonCountByCourse.merge(m.getCourseId(), 1, Integer::sum); lessonById.put(l.getId(), l); }
        List<LessonProgress> myProgress = progress.findByUserId(userId);
        List<SkillAssessment> myAssessments = assessments.findByUserId(userId);
        Set<String> lessonIdsSeen = new HashSet<>();
        myProgress.forEach(p -> lessonIdsSeen.add(p.getLessonId()));
        myAssessments.forEach(a -> { if (a.getLessonId() != null) lessonIdsSeen.add(a.getLessonId()); });
        Map<String, List<LessonSkill>> lessonSkillsByLesson = lessonIdsSeen.isEmpty() ? Map.of() : lessonSkills.findByLessonIdIn(lessonIdsSeen).stream().collect(Collectors.groupingBy(LessonSkill::getLessonId));
        Map<String, List<LessonProgress>> progressByCourse = myProgress.stream().collect(Collectors.groupingBy(LessonProgress::getCourseId));
        for (Enrollment en : myEnrollments) {
            List<CourseSkill> cs = courseSkillsByCourse.getOrDefault(en.getCourseId(), List.of());
            int lessonCount = lessonCountByCourse.getOrDefault(en.getCourseId(), 0);
            Map<String, Integer> shared = new HashMap<>();
            for (LessonProgress lp : progressByCourse.getOrDefault(en.getCourseId(), List.of())) {
                if (lp.getStatus() != ProgressStatus.COMPLETED) continue;
                String title = Optional.ofNullable(lessonById.get(lp.getLessonId())).map(Lesson::getTitle).orElse("Lesson");
                List<LessonSkill> own = lessonSkillsByLesson.getOrDefault(lp.getLessonId(), List.of());
                if (!own.isEmpty()) { for (LessonSkill ls : own) add.pts(ls.getSkillId(), ls.getContributionPercentage(), "lesson", lp.getLessonId(), "Completed: " + title); }
                else if (lessonCount > 0) for (CourseSkill c : cs) {
                    int share = c.getWeight() / lessonCount;
                    if (share > 0) { add.pts(c.getSkillId(), share, "lesson", lp.getLessonId(), "Completed: " + title); shared.merge(c.getSkillId(), share, Integer::sum); }
                }
            }
            if (en.getCompletedAt() != null) {
                String title = Optional.ofNullable(courseById.get(en.getCourseId())).map(Course::getTitle).orElse("Course");
                for (CourseSkill c : cs) add.pts(c.getSkillId(), Math.max(0, c.getWeight() - shared.getOrDefault(c.getSkillId(), 0)), "course", en.getCourseId(), "Finished course: " + title);
            }
        }
        // assessed evidence
        Set<String> assessed = new HashSet<>();
        for (SkillAssessment a : myAssessments) {
            String label = Optional.ofNullable(a.getLessonId() == null ? null : lessonById.get(a.getLessonId())).map(Lesson::getTitle).orElse(a.getKind().toLowerCase());
            if ("QUIZ".equals(a.getKind())) { if (Boolean.TRUE.equals(a.getPassed())) { add.pts(a.getSkillId(), (int) Math.round(15.0 * Math.max(0, Math.min(100, a.getScore() == null ? 70 : a.getScore())) / 100.0), "quiz", a.getLessonId(), "Passed quiz: " + label + (a.getScore() != null ? " (" + a.getScore() + "%)" : "")); assessed.add(a.getSkillId()); } }
            else { boolean reviewed = Boolean.TRUE.equals(a.getPassed()); add.pts(a.getSkillId(), reviewed ? 10 : 5, "assignment", a.getLessonId(), (reviewed ? "Reviewed assignment: " : "Submitted assignment: ") + label); if (reviewed) assessed.add(a.getSkillId()); }
        }
        List<UserSkill> out = new ArrayList<>();
        Set<String> touched = new HashSet<>(points.keySet());
        userSkills.findByUserId(userId).forEach(u -> touched.add(u.getSkillId()));
        // A skill targeted by any of the learner's enrolments is tracked from day one (a 0% row), so /me/skills and the
        // skill analytics agree on who is working toward a skill before the first evidence lands.
        courseSkillsByCourse.values().forEach(list -> list.forEach(cs -> { if (skillNames.containsKey(cs.getSkillId())) touched.add(cs.getSkillId()); }));
        for (String skillId : touched) {
            int pct = Math.min(100, points.getOrDefault(skillId, 0));
            int level = levelFor(pct, assessed.contains(skillId));
            UserSkill u = userSkills.findByUserIdAndSkillId(userId, skillId).orElseGet(() -> UserSkill.builder().userId(userId).skillId(skillId).build());
            u.setProgressPercentage(pct); u.setCurrentLevel(level);
            u.setEvidenceJson(Json.write(evidence.getOrDefault(skillId, Json.MAPPER.createArrayNode())));
            out.add(userSkills.save(u));
        }
        return out;
    }
    public static int levelFor(int pct, boolean assessed) {
        if (pct >= 80 && assessed) return 4;
        if (pct >= 55 && assessed) return 3;
        if (pct >= 25) return 2;
        return 1;
    }

    public List<UserSkillDto> userSkills(String userId) {
        Map<String, UserSkill> mine = new HashMap<>();
        userSkills.findByUserId(userId).forEach(u -> mine.put(u.getSkillId(), u));
        // targets + related courses come from the mappings of courses the learner is enrolled in
        Map<String, Integer> target = new HashMap<>();
        Map<String, List<String>> related = new HashMap<>();
        for (Enrollment en : enrollments.findByUserId(userId)) for (CourseSkill cs : courseSkills.findByCourseId(en.getCourseId())) {
            target.merge(cs.getSkillId(), cs.getTargetLevel(), Math::max);
            related.computeIfAbsent(cs.getSkillId(), k -> new ArrayList<>()).add(en.getCourseId());
        }
        Instant recent = Instant.now().minusSeconds(14L * 86400);
        List<UserSkillDto> out = new ArrayList<>();
        Set<String> ids = new LinkedHashSet<>(target.keySet()); ids.addAll(mine.keySet());
        for (Skill s : skills.findAll()) {
            if (!s.getActive() || !ids.contains(s.getId())) continue;
            UserSkill u = mine.get(s.getId());
            int pct = u == null ? 0 : u.getProgressPercentage(), lvl = u == null ? 1 : u.getCurrentLevel();
            boolean improving = u != null && u.getUpdatedAt() != null && u.getUpdatedAt().isAfter(recent) && pct > 0 && pct < 100;
            out.add(new UserSkillDto(s.getId(), lvl, LEVEL_LABELS[lvl], pct, target.getOrDefault(s.getId(), 3),
                    Json.read(u == null ? "[]" : u.getEvidenceJson()), related.getOrDefault(s.getId(), List.of()), improving));
        }
        return out;
    }

    // ---------- learning paths ----------
    public List<LearningPathDto> learningPaths(String orgId) {
        return paths.findByOrgId(orgId).stream().filter(LearningPath::getActive).map(p -> new LearningPathDto(p.getId(), p.getTitle(), p.getDescription(),
                pathNodes.findByPathIdOrderByPositionAsc(p.getId()).stream().map(n -> {
                    List<String> req = new ArrayList<>();
                    JsonNode r = Json.read(n.getRequiresJson()); if (r.isArray()) r.forEach(x -> req.add(x.asText()));
                    return new LearningPathNodeDto(n.getNodeKey(), n.getNodeType().toLowerCase(), n.getCourseId(), n.getTitle(), n.getDescription(), req);
                }).toList())).toList();
    }
}
