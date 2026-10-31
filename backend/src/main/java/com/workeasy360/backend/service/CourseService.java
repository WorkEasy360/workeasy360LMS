package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.*;
import com.workeasy360.backend.dto.CourseDtos;
import com.workeasy360.backend.dto.CourseDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.repo.SettingsRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.util.Json;
import com.workeasy360.backend.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

@Service
@Transactional
public class CourseService {
    private static final int[] HUES = {250, 205, 18, 330, 160, 285, 38, 178};
    private static final String[] ICONS = {"target", "layers", "zap", "users", "shield", "chart", "rocket", "message", "book", "bulb", "compass", "cap"};
    private final Random random = new Random();

    private final CourseRepo courses;
    private final ModuleRepo modules;
    private final LessonRepo lessons;
    private final SettingsRepo settingsRepo;
    private final EntitlementService entitlements;
    private final com.workeasy360.backend.repo.Repos.UserRepo users;
    private final PermissionService perm;

    private final SkillService skillService;
    private final EnrollmentRepo enrollmentRepo;

    private final AccessService access;
    public CourseService(CourseRepo courses, ModuleRepo modules, LessonRepo lessons, SettingsRepo settingsRepo, PermissionService perm, SkillService skillService, EnrollmentRepo enrollmentRepo, AccessService access, EntitlementService entitlements, com.workeasy360.backend.repo.Repos.UserRepo users) {
        this.users = users;
        this.courses = courses; this.modules = modules; this.lessons = lessons; this.settingsRepo = settingsRepo; this.perm = perm; this.skillService = skillService; this.enrollmentRepo = enrollmentRepo; this.access = access; this.entitlements = entitlements;
    }

    /** The tree as this caller may see it: full for editors, entitled learners and free published courses; redacted (no lesson bodies) otherwise. */
    public CourseTreeDto treeFor(CurrentUser user, String courseId) {
        Course c = get(courseId);
        if (!perm.sameOrg(user, c)) throw ApiException.notFound("Course"); // another tenant's course does not exist for this caller
        CourseTreeDto t = tree(courseId);
        return access.canAccessContent(user, c) ? t : CourseDtos.locked(t);
    }

    // ---------- reads ----------
    public Course get(String id) { return courses.findById(id).orElseThrow(() -> ApiException.notFound("Course")); }

    public List<CourseSummaryDto> list(CurrentUser user, String statusFilter, boolean mineOnly) {
        List<Course> all = (user.getRole() == Role.ADMIN && !mineOnly)
                ? courses.findByOrgId(user.getOrgId())
                : courses.findByInstructorId(user.getId());
        return summaries(all.stream()
                .filter(c -> statusFilter == null || statusFilter.isBlank() || c.getStatus().name().equalsIgnoreCase(statusFilter))
                .sorted(Comparator.comparing(Course::getUpdatedAt).reversed())
                .toList());
    }

    // Catalog for learners: published + visible, within the caller's organization only.
    public List<CourseSummaryDto> catalog(CurrentUser user) {
        return summaries(courses.findByOrgIdAndStatus(user.getOrgId(), CourseStatus.PUBLISHED).stream()
                .filter(c -> c.getVisibility() == CourseVisibility.CATALOG)
                .sorted(Comparator.comparing(Course::getUpdatedAt).reversed())
                .toList());
    }

    /** Summaries with module/lesson counts from two bulk queries (not two per course). */
    private List<CourseSummaryDto> summaries(List<Course> list) {
        if (list.isEmpty()) return List.of();
        List<CourseModule> mods = modules.findByCourseIdIn(list.stream().map(Course::getId).toList());
        java.util.Map<String, Integer> lessonsPerModule = new java.util.HashMap<>();
        if (!mods.isEmpty()) lessons.findByModuleIdIn(mods.stream().map(CourseModule::getId).toList()).forEach(l -> lessonsPerModule.merge(l.getModuleId(), 1, Integer::sum));
        java.util.Map<String, int[]> counts = new java.util.HashMap<>();
        for (CourseModule m : mods) { int[] c = counts.computeIfAbsent(m.getCourseId(), k -> new int[2]); c[0]++; c[1] += lessonsPerModule.getOrDefault(m.getId(), 0); }
        return list.stream().map(c -> { int[] n = counts.getOrDefault(c.getId(), new int[2]); return CourseDtos.toSummary(c, n[0], n[1]); }).toList();
    }

    /** A course's content is readable by whoever can edit it, by anyone IN ITS ORGANIZATION once it is published, and by its enrolled learners. */
    public boolean canRead(CurrentUser user, Course c) {
        if (!perm.sameOrg(user, c)) return false;
        return perm.canEditCourse(user, c) || c.getStatus() == CourseStatus.PUBLISHED || enrollmentRepo.findByUserIdAndCourseId(user.getId(), c.getId()).isPresent();
    }
    public void requireReadable(CurrentUser user, String courseId) {
        Course c = get(courseId);
        if (!perm.sameOrg(user, c)) throw ApiException.notFound("Course"); // another tenant's course does not exist for this caller
        if (!canRead(user, c)) throw ApiException.forbidden("This course is not available to you");
    }

    /**
     * Every course tree the caller works with, in one response (bulk queries): authors get the courses they manage,
     * learners get the published catalogue plus the courses they are enrolled in. Used by post-login hydration.
     */
    public List<CourseTreeDto> treesFor(CurrentUser user) {
        java.util.Map<String, Course> scope = new java.util.LinkedHashMap<>();
        if (user.getRole() == Role.ADMIN) courses.findByOrgId(user.getOrgId()).forEach(c -> scope.put(c.getId(), c));
        else if (user.getRole() == Role.INSTRUCTOR) courses.findByInstructorId(user.getId()).forEach(c -> scope.put(c.getId(), c));
        else {
            courses.findByOrgIdAndStatus(user.getOrgId(), CourseStatus.PUBLISHED).stream().filter(c -> c.getVisibility() == CourseVisibility.CATALOG).forEach(c -> scope.put(c.getId(), c));
            List<String> enrolled = enrollmentRepo.findByUserId(user.getId()).stream().map(Enrollment::getCourseId).filter(id -> !scope.containsKey(id)).toList();
            if (!enrolled.isEmpty()) courses.findAllById(enrolled).stream().filter(c -> perm.sameOrg(user, c)).forEach(c -> scope.put(c.getId(), c));
        }
        if (scope.isEmpty()) return List.of();
        List<CourseModule> mods = modules.findByCourseIdIn(scope.keySet());
        List<Lesson> ls = mods.isEmpty() ? List.of() : lessons.findByModuleIdIn(mods.stream().map(CourseModule::getId).toList());
        java.util.Map<String, List<CourseModule>> modsByCourse = mods.stream().sorted(Comparator.comparingInt(CourseModule::getPosition)).collect(java.util.stream.Collectors.groupingBy(CourseModule::getCourseId));
        java.util.Map<String, List<Lesson>> lessonsByModule = ls.stream().collect(java.util.stream.Collectors.groupingBy(Lesson::getModuleId));
        java.util.Map<String, com.fasterxml.jackson.databind.JsonNode> skillsByLesson = skillService.lessonSkillsBulk(ls.stream().map(Lesson::getId).toList());
        com.fasterxml.jackson.databind.JsonNode none = Json.read("[]");
        return scope.values().stream().map(c -> {
            List<CourseModule> cm = modsByCourse.getOrDefault(c.getId(), List.of());
            List<Lesson> cl = cm.stream().flatMap(m -> lessonsByModule.getOrDefault(m.getId(), List.of()).stream()).toList();
            CourseTreeDto t = CourseDtos.toTree(c, cm, cl, id -> skillsByLesson.getOrDefault(id, none));
            return access.canAccessContent(user, c) ? t : CourseDtos.locked(t);
        }).toList();
    }

    public CourseTreeDto tree(String courseId) {
        Course c = get(courseId);
        List<CourseModule> mods = modules.findByCourseIdOrderByPositionAsc(courseId);
        List<Lesson> ls = mods.stream().flatMap(m -> lessons.findByModuleIdOrderByPositionAsc(m.getId()).stream()).toList();
        return CourseDtos.toTree(c, mods, ls, lessonId -> Json.MAPPER.valueToTree(skillService.lessonSkills(lessonId)));
    }

    // ---------- write: course ----------
    public void requireEditable(CurrentUser user, Course c) {
        if (!perm.sameOrg(user, c)) throw ApiException.notFound("Course"); // another tenant's course does not exist here
        if (!perm.canEditCourse(user, c)) throw ApiException.forbidden("You can edit only your own courses");
    }

    public Course create(CurrentUser user, String id, String title) {
        if (!perm.canCreateCourse(user)) throw ApiException.forbidden("You don't have permission to create courses");
        if (id != null && !id.isBlank()) {
            // The client proposes the id (local-first sync re-pushes after a reload). JPA save() would silently MERGE
            // into an existing row, handing someone else's course to the caller, so an existing id is resolved here.
            var existing = courses.findById(id);
            if (existing.isPresent()) {
                if (perm.canEditCourse(user, existing.get())) return existing.get();
                throw ApiException.conflict("That course id is already in use");
            }
        }
        entitlements.requireCourseCapacity(user.getOrgId()); // subscription plan course limit
        Course c = Course.builder()
                .id(id).title(title == null ? "" : title).description("").category("Sales").level("Beginner")
                .status(CourseStatus.DRAFT).visibility(CourseVisibility.CATALOG).instructorId(user.getId())
                .sequential(true).certExpiryMonths(0).orgId(user.getOrgId())
                .coverHue(HUES[random.nextInt(HUES.length)]).coverIcon(ICONS[random.nextInt(ICONS.length)])
                .skillsJson("[]").build();
        return courses.save(c);
    }

    public Course update(CurrentUser user, String id, UpdateCourseRequest req) {
        Course c = get(id);
        requireEditable(user, c);
        if (req.title() != null) c.setTitle(req.title());
        if (req.description() != null) c.setDescription(req.description());
        if (req.cover() != null) { c.setCoverHue(req.cover().hue()); c.setCoverIcon(req.cover().icon()); }
        if (req.category() != null) c.setCategory(req.category());
        if (req.level() != null) c.setLevel(req.level());
        if (req.sequential() != null) c.setSequential(req.sequential());
        if (req.certExpiryMonths() != null) c.setCertExpiryMonths(req.certExpiryMonths());
        if (req.priceCents() != null) { if (req.priceCents() < 0 || req.priceCents() > 100_000_000) throw ApiException.badRequest("Price must be between 0 and 1,000,000"); c.setPriceCents(req.priceCents()); }
        if (req.currency() != null) { String cur = req.currency().trim().toUpperCase(); if (!List.of("INR", "USD", "EUR", "GBP").contains(cur)) throw ApiException.badRequest("Currency must be INR, USD, EUR or GBP"); c.setCurrency(cur); }
        if (req.skills() != null) { c.setSkillsJson(Json.write(req.skills())); skillService.replaceCourseSkillsFromJson(id, req.skills()); }
        if (req.visibility() != null) {
            if (!perm.canManageEnrollments(user, c)) throw ApiException.forbidden("Not allowed to change visibility");
            c.setVisibility(CourseVisibility.valueOf(req.visibility()));
        }
        return courses.save(c);
    }

    public Course assignInstructor(CurrentUser user, String id, String instructorId) {
        if (!perm.canAssignInstructor(user)) throw ApiException.forbidden("Only an admin can assign instructors");
        Course c = get(id);
        if (!perm.sameOrg(user, c)) throw ApiException.notFound("Course");
        var instructor = users.findById(instructorId == null ? "" : instructorId).orElseThrow(() -> ApiException.notFound("User"));
        if (!user.getOrgId().equals(instructor.getOrgId())) throw ApiException.notFound("User"); // only someone in this organization can own its course
        if (instructor.getRole() == Role.LEARNER) throw ApiException.badRequest("Choose an instructor or admin to own the course");
        c.setInstructorId(instructorId);
        return courses.save(c);
    }

    public List<String> readiness(String courseId) {
        CourseTreeDto tree = tree(courseId);
        List<String> blockers = new ArrayList<>();
        if (tree.title() == null || tree.title().trim().length() < 3) blockers.add("Give the course a name");
        if (tree.modules().isEmpty()) blockers.add("Add at least one module");
        long lessonCount = tree.modules().stream().mapToLong(m -> m.lessons().size()).sum();
        if (lessonCount == 0) blockers.add("Add at least one lesson");
        return blockers;
    }

    public PublishResult publish(CurrentUser user, String id) {
        Course c = get(id);
        List<String> blockers = readiness(id);
        if (!blockers.isEmpty()) return new PublishResult(false, c.getStatus().name(), blockers, false);
        boolean instructorsCanPublish = settingsRepo.findByOrgId(c.getOrgId()).map(Settings::getInstructorPublish).orElse(true);
        if (!perm.canPublish(user, c, instructorsCanPublish)) {
            if (perm.canSubmitForReview(user, c)) {
                c.setStatus(CourseStatus.IN_REVIEW);
                courses.save(c);
                return new PublishResult(true, "IN_REVIEW", List.of(), false);
            }
            return new PublishResult(false, c.getStatus().name(), List.of(), true);
        }
        c.setStatus(CourseStatus.PUBLISHED);
        c.setPublishedAt(Instant.now());
        courses.save(c);
        return new PublishResult(true, "PUBLISHED", List.of(), false);
    }

    public Course unpublish(CurrentUser user, String id) {
        Course c = get(id); requireEditable(user, c);
        c.setStatus(CourseStatus.DRAFT);
        return courses.save(c);
    }

    public Course archive(CurrentUser user, String id) {
        Course c = get(id); requireEditable(user, c);
        c.setPreviousStatus(c.getStatus().name());
        c.setStatus(CourseStatus.ARCHIVED);
        return courses.save(c);
    }

    public Course restore(CurrentUser user, String id) {
        Course c = get(id); requireEditable(user, c);
        c.setStatus(CourseStatus.DRAFT);
        return courses.save(c);
    }

    public void delete(CurrentUser user, String id) {
        Course c = get(id);
        if (!perm.sameOrg(user, c)) throw ApiException.notFound("Course");
        if (!perm.isAdmin(user)) throw ApiException.forbidden("Only an admin can delete a course");
        // Learning history is never destroyed by a delete: a course with enrolments (progress, certificates) is archived instead.
        if (!enrollmentRepo.findByCourseId(id).isEmpty()) throw ApiException.conflict("This course has enrolled learners — archive it instead to keep their progress and certificates");
        modules.findByCourseIdOrderByPositionAsc(id).forEach(m -> lessons.deleteByModuleId(m.getId()));
        modules.deleteByCourseId(id);
        courses.delete(c);
    }

    // ---------- write: modules ----------
    public CourseModule addModule(CurrentUser user, String courseId, String id, String title) {
        Course c = get(courseId); requireEditable(user, c);
        if (id != null) { // client-supplied id already known (a retried / overlapping sync): idempotent
            java.util.Optional<CourseModule> existing = modules.findById(id);
            if (existing.isPresent()) {
                if (!courseId.equals(existing.get().getCourseId())) throw ApiException.conflict("That module id is already in use");
                if (title != null && !title.isBlank()) existing.get().setTitle(title);
                return modules.save(existing.get());
            }
        }
        int position = modules.findByCourseIdOrderByPositionAsc(courseId).size();
        CourseModule m = CourseModule.builder().id(id).courseId(courseId)
                .title(title != null && !title.isBlank() ? title : "Module " + (position + 1))
                .description("").position(position).build();
        return modules.save(m);
    }

    public CourseModule updateModule(CurrentUser user, String moduleId, UpdateModuleRequest req) {
        CourseModule m = modules.findById(moduleId).orElseThrow(() -> ApiException.notFound("Module"));
        requireEditable(user, get(m.getCourseId()));
        if (req.title() != null) m.setTitle(req.title());
        if (req.description() != null) m.setDescription(req.description());
        return modules.save(m);
    }

    public void reorderModules(CurrentUser user, String courseId, List<String> orderedIds) {
        requireEditable(user, get(courseId));
        List<CourseModule> mods = modules.findByCourseIdOrderByPositionAsc(courseId);
        for (int i = 0; i < orderedIds.size(); i++) {
            final int pos = i;
            mods.stream().filter(m -> m.getId().equals(orderedIds.get(pos))).findFirst().ifPresent(m -> m.setPosition(pos));
        }
        modules.saveAll(mods);
    }

    public void deleteModule(CurrentUser user, String moduleId) {
        CourseModule m = modules.findById(moduleId).orElseThrow(() -> ApiException.notFound("Module"));
        requireEditable(user, get(m.getCourseId()));
        lessons.deleteByModuleId(moduleId);
        modules.delete(m);
    }

    // ---------- write: lessons ----------
    public Lesson addLesson(CurrentUser user, String moduleId, String id, String title, String type) {
        CourseModule m = modules.findById(moduleId).orElseThrow(() -> ApiException.notFound("Module"));
        requireEditable(user, get(m.getCourseId()));
        if (id != null && lessons.findById(id).isPresent()) { // idempotent re-add, never across modules
            Lesson existing = lessons.findById(id).get();
            if (!moduleId.equals(existing.getModuleId())) throw ApiException.conflict("That lesson id is already in use");
            return existing;
        }
        LessonType lt = parseType(type);
        int position = lessons.findByModuleIdOrderByPositionAsc(moduleId).size();
        Lesson.LessonBuilder b = Lesson.builder().id(id).moduleId(moduleId)
                .title(title != null && !title.isBlank() ? title : defaultLessonTitle(lt, position))
                .description("").lessonType(lt).position(position).durationMin(5).status("DRAFT")
                .completionRule(CompletionRule.MANUAL);
        if (lt == LessonType.QUIZ) b.quizJson("{\"passScore\":70,\"questions\":[]}");
        if (lt == LessonType.ASSIGNMENT) b.assignmentJson("{\"brief\":\"\",\"rubric\":[]}");
        if (lt == LessonType.LESSON || lt == LessonType.READING) b.contentJson("[{\"id\":\"b-init\",\"type\":\"text\",\"text\":\"\"}]");
        else b.contentJson("[]");
        return lessons.save(b.build());
    }

    private String defaultLessonTitle(LessonType lt, int position) {
        return switch (lt) { case VIDEO -> "Video " + (position + 1); case QUIZ -> "Quiz " + (position + 1);
            case ASSIGNMENT -> "Assignment " + (position + 1); case DISCUSSION -> "Discussion " + (position + 1);
            case READING -> "Reading " + (position + 1); default -> "Lesson " + (position + 1); };
    }
    private LessonType parseType(String type) { try { return LessonType.valueOf(type == null ? "LESSON" : type.toUpperCase()); } catch (Exception e) { return LessonType.LESSON; } }

    public Lesson updateLesson(CurrentUser user, String lessonId, UpdateLessonRequest req) {
        Lesson l = lessons.findById(lessonId).orElseThrow(() -> ApiException.notFound("Lesson"));
        CourseModule m = modules.findById(l.getModuleId()).orElseThrow(() -> ApiException.notFound("Module"));
        requireEditable(user, get(m.getCourseId()));
        if (req.title() != null) l.setTitle(req.title());
        if (req.description() != null) l.setDescription(req.description());
        if (req.type() != null) l.setLessonType(parseType(req.type()));
        if (req.duration() != null) l.setDurationMin(Math.max(1, req.duration()));
        if (req.content() != null) l.setContentJson(Json.write(req.content()));
        if (req.quiz() != null) l.setQuizJson(Json.write(req.quiz()));
        if (req.assignment() != null) l.setAssignmentJson(Json.write(req.assignment()));
        if (req.completionRule() != null) l.setCompletionRule(CompletionRule.valueOf(req.completionRule()));
        if (req.skills() != null) skillService.replaceLessonSkillsFromJson(lessonId, req.skills());
        return lessons.save(l);
    }

    public void moveLesson(CurrentUser user, String lessonId, String toModuleId, int toIndex) {
        Lesson l = lessons.findById(lessonId).orElseThrow(() -> ApiException.notFound("Lesson"));
        CourseModule from = modules.findById(l.getModuleId()).orElseThrow(() -> ApiException.notFound("Module"));
        requireEditable(user, get(from.getCourseId()));
        if (!l.getModuleId().equals(toModuleId)) {
            CourseModule to = modules.findById(toModuleId).orElseThrow(() -> ApiException.notFound("Module"));
            requireEditable(user, get(to.getCourseId()));
        }
        List<Lesson> fromList = new ArrayList<>(lessons.findByModuleIdOrderByPositionAsc(l.getModuleId()));
        fromList.removeIf(x -> x.getId().equals(lessonId));
        for (int i = 0; i < fromList.size(); i++) fromList.get(i).setPosition(i);

        List<Lesson> toList = l.getModuleId().equals(toModuleId) ? fromList : new ArrayList<>(lessons.findByModuleIdOrderByPositionAsc(toModuleId));
        int idx = Math.max(0, Math.min(toIndex, toList.size()));
        l.setModuleId(toModuleId);
        toList.add(idx, l);
        for (int i = 0; i < toList.size(); i++) toList.get(i).setPosition(i);

        lessons.saveAll(fromList);
        if (!toList.equals(fromList)) lessons.saveAll(toList); else lessons.saveAll(toList);
    }

    public void deleteLesson(CurrentUser user, String lessonId) {
        Lesson l = lessons.findById(lessonId).orElseThrow(() -> ApiException.notFound("Lesson"));
        CourseModule m = modules.findById(l.getModuleId()).orElseThrow(() -> ApiException.notFound("Module"));
        requireEditable(user, get(m.getCourseId()));
        lessons.delete(l);
    }

    public Lesson duplicateLesson(CurrentUser user, String lessonId) {
        Lesson src = lessons.findById(lessonId).orElseThrow(() -> ApiException.notFound("Lesson"));
        CourseModule m = modules.findById(src.getModuleId()).orElseThrow(() -> ApiException.notFound("Module"));
        requireEditable(user, get(m.getCourseId()));
        int position = lessons.findByModuleIdOrderByPositionAsc(src.getModuleId()).size();
        Lesson copy = Lesson.builder().moduleId(src.getModuleId()).title(src.getTitle() + " (copy)")
                .description(src.getDescription()).lessonType(src.getLessonType()).position(position)
                .durationMin(src.getDurationMin()).status(src.getStatus()).contentJson(src.getContentJson())
                .quizJson(src.getQuizJson()).assignmentJson(src.getAssignmentJson()).completionRule(src.getCompletionRule())
                .build();
        return lessons.save(copy);
    }

    public Lesson getLesson(String id) { return lessons.findById(id).orElseThrow(() -> ApiException.notFound("Lesson")); }
    public CourseModule getModule(String id) { return modules.findById(id).orElseThrow(() -> ApiException.notFound("Module")); }
    public String courseIdOfLesson(String lessonId) { return getModule(getLesson(lessonId).getModuleId()).getCourseId(); }

    /** All lessons in a course, module order then lesson position — used for sequencing / completion checks. */
    public List<Lesson> orderedLessons(String courseId) {
        List<CourseModule> mods = modules.findByCourseIdOrderByPositionAsc(courseId);
        List<Lesson> out = new ArrayList<>();
        for (CourseModule m : mods) out.addAll(lessons.findByModuleIdOrderByPositionAsc(m.getId()));
        return out;
    }
}
