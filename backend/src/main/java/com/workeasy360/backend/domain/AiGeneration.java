package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/** Audit record of one AI generation (course outline or quiz). See V4__ai_generations.sql. */
@Entity @Table(name = "ai_generations")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AiGeneration {
    public enum Type { COURSE, QUIZ, COACH }
    public enum Status { PENDING, COMPLETED, FAILED }

    @Id private String id;
    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private Type type;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private Status status;
    @Column(nullable = false, length = 40) private String provider;
    @Column(length = 120) private String model;
    @Column(name = "prompt_version", nullable = false, length = 40) private String promptVersion;
    @Column(name = "input_hash", nullable = false, length = 80) private String inputHash;
    @Column(name = "input_json", nullable = false) private String inputJson;
    @Column(name = "result_json") private String resultJson;
    @Column(name = "sources_json") private String sourcesJson;
    @Column(length = 2000) private String error;
    @Column(name = "applied_course_id", length = 40) private String appliedCourseId;
    @Column(name = "applied_lesson_id", length = 40) private String appliedLessonId;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "completed_at") private Instant completedAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("ai"); if (createdAt == null) createdAt = Instant.now(); if (status == null) status = Status.PENDING; }
}
