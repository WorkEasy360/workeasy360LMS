package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

// Guide *definitions* (steps, targets, copy) stay in the frontend (src/guide/guides.js) — this only
// persists a user's progress through a guide so it survives refresh/login, per the existing Guide Engine's contract.
@Entity @Table(name = "guide_progress", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "guide_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class GuideProgress {
    @Id private String id;

    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(name = "guide_id", nullable = false, length = 80) private String guideId;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.GuideStatus status;

    @Column(name = "step_index", nullable = false) private Integer stepIndex;
    @Column(name = "completed_steps_json") private String completedStepsJson;

    @Column(name = "started_at", nullable = false) private Instant startedAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Column(name = "completed_at") private Instant completedAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("gp"); if (startedAt == null) startedAt = Instant.now(); updatedAt = Instant.now(); if (status == null) status = Enums.GuideStatus.IN_PROGRESS; if (stepIndex == null) stepIndex = 0; }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
