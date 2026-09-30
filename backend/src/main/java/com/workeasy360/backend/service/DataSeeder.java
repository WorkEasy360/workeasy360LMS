package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.util.Json;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

/**
 * Realistic development seed data — an admin, two instructors, several learners, a handful of published/draft
 * courses with real modules/lessons/quizzes, enrollments + progress, and a few community posts — so the existing
 * dashboards look populated immediately. Guarded by app.seed.enabled and only runs once (skips if users exist).
 */
@Component
@Order(100)
public class DataSeeder implements CommandLineRunner {
    private final UserRepo users;
    private final CourseRepo courses;
    private final ModuleRepo modules;
    private final LessonRepo lessons;
    private final EnrollmentRepo enrollments;
    private final LessonProgressRepo progress;
    private final CertificateService certificateService;
    private final CertificateRepo certificateRepo;
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(DataSeeder.class);
    private final GroupRepo groups;
    private final GroupMemberRepo groupMembers;
    private final PostRepo posts;
    private final CommentRepo comments;
    private final PasswordEncoder encoder;
    private final boolean enabled;
    private final SkillService skillService;
    private final SkillCategoryRepo skillCategories;
    private final SkillRepo skillRepo;
    private final LessonSkillRepo lessonSkillRepo;
    private final LearningPathRepo learningPaths;
    private final LearningPathNodeRepo learningPathNodes;

    public DataSeeder(UserRepo users, CourseRepo courses, ModuleRepo modules, LessonRepo lessons, EnrollmentRepo enrollments,
                       LessonProgressRepo progress, CertificateService certificateService, GroupRepo groups,
                       GroupMemberRepo groupMembers, PostRepo posts, CommentRepo comments, PasswordEncoder encoder,
                       @Value("${app.seed.enabled}") boolean enabled, SkillService skillService, SkillCategoryRepo skillCategories,
                       SkillRepo skillRepo, LessonSkillRepo lessonSkillRepo, LearningPathRepo learningPaths, LearningPathNodeRepo learningPathNodes,
                       CertificateRepo certificateRepo) {
        this.users = users; this.courses = courses; this.modules = modules; this.lessons = lessons;
        this.enrollments = enrollments; this.progress = progress; this.certificateService = certificateService; this.certificateRepo = certificateRepo;
        this.groups = groups; this.groupMembers = groupMembers; this.posts = posts; this.comments = comments;
        this.encoder = encoder; this.enabled = enabled;
        this.skillService = skillService; this.skillCategories = skillCategories; this.skillRepo = skillRepo;
        this.lessonSkillRepo = lessonSkillRepo; this.learningPaths = learningPaths; this.learningPathNodes = learningPathNodes;
    }

    private static final String PASSWORD = "password123";

    @Override
    @Transactional
    public void run(String... args) {
        repairCertificateConsistency();
        if (!enabled || users.count() > 0) return;

        String hash = encoder.encode(PASSWORD);
        // Ids intentionally match the existing frontend mock dataset (src/lib/mockData.js / DEMO_USER_BY_ROLE)
        // so a demo login shares one identity across the localStorage-driven UI and this real backend —
        // ownership/permission checks agree on both sides without renumbering the whole frontend seed dataset.
        User admin = userWithId("u-priya", "Priya Nair", "admin@workeasy360.dev", Role.ADMIN, "L&D Administrator", "People", 165, hash);
        User daniel = userWithId("u-daniel", "Daniel Ortiz", "daniel@workeasy360.dev", Role.INSTRUCTOR, "Learning Lead", "Enablement", 20, hash);
        User aisha = userWithId("u-aisha", "Aisha Bello", "aisha@workeasy360.dev", Role.INSTRUCTOR, "Marketing Enablement Lead", "Marketing", 290, hash);
        User maya = userWithId("u-maya", "Maya Chen", "maya@workeasy360.dev", Role.LEARNER, "Account Executive", "Sales", 250, hash);
        maya.setStreak(5);
        User sam = userWithId("u-sam", "Sam Rivera", "sam@workeasy360.dev", Role.LEARNER, "Sales Development Rep", "Sales", 210, hash);
        User lena = userWithId("u-lena", "Lena Fischer", "lena@workeasy360.dev", Role.LEARNER, "Support Specialist", "Support", 330, hash);
        User omar = userWithId("u-omar", "Omar Haddad", "omar@workeasy360.dev", Role.LEARNER, "Sales Manager", "Sales", 40, hash);
        users.saveAll(List.of(admin, daniel, aisha, maya, sam, lena, omar));

        Course sales = course("c-sales", daniel.getId(), "Sales Foundations", "Master the modern sales conversation — from discovery questions to a first outreach message that actually gets replies.",
                "Sales", "Beginner", 250, "target", CourseStatus.PUBLISHED, Map.of("prospecting", 45, "comms", 25));
        Course crm = course("c-crm", daniel.getId(), "CRM Mastery", "Turn your CRM into a reliable pipeline engine: clean data, honest stages, accurate forecasts.",
                "Sales", "Intermediate", 205, "layers", CourseStatus.PUBLISHED, Map.of("crm", 60));
        Course security = course("c-sec", aisha.getId(), "Security Awareness 2026", "Annual compliance training: spot phishing, handle data safely.",
                "Compliance", "Beginner", 160, "shield", CourseStatus.PUBLISHED, Map.of("security", 60));
        Course onboarding = course("c-onboard", aisha.getId(), "New Hire Onboarding", "Everything a new employee needs in their first 30 days.",
                "Onboarding", "Beginner", 38, "rocket", CourseStatus.DRAFT, Map.of());
        courses.saveAll(List.of(sales, crm, security, onboarding));

        // --- skills library (ids match the frontend's seed so existing screens keep working) ---
        SkillEntities.SkillCategory catSales = skillCategories.save(SkillEntities.SkillCategory.builder().id("cat-sales").name("Sales").description("Finding, winning and growing accounts.").position(0).build());
        SkillEntities.SkillCategory catCore = skillCategories.save(SkillEntities.SkillCategory.builder().id("cat-core").name("Core").description("Skills every role relies on.").position(1).build());
        SkillEntities.SkillCategory catLead = skillCategories.save(SkillEntities.SkillCategory.builder().id("cat-leadership").name("Leadership").description("Leading people and teams.").position(2).build());
        SkillEntities.SkillCategory catData = skillCategories.save(SkillEntities.SkillCategory.builder().id("cat-analytics").name("Analytics").description("Working with data.").position(3).build());
        SkillEntities.SkillCategory catComp = skillCategories.save(SkillEntities.SkillCategory.builder().id("cat-compliance").name("Compliance").description("Keeping people and data safe.").position(4).build());
        String lv = SkillService.defaultLevels();
        skillRepo.saveAll(List.of(
                SkillEntities.Skill.builder().id("prospecting").name("Prospecting").description("Finding and engaging the right accounts.").categoryId(catSales.getId()).icon("compass").levelsJson(lv).build(),
                SkillEntities.Skill.builder().id("crm").name("CRM").description("Running a clean, honest pipeline.").categoryId(catSales.getId()).icon("layers").levelsJson(lv).build(),
                SkillEntities.Skill.builder().id("negotiation").name("Negotiation").description("Preparing, anchoring and trading concessions.").categoryId(catSales.getId()).icon("zap").levelsJson(lv).build(),
                SkillEntities.Skill.builder().id("comms").name("Communication").description("Clear, persuasive written and spoken communication.").categoryId(catCore.getId()).icon("message").levelsJson(lv).build(),
                SkillEntities.Skill.builder().id("leadership").name("Leadership").description("Coaching, delegating and building trust.").categoryId(catLead.getId()).icon("users").levelsJson(lv).build(),
                SkillEntities.Skill.builder().id("data").name("Data Literacy").description("Reading, choosing and presenting data.").categoryId(catData.getId()).icon("chart").levelsJson(lv).build(),
                SkillEntities.Skill.builder().id("security").name("Security Awareness").description("Protecting people, data and systems.").categoryId(catComp.getId()).icon("shield").levelsJson(lv).build()));
        for (Course c : List.of(sales, crm, security, onboarding)) skillService.replaceCourseSkillsFromJson(c.getId(), com.workeasy360.backend.util.Json.read(c.getSkillsJson()));

        // --- Sales Foundations: discovery module with a real quiz + assignment ---
        CourseModule m1 = saveModule(sales.getId(), "The modern sales conversation", 0);
        Lesson l1 = saveLesson(m1.getId(), "Why buyers buy", LessonType.VIDEO, 0, 6,
                blocks(textBlock("Buyers rarely buy a product. They buy a **better version of their own situation**.")), null, null);
        Lesson l2 = saveLesson(m1.getId(), "Discovery questions that work", LessonType.READING, 1, 8,
                blocks(headingBlock("Ask about the problem, not the product"),
                        textBlock("Great discovery feels like a conversation. Use open questions that start with *what*, *how* and *tell me about*.")), null, null);
        Lesson l3 = saveLesson(m1.getId(), "Check your understanding", LessonType.QUIZ, 2, 6, arr(),
                quizJson(70, List.of(
                        Map.of("prompt", "What is the main goal of discovery?", "options", List.of("Present the product", "Understand the buyer's situation and impact", "Get a signature"), "answer", 1),
                        Map.of("prompt", "Discovery questions should mostly be:", "options", List.of("Closed yes/no questions", "Open questions", "Rhetorical questions"), "answer", 1)
                )), null);
        CourseModule m2 = saveModule(sales.getId(), "Prospecting with purpose", 1);
        Lesson l4 = saveLesson(m2.getId(), "Write your first outreach message", LessonType.ASSIGNMENT, 0, 20, arr(), null,
                assignmentJson("Write a 4-5 sentence outreach message that leads with the prospect's situation, not your product.", List.of("Opens with the prospect's situation", "One clear call to action", "Under 100 words")));

        // --- CRM Mastery ---
        CourseModule cm1 = saveModule(crm.getId(), "CRM basics", 0);
        saveLesson(cm1.getId(), "Pipeline stages explained", LessonType.LESSON, 0, 9,
                blocks(headingBlock("Stages describe buyer progress, not seller activity"), textBlock("Each stage should have an **exit criterion** the buyer has demonstrated.")), null, null);
        saveLesson(cm1.getId(), "Clean data habits", LessonType.READING, 1, 7,
                blocks(textBlock("Clean data compounds. Log every meeting within 24 hours; one owner per account; next step + date on every open deal.")), null, null);
        CourseModule cm2 = saveModule(crm.getId(), "Working the pipeline", 1);
        saveLesson(cm2.getId(), "Forecasting with confidence", LessonType.VIDEO, 0, 12, blocks(textBlock("Split your forecast into commit, best case and pipeline.")), null, null);

        // --- Security Awareness ---
        CourseModule sm1 = saveModule(security.getId(), "Spot the threat", 0);
        saveLesson(sm1.getId(), "Phishing in the wild", LessonType.LESSON, 0, 8,
                blocks(textBlock("Phishing works because it borrows **urgency** and **authority**. Slow down, verify the sender, hover before you click.")), null, null);
        saveLesson(sm1.getId(), "Phishing quiz", LessonType.QUIZ, 1, 6, arr(),
                quizJson(80, List.of(Map.of("prompt", "An urgent email from the CEO asks for gift cards. You…",
                        "options", List.of("Buy them", "Report it as phishing", "Reply asking why"), "answer", 1))), null);

        CourseModule om1 = saveModule(onboarding.getId(), "Welcome & culture", 0);
        saveLesson(om1.getId(), "Welcome from our CEO", LessonType.VIDEO, 0, 4, arr(), null, null);

        // --- enrollments + progress (Maya well into Sales Foundations; Sam starting Security) ---
        // Maya has finished Sales Foundations (as in the frontend demo data), so her certificate is consistent with her enrolment.
        enroll(maya.getId(), sales.getId(), List.of(l1, l2, l3, l4), Instant.now().minus(45, ChronoUnit.DAYS));
        enrollments.findByUserIdAndCourseId(maya.getId(), sales.getId()).ifPresent(e -> { e.setStatus(EnrollmentStatus.COMPLETED); e.setCompletedAt(Instant.now().minus(5, ChronoUnit.DAYS)); enrollments.save(e); });
        certificateService.issueIfAbsent(maya.getId(), sales.getId());
        enroll(maya.getId(), crm.getId(), List.of(), Instant.now().minus(10, ChronoUnit.DAYS));
        enroll(sam.getId(), security.getId(), List.of(), Instant.now().minus(2, ChronoUnit.DAYS));
        enroll(omar.getId(), sales.getId(), List.of(l1, l2, l3, l4), Instant.now().minus(70, ChronoUnit.DAYS));
        enrollments.findByUserIdAndCourseId(omar.getId(), sales.getId()).ifPresent(e -> { e.setStatus(EnrollmentStatus.COMPLETED); e.setCompletedAt(Instant.now().minus(5, ChronoUnit.DAYS)); enrollments.save(e); });
        certificateService.issueIfAbsent(omar.getId(), sales.getId());

        // --- lesson-level skill mappings + learning paths ---
        lessonSkillRepo.saveAll(List.of(
                SkillEntities.LessonSkill.builder().lessonId(l1.getId()).skillId("prospecting").contributionPercentage(10).build(),
                SkillEntities.LessonSkill.builder().lessonId(l2.getId()).skillId("prospecting").contributionPercentage(15).build(),
                SkillEntities.LessonSkill.builder().lessonId(l2.getId()).skillId("comms").contributionPercentage(10).build(),
                SkillEntities.LessonSkill.builder().lessonId(l3.getId()).skillId("prospecting").contributionPercentage(10).build(),
                SkillEntities.LessonSkill.builder().lessonId(l4.getId()).skillId("comms").contributionPercentage(20).build()));
        SkillEntities.LearningPath p1 = learningPaths.save(SkillEntities.LearningPath.builder().id("j-sales").title("Sales Leader Path").description("From solid foundations to a leadership-ready sales professional.").build());
        learningPathNodes.saveAll(List.of(
                SkillEntities.LearningPathNode.builder().pathId(p1.getId()).nodeKey("n1").nodeType("COURSE").courseId(sales.getId()).requiresJson("[]").position(0).build(),
                SkillEntities.LearningPathNode.builder().pathId(p1.getId()).nodeKey("n2").nodeType("COURSE").courseId(crm.getId()).requiresJson("[\"n1\"]").position(1).build(),
                SkillEntities.LearningPathNode.builder().pathId(p1.getId()).nodeKey("n3").nodeType("MILESTONE").title("Sales Skill Mastery").description("Awarded when you complete Sales Foundations and CRM Mastery.").requiresJson("[\"n2\"]").position(2).build()));
        SkillEntities.LearningPath p2 = learningPaths.save(SkillEntities.LearningPath.builder().id("j-team").title("Data-Ready Team Member").description("The essentials every team member needs to work safely with data.").build());
        learningPathNodes.saveAll(List.of(
                SkillEntities.LearningPathNode.builder().pathId(p2.getId()).nodeKey("n1").nodeType("COURSE").courseId(onboarding.getId()).requiresJson("[]").position(0).build(),
                SkillEntities.LearningPathNode.builder().pathId(p2.getId()).nodeKey("n2").nodeType("COURSE").courseId(security.getId()).requiresJson("[\"n1\"]").position(1).build(),
                SkillEntities.LearningPathNode.builder().pathId(p2.getId()).nodeKey("n3").nodeType("MILESTONE").title("Data-Ready").description("Onboarding and security complete.").requiresJson("[\"n2\"]").position(2).build()));
        for (User u : List.of(maya, omar)) skillService.recalculate(u.getId()); // seeded progress → seeded skill evidence (after mappings exist)

        // --- community ---
        Group guild = groups.save(Group.builder().name("Sales Guild").description("Tactics, war stories and wins from the sales floor.").hue(250).build());
        groupMembers.saveAll(List.of(
                GroupMember.builder().groupId(guild.getId()).userId(maya.getId()).build(),
                GroupMember.builder().groupId(guild.getId()).userId(sam.getId()).build(),
                GroupMember.builder().groupId(guild.getId()).userId(omar.getId()).build()));
        Post welcome = posts.save(Post.builder().authorId(daniel.getId()).kind(PostKind.DISCUSSION)
                .title("Welcome to the WorkEasy360 community").body("Introduce yourself and tell us one skill you want to build this quarter.")
                .groupId(guild.getId()).pinned(true).build());
        comments.save(Comment.builder().postId(welcome.getId()).authorId(maya.getId()).body("Excited to be here! Working on negotiation skills.").build());
        posts.save(Post.builder().authorId(sam.getId()).kind(PostKind.QUESTION)
                .title("How do you handle 'send me pricing' on the first call?")
                .body("I keep getting asked for pricing before I've done discovery.").groupId(guild.getId()).build());
    }

    // ---------- helpers ----------
    private User user(String name, String email, Role role, String title, String dept, int hue, String hash) {
        return User.builder().name(name).email(email).passwordHash(hash).role(role).title(title).dept(dept).hue(hue).status("ACTIVE").streak(0).build();
    }

    private User userWithId(String id, String name, String email, Role role, String title, String dept, int hue, String hash) {
        User u = user(name, email, role, title, dept, hue, hash);
        u.setId(id);
        return u;
    }

    // Demo courses reuse the frontend seed's ids (c-sales, c-crm, …) so learning paths / skill mappings resolve to the
    // same courses on both sides, and carry a deliberately old updatedAt so the client's fuller demo copy wins the
    // last-write-wins merge (the first real edit in the Course Builder then converges the two).
    private static final Instant SEED_TIME = Instant.parse("2025-01-01T00:00:00Z");
    private Course course(String id, String instructorId, String title, String desc, String category, String level, int hue, String icon, CourseStatus status, Map<String, Integer> skills) {
        ArrayNode arr = Json.MAPPER.createArrayNode();
        skills.forEach((k, v) -> { ObjectNode o = Json.MAPPER.createObjectNode(); o.put("skillId", k); o.put("points", v); arr.add(o); });
        Course c = Course.builder().id(id).createdAt(SEED_TIME).updatedAt(SEED_TIME).title(title).description(desc).category(category).level(level)
                .status(status).visibility(CourseVisibility.CATALOG).instructorId(instructorId)
                .sequential(true).certExpiryMonths(status == CourseStatus.PUBLISHED && category.equals("Compliance") ? 12 : 0)
                .coverHue(hue).coverIcon(icon).skillsJson(arr.toString()).build();
        if (status == CourseStatus.PUBLISHED) c.setPublishedAt(Instant.now().minus(30, ChronoUnit.DAYS));
        return c;
    }

    private CourseModule saveModule(String courseId, String title, int position) {
        return modules.save(CourseModule.builder().courseId(courseId).title(title).description("").position(position).build());
    }

    private Lesson saveLesson(String moduleId, String title, LessonType type, int position, int duration, ArrayNode content, String quizJson, String assignmentJson) {
        return lessons.save(Lesson.builder().moduleId(moduleId).title(title).description("").lessonType(type)
                .position(position).durationMin(duration).status("READY").contentJson(content.toString())
                .quizJson(quizJson).assignmentJson(assignmentJson).completionRule(CompletionRule.MANUAL).build());
    }

    private ArrayNode arr() { return Json.MAPPER.createArrayNode(); }
    private ArrayNode blocks(ObjectNode... nodes) { ArrayNode a = arr(); for (var n : nodes) a.add(n); return a; }
    private ObjectNode textBlock(String text) { ObjectNode o = Json.MAPPER.createObjectNode(); o.put("id", Ids.next("b")); o.put("type", "text"); o.put("text", text); return o; }
    private ObjectNode headingBlock(String text) { ObjectNode o = Json.MAPPER.createObjectNode(); o.put("id", Ids.next("b")); o.put("type", "heading"); o.put("text", text); return o; }

    private String quizJson(int passScore, List<Map<String, Object>> questions) {
        ObjectNode root = Json.MAPPER.createObjectNode();
        root.put("passScore", passScore);
        ArrayNode qs = root.putArray("questions");
        for (var q : questions) {
            ObjectNode qn = Json.MAPPER.createObjectNode();
            qn.put("id", Ids.next("q"));
            qn.put("type", "mc");
            qn.put("prompt", (String) q.get("prompt"));
            ArrayNode opts = qn.putArray("options");
            @SuppressWarnings("unchecked") List<String> options = (List<String>) q.get("options");
            String answerId = null;
            for (int i = 0; i < options.size(); i++) {
                ObjectNode o = Json.MAPPER.createObjectNode();
                String oid = "o" + i;
                o.put("id", oid); o.put("text", options.get(i));
                opts.add(o);
                if (i == (Integer) q.get("answer")) answerId = oid;
            }
            qn.put("answer", answerId);
            qn.put("explanation", "");
            qs.add(qn);
        }
        return root.toString();
    }

    private String assignmentJson(String brief, List<String> rubric) {
        ObjectNode root = Json.MAPPER.createObjectNode();
        root.put("brief", brief);
        ArrayNode r = root.putArray("rubric");
        rubric.forEach(r::add);
        return root.toString();
    }

    /**
     * Invariant: a non-revoked certificate is only ever issued for a completed enrolment (ProgressService issues it at
     * the moment the last lesson completes). Earlier demo data issued Maya's Sales Foundations certificate while her
     * enrolment was still 3/4 done, which made the course funnel show more "certified" than "completed" learners.
     * This idempotent startup pass brings any existing database in line with the invariant — every certified
     * (user, course) gets its remaining lessons marked complete and its enrolment completed at the issue time —
     * so the fix applies without wiping the development database.
     */
    private void repairCertificateConsistency() {
        int repaired = 0;
        java.util.Set<String> touchedUsers = new java.util.HashSet<>();
        for (Certificate c : certificateRepo.findAll()) {
            if (Boolean.TRUE.equals(c.getRevoked())) continue;
            java.util.Optional<Enrollment> existing = enrollments.findByUserIdAndCourseId(c.getUserId(), c.getCourseId());
            if (existing.isPresent() && existing.get().getCompletedAt() != null) continue;
            if (courses.findById(c.getCourseId()).isEmpty()) continue;
            Instant when = c.getIssuedAt() != null ? c.getIssuedAt() : Instant.now();
            Enrollment e = existing.orElseGet(() -> Enrollment.builder().userId(c.getUserId()).courseId(c.getCourseId())
                    .status(EnrollmentStatus.IN_PROGRESS).enrolledAt(when).startedAt(when).bookmarksJson("[]").build());
            for (CourseModule m : modules.findByCourseIdOrderByPositionAsc(c.getCourseId())) for (Lesson l : lessons.findByModuleIdOrderByPositionAsc(m.getId())) {
                LessonProgress p = progress.findByUserIdAndLessonId(c.getUserId(), l.getId()).orElseGet(() -> LessonProgress.builder()
                        .userId(c.getUserId()).lessonId(l.getId()).courseId(c.getCourseId()).status(ProgressStatus.NOT_STARTED)
                        .percentage(0).lastPosition(0d).watchPercentage(0d).videoCompleted(false).build());
                if (p.getStatus() != ProgressStatus.COMPLETED) { p.setStatus(ProgressStatus.COMPLETED); p.setPercentage(100); p.setCompletedAt(when); progress.save(p); }
            }
            if (e.getStartedAt() == null) e.setStartedAt(when);
            e.setStatus(EnrollmentStatus.COMPLETED); e.setCompletedAt(when); e.setLastActiveAt(e.getLastActiveAt() == null ? when : e.getLastActiveAt());
            enrollments.save(e);
            touchedUsers.add(c.getUserId()); repaired++;
        }
        if (repaired > 0) {
            touchedUsers.forEach(skillService::recalculate);
            log.info("Certificate/enrolment consistency: completed {} enrolment(s) that already held a valid certificate", repaired);
        }
    }

    private void enroll(String userId, String courseId, List<Lesson> completedLessons, Instant startedAt) {
        Enrollment e = Enrollment.builder().userId(userId).courseId(courseId)
                .status(completedLessons.isEmpty() ? EnrollmentStatus.NOT_STARTED : EnrollmentStatus.IN_PROGRESS)
                .enrolledAt(startedAt).startedAt(startedAt).lastActiveAt(Instant.now().minus(1, ChronoUnit.DAYS))
                .bookmarksJson("[]").build();
        if (!completedLessons.isEmpty()) e.setLastLessonId(completedLessons.get(completedLessons.size() - 1).getId());
        enrollments.save(e);
        for (Lesson l : completedLessons) {
            progress.save(LessonProgress.builder().userId(userId).lessonId(l.getId()).courseId(courseId)
                    .status(ProgressStatus.COMPLETED).percentage(100).lastPosition(0d).watchPercentage(100d)
                    .videoCompleted(true).completedAt(Instant.now().minus(5, ChronoUnit.DAYS)).build());
        }
    }
}
