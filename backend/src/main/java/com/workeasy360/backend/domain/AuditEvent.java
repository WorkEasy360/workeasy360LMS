package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

/** One auditable administrative action. Never contains passwords, tokens or payment credentials. */
@Entity @Table(name = "audit_events")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AuditEvent {
    @Id
    private String id;

    @Column(nullable = false) private Instant at;
    @Column(name = "actor_id", length = 40) private String actorId;
    @Column(name = "org_id", length = 40)   private String orgId;
    @Column(nullable = false, length = 80)  private String action;
    @Column(length = 2000)                  private String detail;
    @Column(nullable = false, length = 20)  private String outcome;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("aud"); if (at == null) at = Instant.now(); if (outcome == null) outcome = "OK"; }
}
