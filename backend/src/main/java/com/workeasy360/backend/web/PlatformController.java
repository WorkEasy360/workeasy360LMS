package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.AuditEvent;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.Plan;
import com.workeasy360.backend.domain.Subscription;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.AuditService;
import com.workeasy360.backend.service.PermissionService;
import com.workeasy360.backend.service.SyncService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * WorkEasy360's own (product owner) administration: every organization, subscription, plan and audit trail across
 * the platform. Available exclusively to the PLATFORM role — customer organization admins can never reach it, and
 * platform staff are not members of any customer organization. Reads are platform-wide; the only writes are plan
 * management and organization suspend/activate, each audited.
 */
@RestController
@RequestMapping("/api/platform")
public class PlatformController {
    private final OrganizationRepo orgs; private final SubscriptionRepo subscriptions; private final PlanRepo plans;
    private final UserRepo users; private final CourseRepo courses; private final AuditEventRepo auditEvents;
    private final PermissionService perm; private final AuditService audit; private final SyncService sync;

    public PlatformController(OrganizationRepo orgs, SubscriptionRepo subscriptions, PlanRepo plans, UserRepo users,
                              CourseRepo courses, AuditEventRepo auditEvents, PermissionService perm, AuditService audit, SyncService sync) {
        this.orgs = orgs; this.subscriptions = subscriptions; this.plans = plans; this.users = users;
        this.courses = courses; this.auditEvents = auditEvents; this.perm = perm; this.audit = audit; this.sync = sync;
    }

    private void requirePlatform(CurrentUser me) {
        if (me == null || !perm.isPlatform(me)) throw ApiException.forbidden("This area is for the WorkEasy360 platform owner");
    }

    // ---------- organizations ----------
    public record OrgRow(String id, String name, String slug, String status, Instant createdAt,
                         String planId, String planName, String subscriptionStatus, Instant trialEndsAt, Instant renewsAt,
                         long people, long coursesCount) {}

    @GetMapping("/organizations")
    public List<OrgRow> organizations(@AuthenticationPrincipal CurrentUser me, @RequestParam(required = false) String q) {
        requirePlatform(me);
        Map<String, Plan> planById = new LinkedHashMap<>();
        plans.findAll().forEach(p -> planById.put(p.getId(), p));
        return orgs.findAll().stream()
                .filter(o -> !Organization.PLATFORM.equals(o.getId()))
                .filter(o -> q == null || q.isBlank() || (o.getName() + " " + o.getSlug()).toLowerCase().contains(q.toLowerCase()))
                .sorted(java.util.Comparator.comparing(Organization::getCreatedAt).reversed())
                .map(o -> {
                    Subscription s = subscriptions.findFirstByOrgIdOrderByCreatedAtDesc(o.getId()).orElse(null);
                    Plan p = s == null ? null : planById.get(s.getPlanId());
                    return new OrgRow(o.getId(), o.getName(), o.getSlug(), o.getStatus(), o.getCreatedAt(),
                            p == null ? null : p.getId(), p == null ? null : p.getName(), s == null ? null : s.getStatus(),
                            s == null ? null : s.getTrialEndsAt(), s == null ? null : s.getRenewsAt(),
                            users.countByOrgId(o.getId()), courses.countByOrgId(o.getId()));
                }).toList();
    }

    public record StatusRequest(String status) {}

    /** Suspend or reactivate a customer organization. Suspended organizations cannot sign in at all. */
    @PostMapping("/organizations/{id}/status")
    public Map<String, Object> setStatus(@AuthenticationPrincipal CurrentUser me, @PathVariable String id, @RequestBody StatusRequest req) {
        requirePlatform(me);
        if (Organization.PLATFORM.equals(id)) throw ApiException.badRequest("The platform organization cannot be changed");
        Organization o = orgs.findById(id).orElseThrow(() -> ApiException.notFound("Organization"));
        String status = req == null || req.status() == null ? "" : req.status().toUpperCase();
        if (!List.of("ACTIVE", "SUSPENDED").contains(status)) throw ApiException.badRequest("Status must be ACTIVE or SUSPENDED");
        o.setStatus(status);
        orgs.save(o);
        if ("SUSPENDED".equals(status)) users.findByOrgId(id).forEach(u -> sync.disconnectUser(u.getId())); // drop live sessions' streams
        audit.record(me.getId(), id, "org.status", o.getName() + " -> " + status);
        return Map.of("id", o.getId(), "status", o.getStatus());
    }

    // ---------- platform analytics ----------
    @GetMapping("/stats")
    public Map<String, Object> stats(@AuthenticationPrincipal CurrentUser me) {
        requirePlatform(me);
        Map<String, Object> out = new LinkedHashMap<>();
        long orgCount = orgs.count() - 1; // the platform org itself is not a customer
        out.put("organizations", orgCount);
        out.put("organizationsActive", Math.max(0, orgs.countByStatus("ACTIVE") - 1));
        out.put("organizationsSuspended", orgs.countByStatus("SUSPENDED"));
        out.put("subscriptionsTrial", subscriptions.countByStatus("TRIAL"));
        out.put("subscriptionsActive", subscriptions.countByStatus("ACTIVE"));
        out.put("learners", users.countByRole(Role.LEARNER));
        out.put("instructors", users.countByRole(Role.INSTRUCTOR));
        out.put("admins", users.countByRole(Role.ADMIN));
        out.put("courses", courses.count());
        return out;
    }

    // ---------- plan catalogue management ----------
    public record UpsertPlanRequest(String id, String name, String description, Integer priceCents, String currency,
                                    String billingPeriod, Integer maxUsers, Integer maxCourses, Integer trialDays,
                                    String status, Integer position) {}

    @GetMapping("/plans")
    public List<Plan> allPlans(@AuthenticationPrincipal CurrentUser me) { requirePlatform(me); return plans.findAll(); }

    @PostMapping("/plans")
    public Plan upsertPlan(@AuthenticationPrincipal CurrentUser me, @RequestBody UpsertPlanRequest req) {
        requirePlatform(me);
        Plan p = req.id() != null ? plans.findById(req.id()).orElseGet(() -> Plan.builder().id(req.id()).build()) : Plan.builder().build();
        if (req.name() != null) p.setName(req.name().trim());
        if (p.getName() == null || p.getName().isBlank()) throw ApiException.badRequest("A plan needs a name");
        if (req.description() != null) p.setDescription(req.description());
        if (req.priceCents() != null) { if (req.priceCents() < 0) throw ApiException.badRequest("Price can't be negative"); p.setPriceCents(req.priceCents()); }
        if (req.currency() != null) p.setCurrency(req.currency().trim().toUpperCase());
        if (req.billingPeriod() != null) { String b = req.billingPeriod().toUpperCase(); if (!List.of("MONTHLY", "ANNUAL").contains(b)) throw ApiException.badRequest("Billing period must be MONTHLY or ANNUAL"); p.setBillingPeriod(b); }
        if (req.maxUsers() != null) p.setMaxUsers(req.maxUsers() <= 0 ? null : req.maxUsers());
        if (req.maxCourses() != null) p.setMaxCourses(req.maxCourses() <= 0 ? null : req.maxCourses());
        if (req.trialDays() != null) p.setTrialDays(Math.max(0, req.trialDays()));
        if (req.status() != null) { String s = req.status().toUpperCase(); if (!List.of("ACTIVE", "RETIRED").contains(s)) throw ApiException.badRequest("Status must be ACTIVE or RETIRED"); p.setStatus(s); }
        if (req.position() != null) p.setPosition(req.position());
        Plan saved = plans.save(p);
        audit.record(me.getId(), null, "plan.upsert", saved.getId() + " " + saved.getName() + " " + saved.getPriceCents() + " " + saved.getCurrency() + "/" + saved.getBillingPeriod() + " status=" + saved.getStatus());
        return saved;
    }

    // ---------- audit log ----------
    @GetMapping("/audit")
    public List<AuditEvent> audit(@AuthenticationPrincipal CurrentUser me, @RequestParam(required = false) String orgId) {
        requirePlatform(me);
        return orgId == null || orgId.isBlank() ? auditEvents.findTop200ByOrderByAtDesc() : auditEvents.findTop200ByOrgIdOrderByAtDesc(orgId);
    }
}
