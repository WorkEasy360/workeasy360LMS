package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "guide_analytics")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class GuideAnalyticsEvent {
    @Id private String id;

    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(name = "guide_id", nullable = false, length = 80) private String guideId;
    @Column(nullable = false, length = 40) private String event; // opened|started|step.completed|completed|abandoned|help.requested
    private Integer step;
    @Column(name = "duration_ms") private Long durationMs;
    @Column(nullable = false) private Instant at;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("ga"); if (at == null) at = Instant.now(); }
}
