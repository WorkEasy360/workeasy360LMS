package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.*;
import com.workeasy360.backend.domain.SkillEntities.*;
import com.workeasy360.backend.dto.AnalyticsDtos.*;
import com.workeasy360.backend.dto.SkillDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.util.Json;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Assembles ONE learner's compact, bounded context from the existing systems (analytics /me, skills, learning paths,
 * courses, quiz attempts, submissions, certificates). It is the only thing the Coach and the recommendation engine
 * look at, so both stay grounded in the same facts — and nothing here is a second source of truth: every number is
 * read from the existing services/rows at request time. Contains no credentials and no other user's data.
 */
@Service
@Transactional(readOnly = true)
public class LearnerContextService {
    public static final int MAX_COURSES = 12, MAX_AVAILABLE = 8, MAX_ACTIVITY = 6, MAX_SKILLS = 10;

    public record CourseState(String courseId, String title, String status, int pct, int done, int total, Lesson nextLesson, List<Lesson> remaining, Instant lastActiveAt, Instant dueAt, int minutesLeft, boolean sequential) {}
    public record SkillState(String skillId, String name, int level, String levelLabel, int pct, int targetLevel, String targetLabel, int gapPct, List<String> courseIds) {}
    public record JourneyState(String id, String title, int pct, String nextCourseId, String nextTitle, List<String> courseIds) {}
    public record AvailableCourse(String courseId, String title, int minutes, List<String> skillIds, String level, String category) {}
    public record QuizWeakness(String courseId, String courseTitle, String lessonId, String lessonTitle, int score, boolean passed) {}
    public record CertState(String courseId, String courseTitle, String status, Instant expiresAt) {}
    public record Context(User user, List<CourseState> courses, List<SkillState> skills, List<JourneyState> journeys, List<AvailableCourse> available,
                          List<QuizWeakness> quizzes, int pendingAssignments, List<CertState> certificates, List<ActivityItem> recent, int streakDays,
                          Set<String> accessibleCourseIds, Set<String> accessibleLessonIds, Map<String, String> lessonTitles, Map<String, String> courseTitles) {}

    private final UserRepo users; private final CourseRepo courses; private final ModuleRepo modules; private final LessonRepo lessons;
    private final EnrollmentRepo enrollments; private final LessonProgressRepo progress; private final QuizAttemptRepo attempts; private final SubmissionRepo submissions;
    private final CertificateRepo certificates; private final SkillService skillService; private final SkillRepo skills; private final CourseSkillRepo courseSkills;
    private final AnalyticsService analytics;

    public LearnerContextService(UserRepo users, CourseRepo courses, ModuleRepo modules, LessonRepo lessons, EnrollmentRepo enrollments, LessonProgressRepo progress,
                                 QuizAttemptRepo attempts, SubmissionRepo submissions, CertificateRepo certificates, SkillService skillService, SkillRepo skills, CourseSkillRepo courseSkills, AnalyticsService analytics) {
        this.users = users; this.courses = courses; this.modules = modules; this.lessons = lessons; this.enrollments = enrollments; this.progress = progress; this.attempts = attempts;
        this.submissions = submissions; this.certificates = certificates; this.skillService = skillService; this.skills = skills; this.courseSkills = courseSkills; this.analytics = analytics;
    }

    public Context build(CurrentUser u) {
        User user = users.findById(u.getId()).orElseThrow();
        String uid = user.getId();
        List<Enrollment> ens = enrollments.findByUserId(uid);
        Set<String> courseIds = ens.stream().map(Enrollment::getCourseId).collect(Collectors.toCollection(LinkedHashSet::new));
        Map<String, Course> courseById = new HashMap<>();
        courses.findByOrgId(user.getOrgId()).forEach(c -> courseById.put(c.getId(), c)); // the coach only ever sees this tenant's catalogue
        // lessons of enrolled + published courses, one query per table
        Set<String> published = courseById.values().stream().filter(c -> c.getStatus() == CourseStatus.PUBLISHED && c.getVisibility() == CourseVisibility.CATALOG).map(Course::getId).collect(Collectors.toSet());
        Set<String> accessible = new LinkedHashSet<>(courseIds); accessible.addAll(published);
        List<CourseModule> mods = accessible.isEmpty() ? List.of() : modules.findByCourseIdIn(accessible);
        Map<String, List<Lesson>> byModule = mods.isEmpty() ? Map.of() : lessons.findByModuleIdIn(mods.stream().map(CourseModule::getId).toList()).stream().collect(Collectors.groupingBy(Lesson::getModuleId));
        Map<String, List<Lesson>> orderedByCourse = new HashMap<>();
        Map<String, String> lessonTitles = new HashMap<>(), courseTitles = new HashMap<>();
        for (String cid : accessible) {
            List<Lesson> ordered = new ArrayList<>();
            mods.stream().filter(m -> m.getCourseId().equals(cid)).sorted(Comparator.comparingInt(CourseModule::getPosition)).forEach(m -> byModule.getOrDefault(m.getId(), List.of()).stream().sorted(Comparator.comparingInt(Lesson::getPosition)).forEach(ordered::add));
            orderedByCourse.put(cid, ordered);
            ordered.forEach(l -> lessonTitles.put(l.getId(), l.getTitle()));
            if (courseById.containsKey(cid)) courseTitles.put(cid, courseById.get(cid).getTitle());
        }
        Set<String> completedLessons = progress.findByUserId(uid).stream().filter(p -> p.getStatus() == ProgressStatus.COMPLETED).map(LessonProgress::getLessonId).collect(Collectors.toSet());
        List<CourseState> states = new ArrayList<>();
        for (Enrollment e : ens) {
            Course c = courseById.get(e.getCourseId()); if (c == null) continue;
            List<Lesson> ordered = orderedByCourse.getOrDefault(c.getId(), List.of());
            List<Lesson> remaining = ordered.stream().filter(l -> !completedLessons.contains(l.getId())).toList();
            int total = ordered.size(), done = total - remaining.size();
            int pct = e.getCompletedAt() != null ? 100 : total == 0 ? 0 : Math.round(done * 100f / total);
            String status = e.getCompletedAt() != null || (total > 0 && done == total) ? "completed" : done > 0 ? "in-progress" : "not-started";
            int minutesLeft = remaining.stream().mapToInt(l -> l.getDurationMin() == null ? 5 : l.getDurationMin()).sum();
            states.add(new CourseState(c.getId(), c.getTitle(), status, pct, done, total, remaining.isEmpty() ? null : remaining.get(0), remaining, e.getLastActiveAt(), e.getDueAt(), minutesLeft, Boolean.TRUE.equals(c.getSequential())));
        }
        // Bounded list, most useful first: what the learner is in the middle of, then what is waiting (due dates first),
        // then recent completions — so a long history of finished courses never hides the active ones from the coach.
        Comparator<CourseState> byRecency = Comparator.comparing((CourseState s) -> s.lastActiveAt() == null ? Instant.EPOCH : s.lastActiveAt()).reversed();
        states.sort(Comparator.comparingInt((CourseState s) -> s.status().equals("in-progress") ? 0 : s.status().equals("not-started") ? (s.dueAt() != null ? 1 : 2) : 3).thenComparing(byRecency));
        if (states.size() > MAX_COURSES) states = states.subList(0, MAX_COURSES);

        Map<String, String> skillNames = new HashMap<>();
        skills.findByOrgId(user.getOrgId()).forEach(s -> skillNames.put(s.getId(), s.getName()));
        List<SkillState> skillStates = skillService.userSkills(uid).stream().map(s -> new SkillState(s.skillId(), skillNames.getOrDefault(s.skillId(), s.skillId()), s.currentLevel(), s.levelLabel(), s.progressPercentage(), s.targetLevel(),
                SkillService.LEVEL_LABELS[Math.max(1, Math.min(4, s.targetLevel()))], Math.max(0, levelPct(s.targetLevel()) - s.progressPercentage()), s.courseIds())).sorted(Comparator.comparingInt(SkillState::gapPct).reversed()).limit(MAX_SKILLS).toList();

        Map<String, Integer> pctByCourse = states.stream().collect(Collectors.toMap(CourseState::courseId, CourseState::pct, (a, b) -> a));
        List<JourneyState> journeys = new ArrayList<>();
        for (LearningPathDto p : skillService.learningPaths(user.getOrgId())) {
            List<String> ids = p.nodes().stream().filter(n -> "course".equals(n.type()) && n.courseId() != null).map(LearningPathNodeDto::courseId).toList();
            if (ids.isEmpty()) continue;
            int pct = Math.round((float) ids.stream().mapToInt(id -> pctByCourse.getOrDefault(id, 0)).sum() / ids.size());
            String next = ids.stream().filter(id -> pctByCourse.getOrDefault(id, 0) < 100 && courseById.containsKey(id)).findFirst().orElse(null);
            journeys.add(new JourneyState(p.id(), p.title(), pct, next, next == null ? null : courseById.get(next).getTitle(), ids));
        }

        Map<String, List<String>> skillsByCourse = courseSkills.findAll().stream().collect(Collectors.groupingBy(CourseSkill::getCourseId, Collectors.mapping(CourseSkill::getSkillId, Collectors.toList())));
        List<AvailableCourse> available = published.stream().filter(id -> !courseIds.contains(id)).map(courseById::get).sorted(Comparator.comparing(Course::getTitle))
                .map(c -> new AvailableCourse(c.getId(), c.getTitle(), orderedByCourse.getOrDefault(c.getId(), List.of()).stream().mapToInt(l -> l.getDurationMin() == null ? 5 : l.getDurationMin()).sum(), skillsByCourse.getOrDefault(c.getId(), List.of()), c.getLevel(), c.getCategory())).limit(MAX_AVAILABLE).toList();

        Map<String, QuizAttempt> latestByLesson = new HashMap<>();
        for (QuizAttempt a : attempts.findByUserId(uid)) latestByLesson.merge(a.getLessonId(), a, (x, y) -> x.getSubmittedAt() != null && y.getSubmittedAt() != null && y.getSubmittedAt().isAfter(x.getSubmittedAt()) ? y : x);
        List<QuizWeakness> weak = latestByLesson.values().stream().filter(a -> !Boolean.TRUE.equals(a.getPassed()) && courseById.containsKey(a.getCourseId()) && lessonTitles.containsKey(a.getLessonId()))
                .map(a -> new QuizWeakness(a.getCourseId(), courseById.get(a.getCourseId()).getTitle(), a.getLessonId(), lessonTitles.get(a.getLessonId()), a.getScore() == null ? 0 : a.getScore(), false)).limit(5).toList();
        int pendingAssignments = (int) states.stream().flatMap(s -> s.remaining().stream()).filter(l -> l.getLessonType() == LessonType.ASSIGNMENT).count();
        Instant now = Instant.now();
        List<CertState> certs = certificates.findByUserId(uid).stream().filter(c -> courseById.containsKey(c.getCourseId())).map(c -> new CertState(c.getCourseId(), courseById.get(c.getCourseId()).getTitle(),
                Boolean.TRUE.equals(c.getRevoked()) ? "REVOKED" : c.getExpiresAt() != null && c.getExpiresAt().isBefore(now) ? "EXPIRED" : c.getExpiresAt() != null && c.getExpiresAt().isBefore(now.plusSeconds(60L * 86400)) ? "EXPIRING" : "VALID", c.getExpiresAt())).toList();
        MyProgress me = analytics.me(u);
        Set<String> accessibleLessonIds = accessible.stream().flatMap(id -> orderedByCourse.getOrDefault(id, List.of()).stream()).map(Lesson::getId).collect(Collectors.toSet());
        return new Context(user, states, skillStates, journeys, available, weak, pendingAssignments, certs, me.recentActivity().stream().limit(MAX_ACTIVITY).toList(), me.streakDays(), accessible, accessibleLessonIds, lessonTitles, courseTitles);
    }

    public static int levelPct(int level) { return switch (level) { case 4 -> 80; case 3 -> 55; case 2 -> 25; default -> 0; }; }

    /** Compact JSON for prompts: bounded lists, titles + ids + numbers only. */
    public ObjectNode toJson(Context ctx, List<CoachEntities.Recommendation> recs) {
        ObjectNode o = Json.MAPPER.createObjectNode();
        ObjectNode learner = o.putObject("learner"); learner.put("id", ctx.user().getId()); learner.put("name", ctx.user().getName()); learner.put("streakDays", ctx.streakDays());
        ArrayNode cs = o.putArray("courses");
        for (CourseState s : ctx.courses()) {
            ObjectNode c = cs.addObject(); c.put("courseId", s.courseId()); c.put("title", s.title()); c.put("status", s.status()); c.put("pct", s.pct()); c.put("done", s.done()); c.put("total", s.total()); c.put("minutesLeft", s.minutesLeft());
            if (s.nextLesson() != null) { ObjectNode n = c.putObject("nextLesson"); n.put("lessonId", s.nextLesson().getId()); n.put("title", s.nextLesson().getTitle()); n.put("type", s.nextLesson().getLessonType().name().toLowerCase()); n.put("minutes", s.nextLesson().getDurationMin() == null ? 5 : s.nextLesson().getDurationMin()); }
            if (s.dueAt() != null) c.put("dueAt", s.dueAt().toString());
            if (s.lastActiveAt() != null) c.put("lastActiveAt", s.lastActiveAt().toString());
        }
        ArrayNode sk = o.putArray("skills");
        for (SkillState s : ctx.skills()) { ObjectNode x = sk.addObject(); x.put("skillId", s.skillId()); x.put("name", s.name()); x.put("level", s.levelLabel()); x.put("pct", s.pct()); x.put("target", s.targetLabel()); x.put("gapPct", s.gapPct()); }
        ArrayNode js = o.putArray("journeys");
        for (JourneyState j : ctx.journeys()) { ObjectNode x = js.addObject(); x.put("pathId", j.id()); x.put("title", j.title()); x.put("pct", j.pct()); if (j.nextCourseId() != null) { x.put("nextCourseId", j.nextCourseId()); x.put("nextCourseTitle", j.nextTitle()); } }
        ArrayNode av = o.putArray("availableCourses");
        for (AvailableCourse a : ctx.available()) { ObjectNode x = av.addObject(); x.put("courseId", a.courseId()); x.put("title", a.title()); x.put("minutes", a.minutes()); x.put("level", a.level()); ArrayNode ids = x.putArray("skillIds"); a.skillIds().forEach(ids::add); }
        ArrayNode qw = o.putArray("quizzesToRetake");
        for (QuizWeakness q : ctx.quizzes()) { ObjectNode x = qw.addObject(); x.put("courseId", q.courseId()); x.put("lessonId", q.lessonId()); x.put("lessonTitle", q.lessonTitle()); x.put("lastScore", q.score()); }
        o.put("pendingAssignments", ctx.pendingAssignments());
        ArrayNode ce = o.putArray("certificates");
        for (CertState c : ctx.certificates()) { ObjectNode x = ce.addObject(); x.put("courseId", c.courseId()); x.put("courseTitle", c.courseTitle()); x.put("status", c.status()); }
        ArrayNode ra = o.putArray("recentActivity");
        for (ActivityItem a : ctx.recent()) { ObjectNode x = ra.addObject(); x.put("at", a.at() == null ? "" : a.at().toString()); x.put("label", a.label()); }
        ArrayNode rs = o.putArray("recommendations");
        for (CoachEntities.Recommendation r : recs) { ObjectNode x = rs.addObject(); x.put("id", r.getId()); x.put("type", r.getType()); x.put("title", r.getTitle()); x.put("reason", r.getReason()); if (r.getCourseId() != null) x.put("courseId", r.getCourseId()); if (r.getLessonId() != null) x.put("lessonId", r.getLessonId()); if (r.getSkillId() != null) x.put("skillId", r.getSkillId()); if (r.getPathId() != null) x.put("pathId", r.getPathId()); if (r.getMinutes() != null) x.put("minutes", r.getMinutes()); }
        return o;
    }
}
