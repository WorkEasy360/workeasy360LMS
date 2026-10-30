package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/** Skills engine entities, grouped for scanability (same style as Repos.java). */
public class SkillEntities {

    @Entity @Table(name = "skill_categories")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class SkillCategory {
        @Id private String id;
        @Column(nullable = false, length = 120) private String name;
        @Column(length = 500) private String description;
        @Column(nullable = false) private Integer position;
        @Column(name = "org_id", nullable = false, length = 40) private String orgId;
        @PrePersist void pre() { if (id == null) id = Ids.next("sc"); if (position == null) position = 0; if (orgId == null) orgId = Organization.DEFAULT; }
    }

    @Entity @Table(name = "skills")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class Skill {
        @Id private String id;
        @Column(nullable = false, length = 120) private String name;
        @Column(length = 1000) private String description;
        @Column(name = "category_id", length = 40) private String categoryId;
        @Column(length = 40) private String icon;
        @Column(name = "levels_json") private String levelsJson;
        @Column(nullable = false) private Boolean active;
        @Column(name = "created_at", nullable = false) private Instant createdAt;
        @Column(name = "updated_at", nullable = false) private Instant updatedAt;
        @Column(name = "org_id", nullable = false, length = 40) private String orgId;
        @PrePersist void pre() { if (id == null) id = Ids.next("sk"); createdAt = updatedAt = Instant.now(); if (active == null) active = true; if (icon == null) icon = "target"; if (orgId == null) orgId = Organization.DEFAULT; }
        @PreUpdate void upd() { updatedAt = Instant.now(); }
    }

    @Entity @Table(name = "course_skills", uniqueConstraints = @UniqueConstraint(columnNames = {"course_id", "skill_id"}))
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class CourseSkill {
        @Id private String id;
        @Column(name = "course_id", nullable = false, length = 40) private String courseId;
        @Column(name = "skill_id", nullable = false, length = 40) private String skillId;
        @Column(name = "target_level", nullable = false) private Integer targetLevel;
        @Column(nullable = false) private Integer weight;
        @PrePersist void pre() { if (id == null) id = Ids.next("cs"); if (targetLevel == null) targetLevel = 3; if (weight == null) weight = 30; }
    }

    @Entity @Table(name = "lesson_skills", uniqueConstraints = @UniqueConstraint(columnNames = {"lesson_id", "skill_id"}))
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class LessonSkill {
        @Id private String id;
        @Column(name = "lesson_id", nullable = false, length = 40) private String lessonId;
        @Column(name = "skill_id", nullable = false, length = 40) private String skillId;
        @Column(name = "contribution_percentage", nullable = false) private Integer contributionPercentage;
        @PrePersist void pre() { if (id == null) id = Ids.next("ls"); if (contributionPercentage == null) contributionPercentage = 10; }
    }

    @Entity @Table(name = "user_skills", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "skill_id"}))
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class UserSkill {
        @Id private String id;
        @Column(name = "user_id", nullable = false, length = 40) private String userId;
        @Column(name = "skill_id", nullable = false, length = 40) private String skillId;
        @Column(name = "current_level", nullable = false) private Integer currentLevel;
        @Column(name = "progress_percentage", nullable = false) private Integer progressPercentage;
        @Column(name = "evidence_json") private String evidenceJson;
        @Column(name = "updated_at", nullable = false) private Instant updatedAt;
        @PrePersist void pre() { if (id == null) id = Ids.next("us"); updatedAt = Instant.now(); if (currentLevel == null) currentLevel = 1; if (progressPercentage == null) progressPercentage = 0; }
        @PreUpdate void upd() { updatedAt = Instant.now(); }
    }

    @Entity @Table(name = "skill_assessments")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class SkillAssessment {
        @Id private String id;
        @Column(name = "user_id", nullable = false, length = 40) private String userId;
        @Column(name = "skill_id", nullable = false, length = 40) private String skillId;
        @Column(name = "lesson_id", length = 40) private String lessonId;
        @Column(name = "course_id", length = 40) private String courseId;
        @Column(nullable = false, length = 20) private String kind; // QUIZ | ASSIGNMENT
        private Integer score;
        @Column(nullable = false) private Boolean passed;
        @Column(nullable = false) private Instant at;
        @PrePersist void pre() { if (id == null) id = Ids.next("sa"); if (at == null) at = Instant.now(); if (passed == null) passed = false; }
    }

    @Entity @Table(name = "learning_paths")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class LearningPath {
        @Id private String id;
        @Column(nullable = false, length = 200) private String title;
        @Column(length = 1000) private String description;
        @Column(nullable = false) private Boolean active;
        @Column(name = "created_at", nullable = false) private Instant createdAt;
        @Column(name = "org_id", nullable = false, length = 40) private String orgId;
        @PrePersist void pre() { if (id == null) id = Ids.next("lp"); if (active == null) active = true; if (createdAt == null) createdAt = Instant.now(); if (orgId == null) orgId = Organization.DEFAULT; }
    }

    @Entity @Table(name = "learning_path_nodes")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class LearningPathNode {
        @Id private String id;
        @Column(name = "path_id", nullable = false, length = 40) private String pathId;
        @Column(name = "node_key", nullable = false, length = 40) private String nodeKey;
        @Column(name = "node_type", nullable = false, length = 20) private String nodeType; // COURSE | MILESTONE
        @Column(name = "course_id", length = 40) private String courseId;
        @Column(length = 200) private String title;
        @Column(length = 500) private String description;
        @Column(name = "requires_json") private String requiresJson;
        @Column(nullable = false) private Integer position;
        @PrePersist void pre() { if (id == null) id = Ids.next("lpn"); if (position == null) position = 0; }
    }
}
