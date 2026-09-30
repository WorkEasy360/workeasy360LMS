package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "certificates")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Certificate {
    @Id private String id;

    @Column(name = "certificate_number", nullable = false, unique = true, length = 60) private String certificateNumber;
    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(name = "course_id", nullable = false, length = 40) private String courseId;

    @Column(name = "issued_at", nullable = false) private Instant issuedAt;
    @Column(name = "expires_at") private Instant expiresAt;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.CertificateStatus status;

    @Column(nullable = false) private Boolean revoked;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("cert"); if (issuedAt == null) issuedAt = Instant.now(); if (status == null) status = Enums.CertificateStatus.VALID; if (revoked == null) revoked = false; }
}
