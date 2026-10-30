package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "users")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class User {
    @Id
    private String id;

    @Column(nullable = false, length = 160)
    private String name;

    @Column(nullable = false, unique = true, length = 200)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 200)
    private String passwordHash;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.Role role;

    @Column(length = 160) private String title;
    @Column(length = 120) private String dept;
    private Integer hue;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(nullable = false)
    private Integer streak;

    @Column(name = "org_id", nullable = false, length = 40)
    private String orgId;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("u"); createdAt = updatedAt = Instant.now(); if (status == null) status = "ACTIVE"; if (streak == null) streak = 0; if (orgId == null) orgId = Organization.DEFAULT; }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
