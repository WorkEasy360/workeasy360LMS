package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/** A commercial subscription plan, managed by the platform owner. */
@Entity @Table(name = "plans")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Plan {
    @Id
    private String id;

    @Column(nullable = false, length = 80)
    private String name;

    @Column(length = 400)
    private String description;

    @Column(name = "price_cents", nullable = false)
    private Integer priceCents;

    @Column(nullable = false, length = 8)
    private String currency;

    /** MONTHLY | ANNUAL */
    @Column(name = "billing_period", nullable = false, length = 16)
    private String billingPeriod;

    @Column(name = "max_users")    private Integer maxUsers;    // null = unlimited
    @Column(name = "max_courses")  private Integer maxCourses;  // null = unlimited
    @Column(name = "trial_days", nullable = false) private Integer trialDays;

    @Column(name = "features_json", columnDefinition = "text")
    private String featuresJson;

    /** ACTIVE | RETIRED */
    @Column(nullable = false, length = 20)
    private String status;

    @Column(nullable = false)
    private Integer position;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() {
        if (id == null) id = Ids.next("plan");
        createdAt = updatedAt = Instant.now();
        if (priceCents == null) priceCents = 0; if (currency == null) currency = "INR";
        if (billingPeriod == null) billingPeriod = "MONTHLY"; if (trialDays == null) trialDays = 14;
        if (status == null) status = "ACTIVE"; if (position == null) position = 0;
    }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
