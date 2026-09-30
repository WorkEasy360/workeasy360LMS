package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.*;
import com.workeasy360.backend.domain.SkillEntities.*;
import com.workeasy360.backend.dto.AnalyticsDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Learning analytics computed on demand from the persisted rows (enrollments, lesson_progress, quiz_attempts,
 * submissions, certificates, user_skills) — there are no separate counters to drift out of sync.
 *
 * Query pattern: one query per table for the whole scope (`findByCourseIdIn`), plus a few JPQL aggregates,
 * instead of one query per course/learner. For the current data volume (hundreds of rows) that is a handful of
 * queries per request; aggregation tables would only be worth it at a much larger scale.
 *
 * Scope = who is asking: ADMIN sees the organisation, INSTRUCTOR only the courses they can edit
 * (PermissionService.canEditCourse), LEARNER only their own data (/me, /learners/{self}).
 *
 * Date range semantics: `from`/`to` restrict *events* (enrolments created or active, lessons completed, quiz
 * attempts, submissions, certificates issued). An enrolment is in range when it was created, active or
 * completed inside the range; progress/funnel state is then computed for those enrolments.
 */
@Service
@Transactional(readOnly = true)
public class AnalyticsService {
    private static final long DAY = 86400L;
    private final UserRepo users; private final CourseRepo courses; private final ModuleRepo modules; private final LessonRepo lessons;
    private final EnrollmentRepo enrollments; private final LessonProgressRepo progress; private final QuizAttemptRepo attempts;
    private final SubmissionRepo submissions; private final CertificateRepo certificates;
    private final UserSkillRepo userSkills; private final SkillRepo skills; private final SkillCategoryRepo categories; private final CourseSkillRepo courseSkills;
    private final PermissionService perm;
    private final GuideAnalyticsRepo guideEvents;
    private final CoachConversationRepo coachConversations; private final CoachMessageRepo coachMessages; private final LearningPlanRepo learningPlans;
    private final RecommendationRepo recommendations; private final RecommendationFeedbackRepo recommendationFeedback; private final AiGenerationRepo aiGenerations;

    public AnalyticsService(UserRepo users, CourseRepo courses, ModuleRepo modules, LessonRepo lessons, EnrollmentRepo enrollments,
                            LessonProgressRepo progress, QuizAttemptRepo attempts, SubmissionRepo submissions, CertificateRepo certificates,
                            UserSkillRepo userSkills, SkillRepo skills, SkillCategoryRepo categories, CourseSkillRepo courseSkills, PermissionService perm,
                            GuideAnalyticsRepo guideEvents, CoachConversationRepo coachConversations, CoachMessageRepo coachMessages, LearningPlanRepo learningPlans,
                            RecommendationRepo recommendations, RecommendationFeedbackRepo recommendationFeedback, AiGenerationRepo aiGenerations) {
        this.users = users; this.courses = courses; this.modules = modules; this.lessons = lessons; this.enrollments = enrollments;
        this.progress = progress; this.attempts = attempts; this.submissions = submissions; this.certificates = certificates;
        this.userSkills = userSkills; this.skills = skills; this.categories = categories; this.courseSkills = courseSkills; this.perm = perm;
        this.guideEvents = guideEvents; this.coachConversations = coachConversations; this.coachMessages = coachMessages; this.learningPlans = learningPlans;
        this.recommendations = recommendations; this.recommendationFeedback = recommendationFeedback; this.aiGenerations = aiGenerations;
    }

    /** Privacy-safe adoption aggregates for the Coach, recommendations, plans and AI authoring: counts only, no message content, no per-user rows. */
    public record CoachAnalytics(long conversations, long messages, long learnerMessages, long distinctCoachUsers, long plans, long plansStarted, long plansCompleted,
                                 Map<String, Long> recommendationsByStatus, Map<String, Long> recommendationsByType, Map<String, Long> feedback,
                                 long aiGenerations, Map<String, Long> aiByType, Map<String, Long> aiByStatus) {}
    public CoachAnalytics coach(CurrentUser u) {
        if (!perm.isAdmin(u)) throw ApiException.forbidden("Coach analytics are available to administrators");
        var convs = coachConversations.findAll(); var msgs = coachMessages.findAll(); var plans = learningPlans.findAll();
        var recs = recommendations.findAll(); var fb = recommendationFeedback.findAll(); var gens = aiGenerations.findAll();
        Function<java.util.stream.Stream<String>, Map<String, Long>> count = s -> s.collect(Collectors.groupingBy(x -> x, TreeMap::new, Collectors.counting()));
        return new CoachAnalytics(convs.size(), msgs.size(), msgs.stream().filter(m -> "user".equalsIgnoreCase(m.getRole())).count(),
                convs.stream().map(c -> c.getUserId()).distinct().count(),
                plans.size(), plans.stream().filter(p -> p.getStartedAt() != null).count(), plans.stream().filter(p -> p.getCompletedAt() != null).count(),
                count.apply(recs.stream().map(r -> r.getStatus())), count.apply(recs.stream().map(r -> r.getType())), count.apply(fb.stream().map(f -> f.getValue())),
                gens.size(), count.apply(gens.stream().map(g -> String.valueOf(g.getType()))), count.apply(gens.stream().map(g -> String.valueOf(g.getStatus()))));
    }

    // ---------------------------------------------------------------- scope + data bundle
    record Scope(List<Course> courses, boolean org) {
        Set<String> ids() { return courses.stream().map(Course::getId).collect(Collectors.toCollection(LinkedHashSet::new)); }
    }

    Scope scope(CurrentUser u, String courseId) {
        if (u.getRole() == Role.LEARNER) throw ApiException.forbidden("Learner analytics are only available for your own progress");
        if (courseId != null) {
            Course c = courses.findById(courseId).orElseThrow(() -> ApiException.notFound("Course"));
            if (!perm.canViewAnalytics(u, c)) throw ApiException.forbidden("You can only view analytics for courses you manage");
            return new Scope(List.of(c), false);
        }
        List<Course> all = courses.findAll().stream().filter(c -> perm.isAdmin(u) || perm.canEditCourse(u, c)).toList();
        return new Scope(all, perm.isAdmin(u));
    }

    private static boolean inRange(Instant t, Filters f) {
        if (t == null) return false;
        return (f.from() == null || !t.isBefore(f.from())) && (f.to() == null || !t.isAfter(f.to()));
    }
    private static boolean hasRange(Filters f) { return f.from() != null || f.to() != null; }

    /** Everything a scope needs, fetched with one query per table. */
    class Data {
        final Map<String, Course> courseById = new LinkedHashMap<>();
        final Map<String, List<Lesson>> lessonsByCourse = new HashMap<>();
        final Map<String, Lesson> lessonById = new HashMap<>();
        final List<Enrollment> enrollments; final List<LessonProgress> progressRows; final List<QuizAttempt> quizAttempts;
        final List<Submission> subs; final List<Certificate> certs; final Map<String, User> userById = new HashMap<>();
        final Filters f;

        Data(Scope s, Filters f, boolean allEnrollmentsForState) {
            this.f = f;
            s.courses().forEach(c -> courseById.put(c.getId(), c));
            Set<String> ids = courseById.keySet();
            List<CourseModule> mods = ids.isEmpty() ? List.of() : modules.findByCourseIdIn(ids);
            Map<String, List<CourseModule>> modsByCourse = mods.stream().collect(Collectors.groupingBy(CourseModule::getCourseId));
            Map<String, List<Lesson>> lessonsByModule = mods.isEmpty() ? Map.of() : lessons.findByModuleIdIn(mods.stream().map(CourseModule::getId).toList()).stream().collect(Collectors.groupingBy(Lesson::getModuleId));
            for (String cid : ids) {
                List<Lesson> ordered = new ArrayList<>();
                modsByCourse.getOrDefault(cid, List.of()).stream().sorted(Comparator.comparingInt(CourseModule::getPosition))
                        .forEach(m -> lessonsByModule.getOrDefault(m.getId(), List.of()).stream().sorted(Comparator.comparingInt(Lesson::getPosition)).forEach(ordered::add));
                lessonsByCourse.put(cid, ordered);
                ordered.forEach(l -> lessonById.put(l.getId(), l));
            }
            List<Enrollment> allEn = ids.isEmpty() ? List.of() : AnalyticsService.this.enrollments.findByCourseIdIn(ids);
            List<Enrollment> en = new ArrayList<>(hasRange(f) && !allEnrollmentsForState ? allEn.stream().filter(e -> inRange(e.getEnrolledAt(), f) || inRange(e.getLastActiveAt(), f) || inRange(e.getCompletedAt(), f)).toList() : allEn);
            if (f.userId() != null) en.removeIf(e -> !e.getUserId().equals(f.userId()));
            this.enrollments = en;
            Set<String> userIds = en.stream().map(Enrollment::getUserId).collect(Collectors.toSet());
            List<LessonProgress> allProgress = ids.isEmpty() ? List.of() : AnalyticsService.this.progress.findByCourseIdIn(ids);
            progressRows = allProgress.stream().filter(p -> f.userId() == null || p.getUserId().equals(f.userId())).toList();
            quizAttempts = (ids.isEmpty() ? List.<QuizAttempt>of() : AnalyticsService.this.attempts.findByCourseIdIn(ids)).stream().filter(a -> (!hasRange(f) || inRange(a.getSubmittedAt(), f)) && (f.userId() == null || a.getUserId().equals(f.userId()))).toList();
            subs = (ids.isEmpty() ? List.<Submission>of() : AnalyticsService.this.submissions.findByCourseIdIn(ids)).stream().filter(x -> x.getStatus() != SubmissionStatus.DRAFT && (!hasRange(f) || inRange(x.getSubmittedAt(), f)) && (f.userId() == null || x.getUserId().equals(f.userId()))).toList();
            certs = (ids.isEmpty() ? List.<Certificate>of() : AnalyticsService.this.certificates.findByCourseIdIn(ids)).stream().filter(c -> (!hasRange(f) || inRange(c.getIssuedAt(), f)) && (f.userId() == null || c.getUserId().equals(f.userId()))).toList();
            if (!userIds.isEmpty()) users.findAllById(userIds).forEach(u -> userById.put(u.getId(), u));
        }

        /** Completed lesson ids per (user, course) — from persisted lesson_progress rows (state, not events). */
        Map<String, Set<String>> completedByKey() {
            Map<String, Set<String>> m = new HashMap<>();
            for (LessonProgress p : progressRows) if (p.getStatus() == ProgressStatus.COMPLETED && lessonById.containsKey(p.getLessonId()))
                m.computeIfAbsent(p.getUserId() + ":" + p.getCourseId(), k -> new HashSet<>()).add(p.getLessonId());
            return m;
        }
        int lessonCount(String courseId) { return lessonsByCourse.getOrDefault(courseId, List.of()).size(); }
        int progressPct(Enrollment e, Map<String, Set<String>> completed) {
            int total = lessonCount(e.getCourseId());
            if (e.getCompletedAt() != null) return 100;
            if (total == 0) return 0;
            return Math.min(100, Math.round(completed.getOrDefault(e.getUserId() + ":" + e.getCourseId(), Set.of()).size() * 100f / total));
        }
    }

    private static int pct(long n, long d) { return d == 0 ? 0 : (int) Math.round(n * 100.0 / d); }
    private static int avg(List<Integer> xs) { return xs.isEmpty() ? 0 : (int) Math.round(xs.stream().mapToInt(Integer::intValue).average().orElse(0)); }
    private static String day(Instant t) { return t == null ? null : LocalDate.ofInstant(t, ZoneOffset.UTC).toString(); }

    private String certStatus(Certificate c) {
        if (Boolean.TRUE.equals(c.getRevoked())) return "REVOKED";
        Instant now = Instant.now();
        if (c.getExpiresAt() != null && c.getExpiresAt().isBefore(now)) return "EXPIRED";
        if (c.getExpiresAt() != null && c.getExpiresAt().isBefore(now.plusSeconds(60 * DAY))) return "EXPIRING";
        return "VALID";
    }

    private List<DayPoint> series(Data d, Filters f) {
        Instant to = f.to() != null ? f.to() : Instant.now();
        Instant from = f.from() != null ? f.from() : to.minusSeconds(29 * DAY);
        LocalDate start = LocalDate.ofInstant(from, ZoneOffset.UTC), end = LocalDate.ofInstant(to, ZoneOffset.UTC);
        if (ChronoUnit.DAYS.between(start, end) > 366) start = end.minusDays(366);
        Map<String, int[]> byDay = new TreeMap<>();
        for (LocalDate x = start; !x.isAfter(end); x = x.plusDays(1)) byDay.put(x.toString(), new int[5]);
        Map<String, Set<String>> activeUsers = new HashMap<>();
        var bump = new Object() { void at(Instant t, int i, String userId) { String k = day(t); if (k != null && byDay.containsKey(k)) { byDay.get(k)[i]++; if (userId != null) activeUsers.computeIfAbsent(k, z -> new HashSet<>()).add(userId); } } };
        for (LessonProgress p : d.progressRows) if (p.getStatus() == ProgressStatus.COMPLETED) bump.at(p.getCompletedAt(), 0, p.getUserId());
        for (QuizAttempt a : d.quizAttempts) bump.at(a.getSubmittedAt(), 1, a.getUserId());
        for (Submission s : d.subs) bump.at(s.getSubmittedAt(), 2, s.getUserId());
        for (Enrollment e : d.enrollments) { bump.at(e.getEnrolledAt(), 3, e.getUserId()); bump.at(e.getLastActiveAt(), 4, e.getUserId()); }
        return byDay.entrySet().stream().map(en -> new DayPoint(en.getKey(), en.getValue()[0], en.getValue()[1], en.getValue()[2], en.getValue()[3], activeUsers.getOrDefault(en.getKey(), Set.of()).size())).toList();
    }

    private List<FunnelStage> funnel(Data d, Collection<Enrollment> es, Map<String, Set<String>> completed) {
        int enrolled = es.size();
        int started = (int) es.stream().filter(e -> e.getStartedAt() != null && (e.getCompletedAt() != null || !completed.getOrDefault(e.getUserId() + ":" + e.getCourseId(), Set.of()).isEmpty() || e.getLastLessonId() != null)).count();
        int completedN = (int) es.stream().filter(e -> e.getCompletedAt() != null).count();
        int progressing = (int) es.stream().filter(e -> e.getCompletedAt() == null && !completed.getOrDefault(e.getUserId() + ":" + e.getCourseId(), Set.of()).isEmpty()).count();
        Set<String> certKeys = d.certs.stream().filter(c -> !Boolean.TRUE.equals(c.getRevoked())).map(c -> c.getUserId() + ":" + c.getCourseId()).collect(Collectors.toSet());
        int certified = (int) es.stream().filter(e -> certKeys.contains(e.getUserId() + ":" + e.getCourseId())).count();
        return List.of(new FunnelStage("Enrolled", enrolled, 100), new FunnelStage("Started", started, pct(started, enrolled)),
                new FunnelStage("Progressing", progressing + completedN, pct(progressing + completedN, enrolled)), new FunnelStage("Completed", completedN, pct(completedN, enrolled)),
                new FunnelStage("Certified", certified, pct(certified, enrolled)));
    }

    private List<Bucket> distribution(List<Integer> pcts) {
        int[] b = new int[6];
        for (int p : pcts) b[p == 0 ? 0 : p <= 25 ? 1 : p <= 50 ? 2 : p <= 75 ? 3 : p < 100 ? 4 : 5]++;
        String[] labels = { "Not started", "1–25%", "26–50%", "51–75%", "76–99%", "Completed" };
        List<Bucket> out = new ArrayList<>();
        for (int i = 0; i < 6; i++) out.add(new Bucket(labels[i], b[i]));
        return out;
    }

    // ---------------------------------------------------------------- overview
    public Overview overview(CurrentUser u, Filters f) {
        Scope s = scope(u, f.courseId());
        if (f.status() != null) s = new Scope(s.courses().stream().filter(c -> c.getStatus().name().equalsIgnoreCase(f.status())).toList(), s.org());
        Data d = new Data(s, f, false);
        Map<String, Set<String>> completed = d.completedByKey();
        Instant activeSince = f.from() != null ? f.from() : Instant.now().minusSeconds(7 * DAY);
        Set<String> enrolledUsers = d.enrollments.stream().map(Enrollment::getUserId).collect(Collectors.toSet());
        int totalLearners = s.org() ? users.findByRole(Role.LEARNER).size() : enrolledUsers.size();
        int active = (int) d.enrollments.stream().filter(e -> e.getLastActiveAt() != null && !e.getLastActiveAt().isBefore(activeSince) && (f.to() == null || !e.getLastActiveAt().isAfter(f.to()))).map(Enrollment::getUserId).distinct().count();
        int completions = (int) d.enrollments.stream().filter(e -> e.getCompletedAt() != null && (!hasRange(f) || inRange(e.getCompletedAt(), f))).count();
        long lessonSlots = d.enrollments.stream().mapToLong(e -> d.lessonCount(e.getCourseId())).sum();
        long lessonsDone = d.progressRows.stream().filter(p -> p.getStatus() == ProgressStatus.COMPLETED && d.lessonById.containsKey(p.getLessonId()) && (!hasRange(f) || inRange(p.getCompletedAt(), f))).count();
        List<Integer> pcts = d.enrollments.stream().map(e -> d.progressPct(e, completed)).toList();
        int passed = (int) d.quizAttempts.stream().filter(a -> Boolean.TRUE.equals(a.getPassed())).count();
        int reviewed = (int) d.subs.stream().filter(x -> x.getStatus() == SubmissionStatus.REVIEWED).count();
        int expiring = (int) d.certs.stream().filter(c -> certStatus(c).equals("EXPIRING")).count();
        int expired = (int) d.certs.stream().filter(c -> certStatus(c).equals("EXPIRED")).count();
        List<UserSkill> skillRows = s.org() ? userSkills.findAll() : enrolledUsers.isEmpty() ? List.of() : userSkills.findByUserIdIn(enrolledUsers);
        if (!s.org()) { Set<String> mapped = courseSkills.findAll().stream().filter(cs -> d.courseById.containsKey(cs.getCourseId())).map(CourseSkill::getSkillId).collect(Collectors.toSet()); skillRows = skillRows.stream().filter(r -> mapped.contains(r.getSkillId())).toList(); }
        return new Overview(s.org() ? "organisation" : f.courseId() != null ? "course" : "my-courses",
                (int) s.courses().stream().filter(c -> c.getStatus() == CourseStatus.PUBLISHED).count(), s.courses().size(),
                totalLearners, active, enrolledUsers.size(),
                d.enrollments.size(), completions, pct(completions, d.enrollments.size()), pct(lessonsDone, lessonSlots), avg(pcts),
                d.quizAttempts.size(), pct(passed, d.quizAttempts.size()), avg(d.quizAttempts.stream().map(QuizAttempt::getScore).filter(Objects::nonNull).toList()),
                d.subs.size(), reviewed, pct(reviewed, d.subs.size()),
                d.certs.size(), expiring, expired,
                (int) skillRows.stream().map(UserSkill::getSkillId).distinct().count(), avg(skillRows.stream().map(UserSkill::getProgressPercentage).toList()),
                series(d, f), distribution(pcts), funnel(d, d.enrollments, completed));
    }

    // ---------------------------------------------------------------- courses
    public List<CourseAnalytics> courses(CurrentUser u, Filters f) {
        Scope s = scope(u, f.courseId());
        if (f.status() != null) s = new Scope(s.courses().stream().filter(c -> c.getStatus().name().equalsIgnoreCase(f.status())).toList(), s.org());
        Data d = new Data(s, f, false);
        Map<String, Set<String>> completed = d.completedByKey();
        return s.courses().stream().map(c -> courseAnalytics(d, c, completed, false)).sorted(Comparator.comparingInt(CourseAnalytics::enrolled).reversed()).toList();
    }

    public CourseAnalytics course(CurrentUser u, String courseId, Filters f) {
        Scope s = scope(u, courseId);
        Data d = new Data(s, f, false);
        return courseAnalytics(d, s.courses().get(0), d.completedByKey(), true);
    }

    private CourseAnalytics courseAnalytics(Data d, Course c, Map<String, Set<String>> completed, boolean detail) {
        List<Enrollment> es = d.enrollments.stream().filter(e -> e.getCourseId().equals(c.getId())).toList();
        List<Lesson> ls = d.lessonsByCourse.getOrDefault(c.getId(), List.of());
        List<QuizAttempt> qa = d.quizAttempts.stream().filter(a -> a.getCourseId().equals(c.getId())).toList();
        List<Submission> ss = d.subs.stream().filter(x -> x.getCourseId().equals(c.getId())).toList();
        List<FunnelStage> fun = funnel(d, es, completed);
        int completedN = fun.get(3).count(), started = fun.get(1).count();
        int inProgress = (int) es.stream().filter(e -> e.getCompletedAt() == null && !completed.getOrDefault(e.getUserId() + ":" + c.getId(), Set.of()).isEmpty()).count();
        int passed = (int) qa.stream().filter(a -> Boolean.TRUE.equals(a.getPassed())).count();
        int reviewed = (int) ss.stream().filter(x -> x.getStatus() == SubmissionStatus.REVIEWED).count();
        Instant since = Instant.now().minusSeconds(7 * DAY);
        int active = (int) es.stream().filter(e -> e.getLastActiveAt() != null && e.getLastActiveAt().isAfter(since)).map(Enrollment::getUserId).distinct().count();
        Instant last = es.stream().map(Enrollment::getLastActiveAt).filter(Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
        List<LessonStat> lessonStats = new ArrayList<>();
        int prev = -1;
        for (int i = 0; i < ls.size(); i++) {
            Lesson l = ls.get(i);
            int n = (int) es.stream().filter(e -> completed.getOrDefault(e.getUserId() + ":" + c.getId(), Set.of()).contains(l.getId())).count();
            int p = pct(n, es.size());
            lessonStats.add(new LessonStat(l.getId(), l.getTitle(), l.getLessonType().name().toLowerCase(), i, n, p, prev < 0 ? 0 : Math.max(0, prev - p)));
            prev = p;
        }
        List<LearnerRow> rows = !detail ? List.of() : es.stream().map(e -> {
            User usr = d.userById.get(e.getUserId());
            int p = d.progressPct(e, completed);
            return new LearnerRow(e.getUserId(), usr != null ? usr.getName() : e.getUserId(), usr != null ? usr.getDept() : null, p, e.getCompletedAt() != null ? "completed" : p > 0 ? "in-progress" : "not-started", e.getLastActiveAt());
        }).sorted(Comparator.comparing((LearnerRow r) -> r.lastActiveAt() == null ? Instant.EPOCH : r.lastActiveAt()).reversed()).toList();
        List<DayPoint> act = !detail ? List.of() : series(new Data(new Scope(List.of(c), false), d.f, false), d.f);
        return new CourseAnalytics(c.getId(), c.getTitle(), c.getStatus().name(), c.getInstructorId(), c.getUpdatedAt(),
                es.size(), started, inProgress, completedN, fun.get(4).count(), pct(completedN, es.size()), avg(es.stream().map(e -> d.progressPct(e, completed)).toList()),
                qa.size(), pct(passed, qa.size()), avg(qa.stream().map(QuizAttempt::getScore).filter(Objects::nonNull).toList()),
                ss.size(), reviewed, pct(reviewed, ss.size()), active, last, fun, lessonStats, act, rows);
    }

    // ---------------------------------------------------------------- learners
    public List<LearnerAnalytics> learners(CurrentUser u, Filters f) {
        Scope s = scope(u, f.courseId());
        Data d = new Data(s, f, false);
        Map<String, Set<String>> completed = d.completedByKey();
        Set<String> ids = d.enrollments.stream().map(Enrollment::getUserId).collect(Collectors.toCollection(LinkedHashSet::new));
        List<User> people = s.org() && f.courseId() == null && !hasRange(f) ? users.findByRole(Role.LEARNER) : users.findAllById(ids);
        return people.stream().filter(p -> p.getRole() == Role.LEARNER).map(p -> learnerAnalytics(d, p, completed, false)).sorted(Comparator.comparing(LearnerAnalytics::name)).toList();
    }

    public LearnerAnalytics learner(CurrentUser u, String userId, Filters f) {
        User target = users.findById(userId).orElseThrow(() -> ApiException.notFound("User"));
        Scope s;
        if (u.getId().equals(userId) || perm.isAdmin(u)) s = new Scope(courses.findAll(), true);
        else if (u.getRole() == Role.INSTRUCTOR) {
            List<Course> mine = courses.findAll().stream().filter(c -> perm.canEditCourse(u, c)).toList();
            boolean enrolledWithMe = enrollments.findByUserId(userId).stream().anyMatch(e -> mine.stream().anyMatch(c -> c.getId().equals(e.getCourseId())));
            if (!enrolledWithMe) throw ApiException.forbidden("This learner is not enrolled in any course you manage");
            s = new Scope(mine, false); // only the instructor's own courses are ever disclosed
        } else throw ApiException.forbidden("You can only view your own progress");
        Data d = new Data(s, new Filters(f.from(), f.to(), null, userId, f.skillId(), null), false);
        return learnerAnalytics(d, target, d.completedByKey(), true);
    }

    private LearnerAnalytics learnerAnalytics(Data d, User p, Map<String, Set<String>> completed, boolean detail) {
        List<Enrollment> es = d.enrollments.stream().filter(e -> e.getUserId().equals(p.getId())).toList();
        List<QuizAttempt> qa = d.quizAttempts.stream().filter(a -> a.getUserId().equals(p.getId())).toList();
        List<Submission> ss = d.subs.stream().filter(x -> x.getUserId().equals(p.getId())).toList();
        List<Certificate> cs = d.certs.stream().filter(x -> x.getUserId().equals(p.getId())).toList();
        int passed = (int) qa.stream().filter(a -> Boolean.TRUE.equals(a.getPassed())).count();
        int reviewed = (int) ss.stream().filter(x -> x.getStatus() == SubmissionStatus.REVIEWED).count();
        Instant last = es.stream().map(Enrollment::getLastActiveAt).filter(Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
        List<LearnerCourse> lcs = es.stream().map(e -> learnerCourse(d, e, completed)).sorted(Comparator.comparing((LearnerCourse x) -> x.lastActiveAt() == null ? Instant.EPOCH : x.lastActiveAt()).reversed()).toList();
        int lessonsDone = completed.entrySet().stream().filter(en -> en.getKey().startsWith(p.getId() + ":")).mapToInt(en -> en.getValue().size()).sum();
        List<LearnerSkill> sk = !detail ? List.of() : learnerSkills(p.getId(), d.courseById.keySet(), d.f.skillId());
        List<CertificateRow> certRows = !detail ? List.of() : cs.stream().map(c -> new CertificateRow(c.getCertificateNumber(), c.getCourseId(), Optional.ofNullable(d.courseById.get(c.getCourseId())).map(Course::getTitle).orElse(c.getCourseId()), certStatus(c), c.getIssuedAt(), c.getExpiresAt())).toList();
        return new LearnerAnalytics(p.getId(), p.getName(), p.getDept(), p.getTitle(),
                es.size(), (int) es.stream().filter(e -> e.getCompletedAt() != null).count(), (int) lcs.stream().filter(x -> x.status().equals("in-progress")).count(),
                avg(es.stream().map(e -> d.progressPct(e, completed)).toList()), last,
                lessonsDone, qa.size(), pct(passed, qa.size()), avg(qa.stream().map(QuizAttempt::getScore).filter(Objects::nonNull).toList()),
                ss.size(), reviewed, cs.size(), lcs, sk, certRows, detail ? recentActivity(d, p.getId(), 12) : List.of());
    }

    private LearnerCourse learnerCourse(Data d, Enrollment e, Map<String, Set<String>> completed) {
        Course c = d.courseById.get(e.getCourseId());
        int p = d.progressPct(e, completed);
        Set<String> done = completed.getOrDefault(e.getUserId() + ":" + e.getCourseId(), Set.of());
        Lesson next = d.lessonsByCourse.getOrDefault(e.getCourseId(), List.of()).stream().filter(l -> !done.contains(l.getId())).findFirst().orElse(null);
        return new LearnerCourse(e.getCourseId(), c != null ? c.getTitle() : e.getCourseId(), p, e.getCompletedAt() != null ? "completed" : p > 0 ? "in-progress" : "not-started",
                e.getLastActiveAt(), e.getCompletedAt(), next != null ? next.getId() : null, next != null ? next.getTitle() : null);
    }

    private List<LearnerSkill> learnerSkills(String userId, Set<String> courseScope, String skillId) {
        Map<String, Skill> byId = skills.findAll().stream().collect(Collectors.toMap(Skill::getId, Function.identity()));
        Map<String, String> catNames = categories.findAll().stream().collect(Collectors.toMap(SkillCategory::getId, SkillCategory::getName));
        Set<String> allowed = courseSkills.findAll().stream().filter(cs -> courseScope.contains(cs.getCourseId())).map(CourseSkill::getSkillId).collect(Collectors.toSet());
        Instant recent = Instant.now().minusSeconds(14 * DAY);
        return userSkills.findByUserId(userId).stream().filter(r -> byId.containsKey(r.getSkillId()) && allowed.contains(r.getSkillId()) && (skillId == null || r.getSkillId().equals(skillId))).map(r -> {
            Skill s = byId.get(r.getSkillId());
            int lvl = r.getCurrentLevel() == null ? 1 : r.getCurrentLevel();
            return new LearnerSkill(s.getId(), s.getName(), catNames.getOrDefault(s.getCategoryId(), "General"), r.getProgressPercentage(), lvl, SkillService.LEVEL_LABELS[Math.max(1, Math.min(4, lvl))],
                    r.getUpdatedAt() != null && r.getUpdatedAt().isAfter(recent) && r.getProgressPercentage() > 0 && r.getProgressPercentage() < 100);
        }).sorted(Comparator.comparingInt(LearnerSkill::progress).reversed()).toList();
    }

    private List<ActivityItem> recentActivity(Data d, String userId, int limit) {
        List<ActivityItem> items = new ArrayList<>();
        for (LessonProgress p : d.progressRows) if (p.getUserId().equals(userId) && p.getStatus() == ProgressStatus.COMPLETED && p.getCompletedAt() != null) {
            Lesson l = d.lessonById.get(p.getLessonId()); items.add(new ActivityItem(p.getCompletedAt(), "lesson", "Completed " + (l != null ? l.getTitle() : "a lesson"), p.getCourseId()));
        }
        for (QuizAttempt a : d.quizAttempts) if (a.getUserId().equals(userId)) items.add(new ActivityItem(a.getSubmittedAt(), "quiz", (Boolean.TRUE.equals(a.getPassed()) ? "Passed" : "Attempted") + " quiz" + (a.getScore() != null ? " · " + a.getScore() + "%" : ""), a.getCourseId()));
        for (Submission s : d.subs) if (s.getUserId().equals(userId)) items.add(new ActivityItem(s.getSubmittedAt(), "assignment", s.getStatus() == SubmissionStatus.REVIEWED ? "Assignment reviewed" : "Assignment submitted", s.getCourseId()));
        for (Certificate c : d.certs) if (c.getUserId().equals(userId)) items.add(new ActivityItem(c.getIssuedAt(), "certificate", "Earned certificate " + c.getCertificateNumber(), c.getCourseId()));
        for (Enrollment e : d.enrollments) if (e.getUserId().equals(userId)) {
            String title = Optional.ofNullable(d.courseById.get(e.getCourseId())).map(Course::getTitle).orElse("a course");
            items.add(new ActivityItem(e.getEnrolledAt(), "enrolled", "Enrolled in " + title, e.getCourseId()));
            if (e.getCompletedAt() != null) items.add(new ActivityItem(e.getCompletedAt(), "course", "Finished " + title, e.getCourseId()));
        }
        return items.stream().filter(i -> i.at() != null).sorted(Comparator.comparing(ActivityItem::at).reversed()).limit(limit).toList();
    }

    // ---------------------------------------------------------------- skills
    public List<SkillAnalytics> skills(CurrentUser u, Filters f) {
        Map<String, String> catNames = categories.findAll().stream().collect(Collectors.toMap(SkillCategory::getId, SkillCategory::getName));
        List<Skill> lib = skills.findAll().stream().filter(Skill::getActive).toList();
        List<UserSkill> rows;
        Set<String> allowedSkills;
        Map<String, Long> coursesPerSkill = courseSkills.findAll().stream().collect(Collectors.groupingBy(CourseSkill::getSkillId, Collectors.counting()));
        if (u.getRole() == Role.LEARNER) { rows = userSkills.findByUserId(u.getId()); allowedSkills = rows.stream().map(UserSkill::getSkillId).collect(Collectors.toSet()); }
        else {
            Scope s = scope(u, f.courseId());
            if (s.org()) { rows = userSkills.findAll(); allowedSkills = lib.stream().map(Skill::getId).collect(Collectors.toSet()); }
            else {
                Set<String> ids = s.ids();
                Set<String> learnerIds = (ids.isEmpty() ? List.<Enrollment>of() : enrollments.findByCourseIdIn(ids)).stream().map(Enrollment::getUserId).collect(Collectors.toSet());
                rows = learnerIds.isEmpty() ? List.of() : userSkills.findByUserIdIn(learnerIds);
                allowedSkills = courseSkills.findAll().stream().filter(cs -> ids.contains(cs.getCourseId())).map(CourseSkill::getSkillId).collect(Collectors.toSet());
            }
        }
        Instant recent = Instant.now().minusSeconds(14 * DAY);
        Map<String, List<UserSkill>> bySkill = rows.stream().collect(Collectors.groupingBy(UserSkill::getSkillId));
        return lib.stream().filter(s -> allowedSkills.contains(s.getId()) && (f.skillId() == null || s.getId().equals(f.skillId()))).map(s -> {
            List<UserSkill> rs = bySkill.getOrDefault(s.getId(), List.of());
            Map<String, Integer> dist = new LinkedHashMap<>();
            for (int i = 1; i <= 4; i++) { final int lvl = i; dist.put(SkillService.LEVEL_LABELS[i], (int) rs.stream().filter(r -> (r.getCurrentLevel() == null ? 1 : r.getCurrentLevel()) == lvl).count()); }
            int improving = (int) rs.stream().filter(r -> r.getUpdatedAt() != null && r.getUpdatedAt().isAfter(recent) && r.getProgressPercentage() > 0 && r.getProgressPercentage() < 100).count();
            return new SkillAnalytics(s.getId(), s.getName(), catNames.getOrDefault(s.getCategoryId(), "General"), rs.size(), avg(rs.stream().map(UserSkill::getProgressPercentage).toList()), improving, coursesPerSkill.getOrDefault(s.getId(), 0L).intValue(), dist);
        }).sorted(Comparator.comparingInt(SkillAnalytics::learners).reversed()).toList();
    }

    // ---------------------------------------------------------------- activity
    public List<DayPoint> activity(CurrentUser u, Filters f) {
        if (u.getRole() == Role.LEARNER || (f.userId() != null && f.userId().equals(u.getId()))) {
            Data d = new Data(new Scope(courses.findAll(), true), new Filters(f.from(), f.to(), f.courseId(), u.getId(), null, null), false);
            return series(d, f);
        }
        if (f.userId() != null) learner(u, f.userId(), f); // authorisation check for someone else's data
        Data d = new Data(scope(u, f.courseId()), f, false);
        return series(d, f);
    }

    // ---------------------------------------------------------------- my progress (any signed-in user, own data only)
    public MyProgress me(CurrentUser u) {
        User p = users.findById(u.getId()).orElseThrow(() -> ApiException.notFound("User"));
        Filters none = new Filters(null, null, null, u.getId(), null, null);
        Data d = new Data(new Scope(courses.findAll(), true), none, true);
        Map<String, Set<String>> completed = d.completedByKey();
        LearnerAnalytics la = learnerAnalytics(d, p, completed, true);
        // streak: consecutive UTC days (ending today or yesterday) with at least one recorded learning event
        Set<LocalDate> days = new HashSet<>();
        for (LessonProgress x : d.progressRows) if (x.getStatus() == ProgressStatus.COMPLETED && x.getCompletedAt() != null) days.add(LocalDate.ofInstant(x.getCompletedAt(), ZoneOffset.UTC));
        for (QuizAttempt a : d.quizAttempts) if (a.getSubmittedAt() != null) days.add(LocalDate.ofInstant(a.getSubmittedAt(), ZoneOffset.UTC));
        for (Submission s : d.subs) days.add(LocalDate.ofInstant(s.getSubmittedAt(), ZoneOffset.UTC));
        for (Enrollment e : d.enrollments) if (e.getLastActiveAt() != null) days.add(LocalDate.ofInstant(e.getLastActiveAt(), ZoneOffset.UTC));
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        LocalDate cursor = days.contains(today) ? today : days.contains(today.minusDays(1)) ? today.minusDays(1) : null;
        int streak = 0;
        while (cursor != null && days.contains(cursor)) { streak++; cursor = cursor.minusDays(1); }
        int active30 = (int) days.stream().filter(x -> !x.isBefore(today.minusDays(29))).count();
        int minutes = completed.entrySet().stream().filter(en -> en.getKey().startsWith(u.getId() + ":")).flatMap(en -> en.getValue().stream()).map(d.lessonById::get).filter(Objects::nonNull).mapToInt(l -> l.getDurationMin() == null ? 0 : l.getDurationMin()).sum();
        List<LearnerCourse> inProgress = la.courses().stream().filter(c -> !c.status().equals("completed")).toList();
        List<LearnerCourse> done = la.courses().stream().filter(c -> c.status().equals("completed")).toList();
        List<LearnerSkill> sk = learnerSkills(u.getId(), d.courseById.keySet(), null);
        NextAction next = nextAction(d, inProgress);
        Filters last30 = new Filters(Instant.now().minusSeconds(29 * DAY), null, null, u.getId(), null, null);
        return new MyProgress(streak, active30, la.lessonsCompleted(), minutes, la.avgProgress(), inProgress.size(), done.size(), la.certificates(),
                (int) sk.stream().filter(LearnerSkill::improving).count(), inProgress, done, sk, la.certificateList(), la.recentActivity(), series(d, last30), next);
    }

    /** Deterministic: the soonest due course first, else the most recently active course, else something not started, else explore. */
    private NextAction nextAction(Data d, List<LearnerCourse> inProgress) {
        Map<String, Enrollment> byCourse = d.enrollments.stream().collect(Collectors.toMap(Enrollment::getCourseId, e -> e, (a, b) -> a));
        Optional<LearnerCourse> due = inProgress.stream().filter(c -> byCourse.get(c.courseId()) != null && byCourse.get(c.courseId()).getDueAt() != null).min(Comparator.comparing(c -> byCourse.get(c.courseId()).getDueAt()));
        if (due.isPresent()) { LearnerCourse c = due.get(); long days = Math.max(0, ChronoUnit.DAYS.between(Instant.now(), byCourse.get(c.courseId()).getDueAt())); return new NextAction((c.progress() > 0 ? "Continue " : "Start ") + c.title(), "/learn/" + c.courseId() + (c.nextLessonId() != null ? "/" + c.nextLessonId() : ""), "Due in " + days + " day" + (days == 1 ? "" : "s") + " · " + c.progress() + "% complete"); }
        Optional<LearnerCourse> recent = inProgress.stream().filter(c -> c.progress() > 0).findFirst();
        if (recent.isPresent()) { LearnerCourse c = recent.get(); return new NextAction("Continue " + c.title(), "/learn/" + c.courseId() + (c.nextLessonId() != null ? "/" + c.nextLessonId() : ""), (c.nextLessonTitle() != null ? "Next lesson: " + c.nextLessonTitle() + " · " : "") + c.progress() + "% complete"); }
        Optional<LearnerCourse> fresh = inProgress.stream().findFirst();
        if (fresh.isPresent()) { LearnerCourse c = fresh.get(); return new NextAction("Start " + c.title(), "/learn/" + c.courseId() + (c.nextLessonId() != null ? "/" + c.nextLessonId() : ""), "You're enrolled but haven't started yet"); }
        return new NextAction("Explore courses", "/explore", "Everything you've enrolled in is complete");
    }

    // ---------------------------------------------------------------- guide adoption (admin: organisation-wide)
    public List<GuideAnalytics> guides(CurrentUser u) {
        if (!perm.isAdmin(u)) throw ApiException.forbidden("Guide adoption analytics are available to administrators");
        Map<String, List<GuideAnalyticsEvent>> byGuide = guideEvents.findAll().stream().collect(Collectors.groupingBy(GuideAnalyticsEvent::getGuideId, TreeMap::new, Collectors.toList()));
        List<GuideAnalytics> out = new ArrayList<>();
        byGuide.forEach((guideId, evs) -> {
            java.util.function.ToIntFunction<String> count = name -> (int) evs.stream().filter(e -> name.equals(e.getEvent())).count();
            int started = count.applyAsInt("guide.started"), completed = count.applyAsInt("guide.completed");
            List<Long> durations = evs.stream().filter(e -> "guide.completed".equals(e.getEvent()) && e.getDurationMs() != null).map(GuideAnalyticsEvent::getDurationMs).toList();
            Map<Integer, Integer> reach = new TreeMap<>();
            evs.stream().filter(e -> "step.completed".equals(e.getEvent()) && e.getStep() != null).forEach(e -> reach.merge(e.getStep(), 1, Integer::sum));
            Instant last = evs.stream().map(GuideAnalyticsEvent::getAt).filter(Objects::nonNull).max(Comparator.naturalOrder()).orElse(null);
            out.add(new GuideAnalytics(guideId, (int) evs.stream().map(GuideAnalyticsEvent::getUserId).distinct().count(), count.applyAsInt("guide.opened"), started, completed,
                    count.applyAsInt("guide.abandoned"), count.applyAsInt("help.requested"), pct(completed, Math.max(started, completed)), // a resumed run completes without a fresh "started"
                    durations.isEmpty() ? 0 : Math.round(durations.stream().mapToLong(Long::longValue).average().orElse(0)), reach, last));
        });
        return out;
    }

    // ---------------------------------------------------------------- course health (factual signals with their metric)
    public List<HealthSignal> health(CurrentUser u, Filters f) {
        Scope s = scope(u, f.courseId());
        Data d = new Data(s, new Filters(null, null, f.courseId(), null, null, null), false);
        Map<String, Set<String>> completed = d.completedByKey();
        Instant stale = Instant.now().minusSeconds(30 * DAY), old = Instant.now().minusSeconds(180 * DAY);
        List<HealthSignal> out = new ArrayList<>();
        for (Course c : s.courses()) {
            if (c.getStatus() != CourseStatus.PUBLISHED) continue;
            CourseAnalytics ca = courseAnalytics(d, c, completed, false);
            if (ca.enrolled() >= 2 && ca.completionRate() < 40 && ca.started() > 0) out.add(new HealthSignal(c.getId(), c.getTitle(), "Low completion", "Completion rate", ca.completionRate() + "%", ca.completed() + " of " + ca.enrolled() + " enrolled learners have completed"));
            ca.lessons().stream().filter(l -> l.dropOffPct() >= 40 && ca.enrolled() >= 2).max(Comparator.comparingInt(LessonStat::dropOffPct)).ifPresent(l -> out.add(new HealthSignal(c.getId(), c.getTitle(), "High lesson drop-off", "Drop-off at “" + l.title() + "”", l.dropOffPct() + " pts", l.completionPct() + "% of enrolled learners completed this lesson, vs the one before")));
            if (ca.quizAttempts() >= 2 && ca.quizPassRate() < 60) out.add(new HealthSignal(c.getId(), c.getTitle(), "Low quiz pass rate", "Quiz pass rate", ca.quizPassRate() + "%", ca.quizAttempts() + " attempts"));
            if (ca.enrolled() > 0 && (ca.lastActivityAt() == null || ca.lastActivityAt().isBefore(stale))) out.add(new HealthSignal(c.getId(), c.getTitle(), "No recent activity", "Last learner activity", ca.lastActivityAt() == null ? "never" : ChronoUnit.DAYS.between(ca.lastActivityAt(), Instant.now()) + " days ago", ca.enrolled() + " enrolled"));
            if (c.getUpdatedAt() != null && c.getUpdatedAt().isBefore(old)) out.add(new HealthSignal(c.getId(), c.getTitle(), "Content not updated recently", "Last content update", ChronoUnit.DAYS.between(c.getUpdatedAt(), Instant.now()) + " days ago", "Based on the course's last saved change"));
        }
        return out;
    }
}
