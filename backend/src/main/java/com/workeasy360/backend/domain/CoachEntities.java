package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/** Learning Coach + recommendations + learning plans (V5__coach.sql). References existing entities by id only. */
public final class CoachEntities {
    private CoachEntities() {}

    @Entity @Table(name = "recommendations")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class Recommendation {
        @Id private String id;
        @Column(name = "user_id", nullable = false, length = 40) private String userId;
        @Column(nullable = false, length = 30) private String type;
        @Column(name = "ref_key", nullable = false, length = 160) private String refKey;
        @Column(name = "course_id", length = 40) private String courseId;
        @Column(name = "lesson_id", length = 40) private String lessonId;
        @Column(name = "skill_id", length = 40) private String skillId;
        @Column(name = "path_id", length = 40) private String pathId;
        @Column(nullable = false, length = 300) private String title;
        @Column(nullable = false, length = 1000) private String reason;
        @Column(name = "facts_json") private String factsJson;
        @Column(name = "signals_json") private String signalsJson;
        @Column(nullable = false) private Integer priority;
        private Integer minutes;
        @Column(nullable = false, length = 20) private String status;
        @Column(length = 20) private String feedback;
        @Column(name = "created_at", nullable = false) private Instant createdAt;
        @Column(name = "updated_at", nullable = false) private Instant updatedAt;
        @Column(name = "dismissed_at") private Instant dismissedAt;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("rec"); Instant now = Instant.now(); if (createdAt == null) createdAt = now; if (updatedAt == null) updatedAt = now; if (status == null) status = "ACTIVE"; if (priority == null) priority = 0; }
        @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
    }

    @Entity @Table(name = "recommendation_feedback")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class RecommendationFeedback {
        @Id private String id;
        @Column(name = "user_id", nullable = false, length = 40) private String userId;
        @Column(name = "recommendation_id", nullable = false, length = 40) private String recommendationId;
        @Column(name = "ref_key", nullable = false, length = 160) private String refKey;
        @Column(nullable = false, length = 20) private String value;
        @Column(nullable = false) private Instant at;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("rf"); if (at == null) at = Instant.now(); }
    }

    @Entity @Table(name = "coach_conversations")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class CoachConversation {
        @Id private String id;
        @Column(name = "user_id", nullable = false, length = 40) private String userId;
        @Column(length = 200) private String title;
        @Column(name = "lesson_id", length = 40) private String lessonId;
        @Column(name = "created_at", nullable = false) private Instant createdAt;
        @Column(name = "updated_at", nullable = false) private Instant updatedAt;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("cc"); Instant now = Instant.now(); if (createdAt == null) createdAt = now; if (updatedAt == null) updatedAt = now; }
    }

    @Entity @Table(name = "coach_messages")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class CoachMessage {
        @Id private String id;
        @Column(name = "conversation_id", nullable = false, length = 40) private String conversationId;
        @Column(nullable = false, length = 10) private String role;
        @Column(nullable = false) private String content;
        @Column(name = "actions_json") private String actionsJson;
        @Column(name = "generation_id", length = 40) private String generationId;
        @Column(nullable = false) private Instant at;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("cm"); if (at == null) at = Instant.now(); }
    }

    @Entity @Table(name = "learning_plans")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class LearningPlan {
        @Id private String id;
        @Column(name = "user_id", nullable = false, length = 40) private String userId;
        @Column(nullable = false, length = 200) private String title;
        @Column(nullable = false) private Integer minutes;
        @Column(nullable = false, length = 20) private String status;
        @Column(nullable = false, length = 20) private String source;
        @Column(name = "course_id", length = 40) private String courseId;
        @Column(name = "created_at", nullable = false) private Instant createdAt;
        @Column(name = "started_at") private Instant startedAt;
        @Column(name = "completed_at") private Instant completedAt;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("plan"); if (createdAt == null) createdAt = Instant.now(); if (status == null) status = "DRAFT"; if (source == null) source = "MANUAL"; }
    }

    @Entity @Table(name = "learning_plan_items")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class LearningPlanItem {
        @Id private String id;
        @Column(name = "plan_id", nullable = false, length = 40) private String planId;
        @Column(nullable = false) private Integer position;
        @Column(nullable = false, length = 20) private String kind;
        @Column(name = "course_id", length = 40) private String courseId;
        @Column(name = "lesson_id", length = 40) private String lessonId;
        @Column(nullable = false, length = 300) private String title;
        @Column(nullable = false) private Integer minutes;
        @Column(nullable = false) private Boolean done;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("pi"); if (done == null) done = false; }
    }
}
