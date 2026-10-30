package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;

@Entity @Table(name = "settings")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Settings {
    @Id private String id;
    @Column(name = "org_name", nullable = false) private String orgName;
    @Column(name = "support_email", nullable = false) private String supportEmail;
    @Column(name = "cert_expiry_default", nullable = false) private Integer certExpiryDefault;
    @Column(name = "guides_enabled", nullable = false) private Boolean guidesEnabled;
    @Column(name = "community_enabled", nullable = false) private Boolean communityEnabled;
    @Column(name = "brand_hue", nullable = false) private Integer brandHue;
    @Column(name = "max_video_mb", nullable = false) private Integer maxVideoMb;
    @Column(name = "instructor_publish", nullable = false) private Boolean instructorPublish;
    @Column(name = "automation_json") private String automationJson; // {enrolmentNotifications, dueReminders, certificateExpiry, reviewNotifications, discussionReplies}
    @Column(name = "org_logo") private String orgLogo; // small data: image printed on certificates as the issuer's logo; null = name only
    @Column(name = "org_id", nullable = false, length = 40) private String orgId; // one settings row per organization

    @PrePersist void prePersist() { if (orgId == null) orgId = Organization.DEFAULT; }
}
