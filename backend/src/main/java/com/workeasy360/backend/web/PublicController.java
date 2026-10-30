package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Plan;
import com.workeasy360.backend.repo.Repos.PlanRepo;
import com.workeasy360.backend.service.OrgProvisioningService;
import com.workeasy360.backend.service.OrgProvisioningService.Provisioned;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The public commercial surface: the live plan catalogue (for the product site and the sign-up page) and self-serve
 * company registration, which provisions a TRIAL organization automatically — no WorkEasy360 staff involved.
 * Paid checkout activates through the payment provider's verified confirmation (OrderService), never through a
 * client-claimed status; until a real provider is configured, new customers start on a trial.
 */
@RestController
@RequestMapping("/api/public")
public class PublicController {
    private final PlanRepo plans; private final OrgProvisioningService provisioning;
    public PublicController(PlanRepo plans, OrgProvisioningService provisioning) { this.plans = plans; this.provisioning = provisioning; }

    public record PublicPlan(String id, String name, String description, int priceCents, String currency, String billingPeriod,
                             Integer maxUsers, Integer maxCourses, int trialDays) {}

    @GetMapping("/plans")
    public List<PublicPlan> plans() {
        return plans.findByStatusOrderByPositionAsc("ACTIVE").stream()
                .map(p -> new PublicPlan(p.getId(), p.getName(), p.getDescription(), p.getPriceCents(), p.getCurrency(),
                        p.getBillingPeriod(), p.getMaxUsers(), p.getMaxCourses(), p.getTrialDays() == null ? 14 : p.getTrialDays()))
                .toList();
    }

    public record RegisterOrgRequest(String company, String adminName, String adminEmail, String planId) {}

    // Light abuse throttle: at most 3 registrations per e-mail address per hour (in-memory; single-process deployment).
    private final ConcurrentHashMap<String, long[]> attempts = new ConcurrentHashMap<>();

    @PostMapping("/organizations")
    public Map<String, Object> register(@RequestBody RegisterOrgRequest req) {
        String email = req == null || req.adminEmail() == null ? "" : req.adminEmail().trim().toLowerCase();
        if (attempts.size() > 10_000) attempts.entrySet().removeIf(e -> System.currentTimeMillis() - e.getValue()[1] > 3_600_000L);
        long[] a = attempts.compute(email, (k, v) -> v == null || System.currentTimeMillis() - v[1] > 3_600_000L ? new long[]{1, System.currentTimeMillis()} : new long[]{v[0] + 1, v[1]});
        if (a[0] > 3) throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "Too many sign-up attempts. Try again later.");

        Provisioned p = provisioning.provision(req == null ? null : req.company(), req == null ? null : req.adminName(), email,
                req == null ? null : req.planId(), null);
        // Never leak internals: only what the new customer needs to proceed.
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("organization", p.orgName());
        out.put("plan", p.planId());
        out.put("status", p.subscriptionStatus());
        out.put("adminEmail", p.adminEmail());
        out.put("emailed", p.emailed());
        if (p.resetPath() != null) out.put("resetPath", p.resetPath()); // no mail server: shown once so the admin can set their password
        return out;
    }
}
