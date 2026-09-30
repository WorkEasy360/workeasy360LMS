package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

/** Orders and payments. An order is the learner's intent to buy a course; payments are the provider's answers to it. */
public final class CommerceEntities {
    private CommerceEntities() {}

    public enum OrderStatus { PENDING, SUCCESS, FAILED, CANCELLED, REFUNDED }

    @Entity @Table(name = "orders")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class PurchaseOrder {
        @Id private String id;
        @Column(name = "user_id", nullable = false, length = 40) private String userId;
        @Column(name = "course_id", nullable = false, length = 40) private String courseId;
        @Column(name = "amount_cents", nullable = false) private Integer amountCents;
        @Column(nullable = false, length = 3) private String currency;
        @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private OrderStatus status;
        @Column(nullable = false, length = 30) private String provider;
        @Column(name = "provider_ref", length = 120) private String providerRef;
        @Column(name = "created_at", nullable = false) private Instant createdAt;
        @Column(name = "updated_at", nullable = false) private Instant updatedAt;
        @Column(name = "paid_at") private Instant paidAt;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("ord"); Instant now = Instant.now(); if (createdAt == null) createdAt = now; updatedAt = now; if (status == null) status = OrderStatus.PENDING; }
        @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
    }

    @Entity @Table(name = "payments")
    @Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
    public static class Payment {
        @Id private String id;
        @Column(name = "order_id", nullable = false, length = 40) private String orderId;
        @Column(nullable = false, length = 30) private String provider;
        @Column(name = "provider_ref", length = 120) private String providerRef;
        @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private OrderStatus status;
        @Column(name = "amount_cents", nullable = false) private Integer amountCents;
        @Column(nullable = false, length = 3) private String currency;
        @Column(name = "detail_json") private String detailJson;
        @Column(name = "created_at", nullable = false) private Instant createdAt;
        @PrePersist void prePersist() { if (id == null) id = Ids.next("pay"); if (createdAt == null) createdAt = Instant.now(); }
    }
}
