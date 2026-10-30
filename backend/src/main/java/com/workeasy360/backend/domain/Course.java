package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "courses")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Course {
    @Id private String id;

    @Column(nullable = false, length = 200) private String title;
    @Column(nullable = false, length = 2000) private String description;

    @Column(name = "cover_hue") private Integer coverHue;
    @Column(name = "cover_icon", length = 40) private String coverIcon;

    @Column(nullable = false, length = 80) private String category;
    @Column(nullable = false, length = 40) private String level;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.CourseStatus status;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.CourseVisibility visibility;

    @Column(name = "instructor_id", nullable = false, length = 40) private String instructorId;

    @Column(nullable = false) private Boolean sequential;
    @Column(name = "cert_expiry_months", nullable = false) private Integer certExpiryMonths;

    @Column(name = "skills_json") private String skillsJson; // [{skillId, points}]

    @Column(name = "previous_status", length = 20) private String previousStatus;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Column(name = "published_at") private Instant publishedAt;

    @Column(name = "price_cents", nullable = false) private Integer priceCents;   // 0 = free
    @Column(nullable = false, length = 3) private String currency;

    @Column(name = "org_id", nullable = false, length = 40) private String orgId;

    @PrePersist void prePersist() {
        if (id == null) id = Ids.next("c");
        if (orgId == null) orgId = Organization.DEFAULT;
        if (createdAt == null) createdAt = Instant.now();
        if (updatedAt == null) updatedAt = createdAt; // seed data may pin an older timestamp so a client's fresher copy wins the merge
        if (status == null) status = Enums.CourseStatus.DRAFT;
        if (priceCents == null) priceCents = 0;
        if (currency == null) currency = "INR";
        if (visibility == null) visibility = Enums.CourseVisibility.CATALOG;
        if (sequential == null) sequential = true;
        if (certExpiryMonths == null) certExpiryMonths = 0;
        if (coverHue == null) coverHue = 220;
        if (coverIcon == null) coverIcon = "book";
        if (title == null) title = "";
        if (description == null) description = "";
        if (category == null) category = "Sales";
        if (level == null) level = "Beginner";
    }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
