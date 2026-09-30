package com.workeasy360.backend.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.SkillEntities.*;
import com.workeasy360.backend.util.Json;

import java.util.List;

public class SkillDtos {
    public record CategoryDto(String id, String name, String description, int position) {
        public static CategoryDto of(SkillCategory c) { return new CategoryDto(c.getId(), c.getName(), c.getDescription(), c.getPosition()); }
    }
    public record SkillDto(String id, String name, String description, String categoryId, String category, String icon, JsonNode levels, boolean active) {}
    public record UpsertSkillRequest(String id, String name, String description, String categoryId, String icon, JsonNode levels, Boolean active) {}
    public record UpsertCategoryRequest(String id, String name, String description, Integer position) {}

    public record CourseSkillDto(String skillId, int targetLevel, int weight) {
        public static CourseSkillDto of(CourseSkill c) { return new CourseSkillDto(c.getSkillId(), c.getTargetLevel(), c.getWeight()); }
    }
    public record LessonSkillDto(String skillId, int contribution) {
        public static LessonSkillDto of(LessonSkill l) { return new LessonSkillDto(l.getSkillId(), l.getContributionPercentage()); }
    }

    /** A learner's standing in one skill: measured progress + evidence, never inferred from enrolment alone. */
    public record UserSkillDto(String skillId, int currentLevel, String levelLabel, int progressPercentage, int targetLevel,
                                JsonNode evidence, List<String> courseIds, boolean improving) {}

    public record LearningPathNodeDto(String id, String type, String courseId, String title, String description, List<String> requires) {}
    public record LearningPathDto(String id, String title, String description, List<LearningPathNodeDto> nodes) {}

    public static JsonNode levelsOf(Skill s) { return Json.read(s.getLevelsJson()); }
}
