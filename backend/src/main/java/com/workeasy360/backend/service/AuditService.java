package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.AuditEvent;
import com.workeasy360.backend.repo.Repos.AuditEventRepo;
import org.springframework.stereotype.Service;

/**
 * Append-only record of sensitive administrative actions: who did what, in which organization, when, with what
 * outcome. Detail strings are short human-readable summaries — never passwords, tokens or payment credentials.
 * Writing an audit row must never break the operation it describes, so failures are swallowed after logging.
 */
@Service
public class AuditService {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AuditService.class);
    private final AuditEventRepo events;
    public AuditService(AuditEventRepo events) { this.events = events; }

    public void record(String actorId, String orgId, String action, String detail) { record(actorId, orgId, action, detail, "OK"); }

    public void record(String actorId, String orgId, String action, String detail, String outcome) {
        try {
            events.save(AuditEvent.builder().actorId(actorId).orgId(orgId).action(action)
                    .detail(detail == null ? null : detail.length() > 2000 ? detail.substring(0, 2000) : detail)
                    .outcome(outcome).build());
        } catch (Exception e) {
            log.warn("audit write failed for action {}: {}", action, e.getMessage());
        }
    }
}
