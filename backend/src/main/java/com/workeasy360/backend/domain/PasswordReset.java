package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "password_resets")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class PasswordReset {
    @Id private String id;
    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    /** SHA-256 hex of the raw token; the raw token only ever lives in the link. */
    @Column(name = "token_hash", nullable = false, unique = true, length = 64) private String tokenHash;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(name = "used_at") private Instant usedAt;
    /** The admin who issued the link, or null for a self-service "forgot password" request. */
    @Column(name = "created_by", length = 40) private String createdBy;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
}
