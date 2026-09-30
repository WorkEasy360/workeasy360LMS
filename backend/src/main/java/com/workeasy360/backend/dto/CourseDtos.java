package com.workeasy360.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.CourseModule;
import com.workeasy360.backend.domain.Lesson;
import com.workeasy360.backend.util.Json;

import java.time.Instant;
import java.util.List;

public class CourseDtos {

    public record CoverDto(Integer hue, String icon) {}

    // Full tree (course + modules + lessons) — the exact shape the existing Course Builder / mockData.js already
    // expects (title, description, cover:{hue,icon}, modules:[{id,title,lessons:[...]}], skills:[...]).
    public record CourseTreeDto(
            String id, String title, String description, CoverDto cover, String category, String level,
            String status, String visibility, String instructorId, boolean sequential, int certExpiryMonths,
            JsonNode skills, Instant createdAt, Instant updatedAt, Instant publishedAt, List<ModuleDto> modules,
            int priceCents, String currency, boolean locked // locked: content redacted for this caller (paid course, no entitlement)
    ) {}

    public record ModuleDto(String id, String courseId, String title, String description, int position, List<LessonDto> lessons) {}

    public record LessonDto(
            String id, String moduleId, String title, String description, String type, int position,
            int duration, String status, JsonNode content, JsonNode quiz, JsonNode assignment, String completionRule,
            JsonNode skills // [{skillId, contribution}]
    ) {}

    public record CourseSummaryDto(
            String id, String title, String description, CoverDto cover, String category, String level,
            String status, String visibility, String instructorId, int moduleCount, int lessonCount,
            Instant updatedAt, int priceCents, String currency
    ) {}

    // `id` is optional: when the frontend supplies its own locally-generated id, the server uses it as the
    // canonical id (so the existing synchronous Course Builder call sites need no rewrite to await a server id).
    public record CreateCourseRequest(String id, String title) {}
    public record UpdateCourseRequest(
            String title, String description, CoverDto cover, String category, String level,
            Boolean sequential, Integer certExpiryMonths, JsonNode skills, String visibility, Integer priceCents, String currency
    ) {}
    public record AssignInstructorRequest(String instructorId) {}
    public record SetVisibilityRequest(String visibility) {}

    public record CreateModuleRequest(String id, String title) {}
    public record UpdateModuleRequest(String title, String description) {}
    public record ReorderRequest(List<String> orderedIds) {}
    public record MoveLessonRequest(String toModuleId, int toIndex) {}

    public record CreateLessonRequest(String id, String title, String type) {}
    public record UpdateLessonRequest(
            String title, String description, String type, Integer duration, JsonNode content,
            JsonNode quiz, JsonNode assignment, String completionRule, JsonNode skills
    ) {}

    public record PublishResult(boolean ok, String status, List<String> blockers, boolean denied) {}

    public static CourseTreeDto toTree(Course c, List<CourseModule> modules, List<Lesson> allLessons) {
        return toTree(c, modules, allLessons, id -> Json.read("[]"));
    }

    public static CourseTreeDto toTree(Course c, List<CourseModule> modules, List<Lesson> allLessons, java.util.function.Function<String, JsonNode> lessonSkillsOf) {
        List<ModuleDto> moduleDtos = modules.stream().map(m -> new ModuleDto(
                m.getId(), m.getCourseId(), m.getTitle(), m.getDescription(), m.getPosition(),
                allLessons.stream().filter(l -> l.getModuleId().equals(m.getId()))
                        .sorted((a, b) -> a.getPosition() - b.getPosition())
                        .map(l -> toLesson(l, lessonSkillsOf.apply(l.getId()))).toList()
        )).toList();
        return new CourseTreeDto(
                c.getId(), c.getTitle(), c.getDescription(), new CoverDto(c.getCoverHue(), c.getCoverIcon()),
                c.getCategory(), c.getLevel(), c.getStatus().name(), c.getVisibility().name(), c.getInstructorId(),
                c.getSequential(), c.getCertExpiryMonths(), Json.read(c.getSkillsJson()),
                c.getCreatedAt(), c.getUpdatedAt(), c.getPublishedAt(), moduleDtos, c.getPriceCents(), c.getCurrency(), false
        );
    }

    public static LessonDto toLesson(Lesson l) { return toLesson(l, Json.read("[]")); }
    public static LessonDto toLesson(Lesson l, JsonNode skills) {
        return new LessonDto(l.getId(), l.getModuleId(), l.getTitle(), l.getDescription(), l.getLessonType().name(),
                l.getPosition(), l.getDurationMin(), l.getStatus(), Json.read(l.getContentJson()),
                Json.read(l.getQuizJson()), Json.read(l.getAssignmentJson()), l.getCompletionRule().name(), skills);
    }

    public static CourseSummaryDto toSummary(Course c, int moduleCount, int lessonCount) {
        return new CourseSummaryDto(c.getId(), c.getTitle(), c.getDescription(), new CoverDto(c.getCoverHue(), c.getCoverIcon()),
                c.getCategory(), c.getLevel(), c.getStatus().name(), c.getVisibility().name(), c.getInstructorId(),
                moduleCount, lessonCount, c.getUpdatedAt(), c.getPriceCents(), c.getCurrency());
    }
    /** The same tree with every lesson body, quiz and assignment removed: what a learner without entitlement may see of a paid course. */
    public static CourseTreeDto locked(CourseTreeDto t) {
        JsonNode none = Json.read("[]");
        List<ModuleDto> mods = t.modules().stream().map(m -> new ModuleDto(m.id(), m.courseId(), m.title(), m.description(), m.position(),
                m.lessons().stream().map(l -> new LessonDto(l.id(), l.moduleId(), l.title(), l.description(), l.type(), l.position(), l.duration(), l.status(), none, null, null, l.completionRule(), l.skills())).toList())).toList();
        return new CourseTreeDto(t.id(), t.title(), t.description(), t.cover(), t.category(), t.level(), t.status(), t.visibility(), t.instructorId(), t.sequential(), t.certExpiryMonths(), t.skills(), t.createdAt(), t.updatedAt(), t.publishedAt(), mods, t.priceCents(), t.currency(), true);
    }
}
