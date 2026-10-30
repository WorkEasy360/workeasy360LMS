package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/** One organization's subscription to a plan. order_ref makes payment-driven provisioning idempotent. */
@Entity @Table(name = "subscriptions")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Subscription {
    @Id
    private String id;

    @Column(name = "org_id", nullable = false, length = 40)
    private String orgId;

    @Column(name = "plan_id", nullable = false, length = 40)
    private String planId;

    /** TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED | EXPIRED */
    @Column(nullable = false, length = 20)
    private String status;

    @Column(name = "started_at", nullable = false)   private Instant startedAt;
    @Column(name = "trial_ends_at")                  private Instant trialEndsAt;
    @Column(name = "renews_at")                      private Instant renewsAt;
    @Column(name = "cancelled_at")                   private Instant cancelledAt;

    @Column(name = "order_ref", length = 80)
    private String orderRef;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("sub"); createdAt = updatedAt = Instant.now(); if (startedAt == null) startedAt = Instant.now(); if (status == null) status = "TRIAL"; }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
