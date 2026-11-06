package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.domain.CoachEntities.CoachConversation;
import com.workeasy360.backend.domain.CoachEntities.CoachMessage;
import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.Enums.CourseStatus;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Enums.SubmissionStatus;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.dto.CoachDtos.MessageDto;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.LearnerContextService.Context;
import com.workeasy360.backend.service.SyncService.Audience;
import com.workeasy360.backend.util.Json;
import com.workeasy360.backend.web.ApiException;
import com.workeasy360.backend.web.UserController;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * In-product tasks the Work Easy AI Agent can carry out for the signed-in person.
 *
 * The model only ever PROPOSES an operation from the catalogue for the person's role. Each proposal is validated
 * against what this person can see (ids from their own learning context or workspace), and its button label and
 * confirmation text are written here, not by the model. The person confirms with one click; execution then goes
 * through the same services and endpoints the screens use, with the person's own CurrentUser, so the agent can never
 * do more than they could by hand. Every run is audited, succeeds at most once, and one-time secrets (temporary
 * passwords, reset links) are returned once and never stored.
 */
@Service
public class AgentOperationsService {
    public static final int MAX_OPERATIONS = 2;
    private static final int MAX_COURSES = 40, MAX_PEOPLE = 80;
    private static final Set<Role> STAFF = Set.of(Role.INSTRUCTOR, Role.ADMIN);
    private static final Set<Role> ORG_ROLES = Set.of(Role.LEARNER, Role.INSTRUCTOR, Role.ADMIN);

    public record OpSpec(String op, Set<Role> roles, String args, String effect) {}
    public static final List<OpSpec> CATALOGUE = List.of(
            new OpSpec("ENROLL_COURSE", Set.of(Role.LEARNER), "{\"courseId\": a courseId from availableCourses}", "enrol the user in that free published course"),
            new OpSpec("CREATE_COURSE", STAFF, "{\"title\": string}", "create a new draft course owned by the user, to build in the Course Builder"),
            new OpSpec("PUBLISH_COURSE", STAFF, "{\"courseId\": a courseId from workspace.courses}", "publish the course (or submit it for review when the organisation requires that)"),
            new OpSpec("ASSIGN_COURSE", STAFF, "{\"courseId\": a courseId from workspace.courses, \"userId\": a userId from workspace.people, \"dueDate\": \"YYYY-MM-DD\" or null}", "enrol that person in the course, optionally with a due date"),
            new OpSpec("ADD_PERSON", Set.of(Role.ADMIN), "{\"name\": string, \"email\": string, \"role\": \"LEARNER\"|\"INSTRUCTOR\"|\"ADMIN\"}", "create the account; a one-time temporary password is shown to the admin"),
            new OpSpec("SET_PERSON_STATUS", Set.of(Role.ADMIN), "{\"userId\": a userId from workspace.people, \"status\": \"ACTIVE\"|\"INACTIVE\"}", "activate or deactivate the account (inactive people cannot sign in)"),
            new OpSpec("CHANGE_ROLE", Set.of(Role.ADMIN), "{\"userId\": a userId from workspace.people, \"role\": \"LEARNER\"|\"INSTRUCTOR\"|\"ADMIN\"}", "change the person's role"),
            new OpSpec("ASSIGN_INSTRUCTOR", Set.of(Role.ADMIN), "{\"courseId\": a courseId from workspace.courses, \"userId\": the userId of an instructor or admin from workspace.people}", "make that person the course's instructor"),
            new OpSpec("RESET_LINK", Set.of(Role.ADMIN), "{\"userId\": a userId from workspace.people}", "issue a one-time password-reset link for the admin to hand over"));
    private static final Map<String, OpSpec> BY_OP = CATALOGUE.stream().collect(Collectors.toMap(OpSpec::op, s -> s));

    public record Page(String key, String path, String label, Set<Role> roles) {}
    public static final List<Page> PAGES = List.of(
            new Page("home", "/", "Home", ORG_ROLES),
            new Page("my-learning", "/my-learning", "My learning", Set.of(Role.LEARNER)),
            new Page("explore", "/explore", "Explore courses", Set.of(Role.LEARNER)),
            new Page("journeys", "/journeys", "Learning journeys", Set.of(Role.LEARNER)),
            new Page("progress", "/progress", "My progress", Set.of(Role.LEARNER)),
            new Page("achievements", "/achievements", "Achievements", Set.of(Role.LEARNER)),
            new Page("certificates", "/certificates", "My certificates", Set.of(Role.LEARNER)),
            new Page("coach", "/coach", "Learning Coach", Set.of(Role.LEARNER)),
            new Page("notifications", "/notifications", "Notifications", ORG_ROLES),
            new Page("skills", "/skills", "Skills", ORG_ROLES),
            new Page("community", "/community", "Community", ORG_ROLES),
            new Page("courses", "/courses", "Courses", STAFF),
            new Page("ai-builder", "/builder/ai", "Create a course with AI", STAFF),
            new Page("assessments", "/assessments", "Assessments", STAFF),
            new Page("learners", "/learners", "Learners", STAFF),
            new Page("analytics", "/analytics", "Analytics", STAFF),
            new Page("people", "/people", "People", Set.of(Role.ADMIN)),
            new Page("certifications", "/certifications", "Certifications", Set.of(Role.ADMIN)),
            new Page("automation", "/automation", "Automation", Set.of(Role.ADMIN)),
            new Page("integrations", "/integrations", "Integrations", Set.of(Role.ADMIN)),
            new Page("settings", "/settings", "Settings", Set.of(Role.ADMIN)));

    /** What a staff member manages: the courses they may edit and the people they may act on. Ids only from here. */
    public record WCourse(String courseId, String title, String status, long learners, long completed, boolean free, String instructorId) {}
    public record WPerson(String userId, String name, String role, String status) {}
    public record Workspace(List<WCourse> courses, List<WPerson> people, int pendingReviews, Map<String, Object> summary) {
        WCourse course(String id) { return id == null ? null : courses.stream().filter(c -> c.courseId().equals(id)).findFirst().orElse(null); }
        WPerson person(String id) { return id == null ? null : people.stream().filter(p -> p.userId().equals(id)).findFirst().orElse(null); }
    }

    public record OpResult(boolean ok, String message, String href, String secretLabel, String secret, MessageDto updated) {}

    private final CourseRepo courses; private final UserRepo users; private final EnrollmentRepo enrollmentRepo; private final SubmissionRepo submissions;
    private final CoachMessageRepo messages; private final CoachConversationRepo conversations;
    private final PermissionService perm; private final CourseService courseService; private final EnrollmentService enrollments;
    private final UserController people; private final AuditService audit; private final SyncService sync;
    private final Set<String> running = ConcurrentHashMap.newKeySet();

    public AgentOperationsService(CourseRepo courses, UserRepo users, EnrollmentRepo enrollmentRepo, SubmissionRepo submissions, CoachMessageRepo messages,
                                  CoachConversationRepo conversations, PermissionService perm, CourseService courseService, EnrollmentService enrollments,
                                  UserController people, AuditService audit, SyncService sync) {
        this.courses = courses; this.users = users; this.enrollmentRepo = enrollmentRepo; this.submissions = submissions; this.messages = messages;
        this.conversations = conversations; this.perm = perm; this.courseService = courseService; this.enrollments = enrollments;
        this.people = people; this.audit = audit; this.sync = sync;
    }

    // ---------- context for the prompt ----------

    /** Null for learners: their context is their own learning record (LearnerContextService). The lists are bounded;
     *  whatever the question names comes first, then the most recently changed courses and people in name order. */
    public Workspace workspace(CurrentUser u, String question) {
        if (!STAFF.contains(u.getRole())) return null;
        String q = question == null ? "" : question.toLowerCase();
        List<Course> managed = courses.findByOrgId(u.getOrgId()).stream().filter(c -> c.getStatus() != CourseStatus.ARCHIVED && perm.canEditCourse(u, c)).toList();
        List<Course> editable = managed.stream()
                .sorted(Comparator.comparingInt((Course c) -> mentioned(q, c.getTitle()) ? 0 : 1)
                        .thenComparing(Course::getUpdatedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .limit(MAX_COURSES).toList();
        Map<String, long[]> counts = new HashMap<>();
        if (!managed.isEmpty()) for (Object[] row : enrollmentRepo.countByCourse(managed.stream().map(Course::getId).toList()))
            counts.put((String) row[0], new long[]{ ((Number) row[1]).longValue(), row[2] == null ? 0 : ((Number) row[2]).longValue() });
        List<WCourse> cs = editable.stream().map(c -> { long[] n = counts.getOrDefault(c.getId(), new long[]{ 0, 0 });
            return new WCourse(c.getId(), c.getTitle() == null || c.getTitle().isBlank() ? "Untitled course" : c.getTitle(), c.getStatus().name(), n[0], n[1], AccessService.isFree(c), c.getInstructorId()); }).toList();
        List<User> visible = u.getRole() == Role.ADMIN ? users.findByOrgId(u.getOrgId()) : users.findByOrgIdAndRole(u.getOrgId(), Role.LEARNER);
        List<WPerson> ps = visible.stream().filter(p -> p.getRole() != Role.PLATFORM)
                .sorted(Comparator.comparingInt((User p) -> mentioned(q, p.getName()) || firstNameMentioned(q, p.getName()) ? 0 : 1)
                        .thenComparing(User::getName, String.CASE_INSENSITIVE_ORDER)).limit(MAX_PEOPLE)
                .map(p -> new WPerson(p.getId(), p.getName(), p.getRole().name(), p.getStatus() == null ? "ACTIVE" : p.getStatus())).toList();
        int pending = managed.isEmpty() ? 0 : (int) submissions.findByCourseIdIn(managed.stream().map(Course::getId).toList()).stream()
                .filter(s -> s.getStatus() == SubmissionStatus.SUBMITTED || s.getStatus() == SubmissionStatus.UNDER_REVIEW).count();
        // Totals over everything this person manages (the lists above are bounded), so "how is it going" has real numbers.
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("coursesManaged", managed.size());
        summary.put("coursesPublished", managed.stream().filter(c -> c.getStatus() == CourseStatus.PUBLISHED).count());
        summary.put("coursesInReview", managed.stream().filter(c -> c.getStatus() == CourseStatus.IN_REVIEW).count());
        summary.put("coursesDraft", managed.stream().filter(c -> c.getStatus() == CourseStatus.DRAFT).count());
        long enrolments = counts.values().stream().mapToLong(n -> n[0]).sum(), completions = counts.values().stream().mapToLong(n -> n[1]).sum();
        summary.put("enrolments", enrolments);
        summary.put("completions", completions);
        summary.put("completionRatePct", enrolments == 0 ? 0 : Math.round(completions * 100.0 / enrolments));
        List<User> everyone = visible.stream().filter(p -> p.getRole() != Role.PLATFORM).toList();
        for (Role r : List.of(Role.LEARNER, Role.INSTRUCTOR, Role.ADMIN)) {
            long n = everyone.stream().filter(p -> p.getRole() == r).count();
            if (n > 0 || u.getRole() == Role.ADMIN) summary.put(r.name().toLowerCase() + "s", n);
        }
        summary.put("inactiveAccounts", everyone.stream().filter(p -> "INACTIVE".equals(p.getStatus())).count());
        summary.put("listedCourses", cs.size());
        summary.put("listedPeople", ps.size());
        return new Workspace(cs, ps, pending, summary);
    }

    public ObjectNode workspaceJson(Workspace w) {
        ObjectNode o = Json.MAPPER.createObjectNode();
        o.set("summary", Json.MAPPER.valueToTree(w.summary()));
        Map<String, String> names = w.people().stream().collect(Collectors.toMap(WPerson::userId, WPerson::name, (a, b) -> a));
        ArrayNode cs = o.putArray("courses");
        for (WCourse c : w.courses()) {
            ObjectNode x = cs.addObject(); x.put("courseId", c.courseId()); x.put("title", c.title()); x.put("status", c.status());
            x.put("learners", c.learners()); x.put("completed", c.completed()); x.put("free", c.free());
            if (names.containsKey(c.instructorId())) x.put("instructor", names.get(c.instructorId()));
        }
        ArrayNode ps = o.putArray("people");
        for (WPerson p : w.people()) { ObjectNode x = ps.addObject(); x.put("userId", p.userId()); x.put("name", p.name()); x.put("role", p.role()); x.put("status", p.status()); }
        o.put("submissionsAwaitingReview", w.pendingReviews());
        return o;
    }

    /** The operations and pages this role may use, described for the model. */
    public static String catalogueFor(Role role) {
        StringBuilder sb = new StringBuilder("Operations you may propose for this user (role ").append(role.name()).append("):\n");
        boolean any = false;
        for (OpSpec s : CATALOGUE) if (s.roles().contains(role)) { sb.append("- ").append(s.op()).append(" args ").append(s.args()).append(": ").append(s.effect()).append('\n'); any = true; }
        if (!any) sb.append("- none\n");
        sb.append(switch (role) {
            case LEARNER -> "Not available to this user: anything that changes other people, courses or settings (adding people, roles, publishing, assigning courses). Say their instructor or administrator does that.\n";
            case INSTRUCTOR -> "Not available to this user: adding people, activating or deactivating accounts, changing roles, password resets and organisation settings. Say an administrator does that; don't look the person up.\n";
            default -> "Not available through you: deleting people or courses, payments and refunds, and WorkEasy360 platform settings. Point to the right screen instead.\n";
        });
        sb.append("Pages you may open with an OPEN_PAGE action (\"page\" key): ")
                .append(PAGES.stream().filter(p -> p.roles().contains(role)).map(p -> p.key() + " (" + p.label() + ")").collect(Collectors.joining(", "))).append('\n');
        return sb.toString();
    }

    public static Page page(Role role, String key) {
        return key == null ? null : PAGES.stream().filter(p -> p.key().equals(key) && p.roles().contains(role)).findFirst().orElse(null);
    }

    // ---------- proposals ----------

    /** Validates the model's proposed operations. Anything not allowed for this role, or naming an id this person can't
     *  see, is dropped silently. Labels and confirmation text come from the validated data. */
    public ArrayNode validateProposals(JsonNode raw, CurrentUser u, Context ctx, Workspace w) {
        ArrayNode out = Json.MAPPER.createArrayNode();
        if (raw == null || !raw.isArray()) return out;
        for (JsonNode p : raw) {
            if (out.size() >= MAX_OPERATIONS) break;
            String op = text(p.path("op").isMissingNode() ? p.path("type") : p.path("op")).toUpperCase();
            OpSpec spec = BY_OP.get(op);
            if (spec == null || !spec.roles().contains(u.getRole())) continue;
            JsonNode a = p.path("args").isObject() ? p.path("args") : p;
            ObjectNode args = Json.MAPPER.createObjectNode();
            String label, confirm;
            switch (op) {
                case "ENROLL_COURSE" -> {
                    String id = text(a.path("courseId"));
                    var course = ctx.available().stream().filter(c -> c.courseId().equals(id)).findFirst().orElse(null);
                    if (course == null) continue;
                    args.put("courseId", id); label = "Enroll me"; confirm = "Enroll you in “" + course.title() + "”?";
                }
                case "CREATE_COURSE" -> {
                    String title = clean(text(a.path("title")), 120);
                    if (title.length() < 3) continue;
                    args.put("title", title); label = "Create course"; confirm = "Create a new draft course “" + title + "”?";
                }
                case "PUBLISH_COURSE" -> {
                    WCourse c = w == null ? null : w.course(text(a.path("courseId")));
                    if (c == null || "PUBLISHED".equals(c.status())) continue;
                    args.put("courseId", c.courseId()); label = "Publish course"; confirm = "Publish “" + c.title() + "”?";
                }
                case "ASSIGN_COURSE" -> {
                    WCourse c = w == null ? null : w.course(text(a.path("courseId")));
                    WPerson who = w == null ? null : w.person(text(a.path("userId")));
                    if (c == null || who == null || "INACTIVE".equals(who.status())) continue;
                    LocalDate due = date(text(a.path("dueDate")));
                    args.put("courseId", c.courseId()); args.put("userId", who.userId()); if (due != null) args.put("dueDate", due.toString());
                    label = "Assign course"; confirm = "Assign “" + c.title() + "” to " + who.name() + (due == null ? "" : ", due " + due) + "?";
                }
                case "ADD_PERSON" -> {
                    String name = clean(text(a.path("name")), 120), email = text(a.path("email")).toLowerCase();
                    Role r = role(text(a.path("role")), Role.LEARNER);
                    if (name.length() < 2 || !email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$") || r == null) continue;
                    args.put("name", name); args.put("email", email); args.put("role", r.name());
                    label = "Add person"; confirm = "Add " + name + " (" + email + ") as " + roleLabel(r) + "?";
                }
                case "SET_PERSON_STATUS" -> {
                    WPerson who = w == null ? null : w.person(text(a.path("userId")));
                    String status = text(a.path("status")).toUpperCase();
                    if (who == null || who.userId().equals(u.getId()) || !List.of("ACTIVE", "INACTIVE").contains(status) || status.equals(who.status())) continue;
                    args.put("userId", who.userId()); args.put("status", status);
                    label = status.equals("INACTIVE") ? "Deactivate" : "Reactivate";
                    confirm = status.equals("INACTIVE") ? "Deactivate " + who.name() + "? They won't be able to sign in." : "Reactivate " + who.name() + "?";
                }
                case "CHANGE_ROLE" -> {
                    WPerson who = w == null ? null : w.person(text(a.path("userId")));
                    Role r = role(text(a.path("role")), null);
                    if (who == null || r == null || who.userId().equals(u.getId()) || r.name().equals(who.role())) continue;
                    args.put("userId", who.userId()); args.put("role", r.name());
                    label = "Change role"; confirm = "Make " + who.name() + " " + article(roleLabel(r)) + "?";
                }
                case "ASSIGN_INSTRUCTOR" -> {
                    WCourse c = w == null ? null : w.course(text(a.path("courseId")));
                    WPerson who = w == null ? null : w.person(text(a.path("userId")));
                    if (c == null || who == null || "LEARNER".equals(who.role()) || who.userId().equals(c.instructorId())) continue;
                    args.put("courseId", c.courseId()); args.put("userId", who.userId());
                    label = "Set instructor"; confirm = "Make " + who.name() + " the instructor of “" + c.title() + "”?";
                }
                case "RESET_LINK" -> {
                    WPerson who = w == null ? null : w.person(text(a.path("userId")));
                    if (who == null) continue;
                    args.put("userId", who.userId()); label = "Create reset link"; confirm = "Create a one-time password-reset link for " + who.name() + "?";
                }
                default -> { continue; }
            }
            ObjectNode o = out.addObject();
            o.put("type", "OPERATION"); o.put("op", op); o.put("label", label); o.put("confirm", confirm); o.set("args", args); o.put("status", "PROPOSED");
        }
        return out;
    }

    // ---------- execution ----------

    public OpResult execute(CurrentUser u, String messageId, int index) {
        CoachMessage m = messages.findById(messageId).orElseThrow(() -> ApiException.notFound("Message"));
        CoachConversation conv = conversations.findById(m.getConversationId()).orElseThrow(() -> ApiException.notFound("Message"));
        if (!conv.getUserId().equals(u.getId())) throw ApiException.notFound("Message"); // someone else's conversation does not exist for this caller
        JsonNode parsed = m.getActionsJson() == null ? null : Json.read(m.getActionsJson());
        if (!(parsed instanceof ArrayNode actions) || index < 0 || index >= actions.size() || !"OPERATION".equals(actions.get(index).path("type").asText()))
            throw ApiException.notFound("Operation");
        ObjectNode action = (ObjectNode) actions.get(index);
        if ("DONE".equals(action.path("status").asText())) throw ApiException.conflict("That's already done");
        String op = action.path("op").asText();
        OpSpec spec = BY_OP.get(op);
        if (spec == null || !spec.roles().contains(u.getRole())) throw ApiException.forbidden("That isn't something your account can do");
        String key = messageId + "#" + index;
        if (!running.add(key)) throw ApiException.conflict("That's already running");
        try {
            OpResult r;
            try { r = run(u, op, action.path("args")); }
            catch (ApiException e) { r = new OpResult(false, friendly(e), null, null, null, null); }
            action.put("status", r.ok() ? "DONE" : "FAILED");
            action.put("result", r.message());
            if (r.href() != null) action.put("href", r.href()); else action.remove("href");
            m.setActionsJson(actions.toString());
            messages.save(m);
            audit.record(u.getId(), u.getOrgId(), "agent." + op.toLowerCase(), summary(action.path("args")), r.ok() ? "OK" : "FAILED");
            if (r.ok()) { String type = eventType(op); if (type != null) sync.publish(u.getOrgId(), type, Audience.ORG, u.getId(), null); }
            return new OpResult(r.ok(), r.message(), r.href(), r.secretLabel(), r.secret(), MessageDto.of(m));
        } finally { running.remove(key); }
    }

    private OpResult run(CurrentUser u, String op, JsonNode a) {
        switch (op) {
            case "ENROLL_COURSE" -> {
                Course c = courseService.get(a.path("courseId").asText());
                enrollments.selfEnroll(u, c.getId(), null);
                return ok("You're enrolled in “" + c.getTitle() + "”. Your first lesson is ready whenever you are.", "/learn/" + c.getId());
            }
            case "CREATE_COURSE" -> {
                Course c = courseService.create(u, null, a.path("title").asText());
                return ok("Created the draft course “" + c.getTitle() + "”. Open it in the Course Builder to add modules and lessons.", "/builder/" + c.getId());
            }
            case "PUBLISH_COURSE" -> {
                Course c = courseService.get(a.path("courseId").asText());
                courseService.requireEditable(u, c);
                var res = courseService.publish(u, c.getId());
                if (res.denied()) return fail("Your account can't publish “" + c.getTitle() + "”.");
                if (!res.ok()) return fail("“" + c.getTitle() + "” isn't ready to publish yet: " + String.join("; ", res.blockers()) + ".", "/builder/" + c.getId());
                return "IN_REVIEW".equals(res.status())
                        ? ok("Submitted “" + c.getTitle() + "” for review. An administrator will publish it.", "/builder/" + c.getId())
                        : ok("“" + c.getTitle() + "” is published. Learners can find it in Explore now.", "/builder/" + c.getId());
            }
            case "ASSIGN_COURSE" -> {
                Course c = courseService.get(a.path("courseId").asText());
                User who = users.findById(a.path("userId").asText()).orElseThrow(() -> ApiException.notFound("User"));
                LocalDate due = date(a.path("dueDate").asText(null));
                enrollments.assign(u, c, who.getId(), due == null ? null : due.atTime(23, 59).toInstant(ZoneOffset.UTC).toEpochMilli());
                return ok("Assigned “" + c.getTitle() + "” to " + who.getName() + (due == null ? "" : ", due " + due) + ". They've been notified.", null);
            }
            case "ADD_PERSON" -> {
                var created = people.create(u, new UserController.CreateUserRequest(a.path("name").asText(), a.path("email").asText(), a.path("role").asText(), null, null, null));
                return new OpResult(true, "Added " + created.user().name() + " as " + roleLabel(Role.valueOf(a.path("role").asText())) + ". Hand them the one-time temporary password below; they sign in with their e-mail.",
                        "/people", "Temporary password (shown once)", created.temporaryPassword(), null);
            }
            case "SET_PERSON_STATUS" -> {
                var d = people.update(u, a.path("userId").asText(), new UserController.UpdateUserRequest(null, null, null, null, a.path("status").asText()));
                return ok("INACTIVE".equals(a.path("status").asText()) ? d.name() + " is deactivated and can no longer sign in." : d.name() + " is active again and can sign in.", "/people");
            }
            case "CHANGE_ROLE" -> {
                var d = people.update(u, a.path("userId").asText(), new UserController.UpdateUserRequest(null, a.path("role").asText(), null, null, null));
                return ok(d.name() + " is now " + article(roleLabel(Role.valueOf(a.path("role").asText()))) + ". Their panel changes on their next action.", "/people");
            }
            case "ASSIGN_INSTRUCTOR" -> {
                Course c = courseService.assignInstructor(u, a.path("courseId").asText(), a.path("userId").asText());
                String name = users.findById(a.path("userId").asText()).map(User::getName).orElse("They");
                return ok(name + " is now the instructor of “" + c.getTitle() + "”.", null);
            }
            case "RESET_LINK" -> {
                var t = people.resetToken(u, a.path("userId").asText());
                String name = users.findById(a.path("userId").asText()).map(User::getName).orElse("them");
                return new OpResult(true, "Here's a one-time password-reset link for " + name + ". It works once, for " + t.expiresMinutes() + " minutes" + (t.emailed() ? ", and it was also e-mailed to them." : "."),
                        null, "Reset link (shown once)", t.resetPath(), null);
            }
            default -> throw ApiException.badRequest("Unknown operation");
        }
    }

    private static OpResult ok(String message, String href) { return new OpResult(true, message, href, null, null, null); }
    private static OpResult fail(String message) { return fail(message, null); }
    private static OpResult fail(String message, String href) { return new OpResult(false, message, href, null, null, null); }

    private static String friendly(ApiException e) {
        if (e.status == HttpStatus.PAYMENT_REQUIRED) return "That course has to be purchased first. Open the course page to buy it.";
        if (e.status == HttpStatus.NOT_FOUND) return "I couldn't find that any more. It may have been removed.";
        return e.getMessage() == null ? "That didn't work." : e.getMessage();
    }

    private static String eventType(String op) {
        return switch (op) {
            case "ENROLL_COURSE", "ASSIGN_COURSE" -> "learning";
            case "CREATE_COURSE", "PUBLISH_COURSE", "ASSIGN_INSTRUCTOR" -> "courses";
            case "ADD_PERSON", "SET_PERSON_STATUS", "CHANGE_ROLE" -> "users";
            default -> null;
        };
    }

    /** Audit detail: ids and enums only, never names typed by the model or one-time secrets. */
    private static String summary(JsonNode args) {
        List<String> parts = new ArrayList<>();
        args.fieldNames().forEachRemaining(f -> { if (!f.equals("name") && !f.equals("title")) parts.add(f + "=" + args.path(f).asText()); });
        return String.join(" ", parts);
    }

    private static boolean mentioned(String q, String name) { return name != null && name.length() >= 3 && q.contains(name.toLowerCase()); }
    private static boolean firstNameMentioned(String q, String name) {
        if (name == null || name.isBlank()) return false;
        String first = name.trim().split("\\s+")[0].toLowerCase();
        return first.length() >= 3 && java.util.regex.Pattern.compile("\\b" + java.util.regex.Pattern.quote(first) + "\\b").matcher(q).find();
    }
    private static String text(JsonNode n) { return n == null || n.isNull() || n.isMissingNode() ? "" : n.asText("").trim(); }
    private static String clean(String s, int max) { String t = s.replaceAll("[\\p{Cntrl}<>]", " ").replaceAll("\\s+", " ").trim(); return t.length() > max ? t.substring(0, max).trim() : t; }
    private static Role role(String s, Role dflt) {
        if (s == null || s.isBlank()) return dflt;
        try { Role r = Role.valueOf(s.trim().toUpperCase()); return r == Role.PLATFORM ? null : r; } catch (IllegalArgumentException e) { return null; }
    }
    private static LocalDate date(String s) {
        if (s == null || s.isBlank()) return null;
        try { LocalDate d = LocalDate.parse(s.trim()); return d.isBefore(LocalDate.now(ZoneOffset.UTC)) || d.isAfter(LocalDate.now(ZoneOffset.UTC).plusYears(2)) ? null : d; } catch (Exception e) { return null; }
    }
    static String roleLabel(Role r) { return switch (r) { case ADMIN -> "Admin"; case INSTRUCTOR -> "Instructor"; default -> "Learner"; }; }
    private static String article(String noun) { return ("AEIOU".indexOf(noun.charAt(0)) >= 0 ? "an " : "a ") + noun; }
}
