package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/** A tenant: one subscribing customer organization with its own isolated LMS. */
@Entity @Table(name = "organizations")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Organization {
    /** The tenant every pre-tenancy row belongs to. */
    public static final String DEFAULT = "org-default";
    /** The platform owner's own organization — its staff never appear in customer directories. */
    public static final String PLATFORM = "org-platform";

    @Id
    private String id;

    @Column(nullable = false, length = 160)
    private String name;

    @Column(nullable = false, unique = true, length = 80)
    private String slug;

    /** ACTIVE | SUSPENDED */
    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("org"); createdAt = updatedAt = Instant.now(); if (status == null) status = "ACTIVE"; }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
