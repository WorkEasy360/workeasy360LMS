package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "notifications")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Notification {
    @Id private String id;

    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(nullable = false, length = 30) private String kind;
    @Column(nullable = false, length = 300) private String title;
    @Column(length = 1000) private String body;
    @Column(length = 300) private String href;
    @Column(nullable = false) private Boolean read;
    @Column(nullable = false) private Instant at;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("n"); if (at == null) at = Instant.now(); if (read == null) read = false; }
}
