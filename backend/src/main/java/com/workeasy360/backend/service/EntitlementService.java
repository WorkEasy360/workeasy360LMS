package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.Plan;
import com.workeasy360.backend.domain.Subscription;
import com.workeasy360.backend.repo.Repos.CourseRepo;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.repo.Repos.PlanRepo;
import com.workeasy360.backend.repo.Repos.SubscriptionRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Optional;

/**
 * Backend enforcement of what an organization's subscription allows. The frontend never decides entitlements; it
 * only renders what these checks let through. Organizations without a subscription row (the pre-tenancy default
 * installation keeps one seeded by the migration) are treated as unlimited to preserve existing behaviour.
 */
@Service
public class EntitlementService {
    private final SubscriptionRepo subscriptions; private final PlanRepo plans; private final OrganizationRepo orgs;
    private final UserRepo users; private final CourseRepo courses;

    public EntitlementService(SubscriptionRepo subscriptions, PlanRepo plans, OrganizationRepo orgs, UserRepo users, CourseRepo courses) {
        this.subscriptions = subscriptions; this.plans = plans; this.orgs = orgs; this.users = users; this.courses = courses;
    }

    public Optional<Subscription> current(String orgId) { return subscriptions.findFirstByOrgIdOrderByCreatedAtDesc(orgId); }
    public Optional<Plan> planOf(Subscription s) { return s == null ? Optional.empty() : plans.findById(s.getPlanId()); }

    /** Sign-in gate: a suspended organization, or one whose subscription has lapsed, cannot sign in. */
    public void requireSignInAllowed(String orgId) {
        if (orgId == null || Organization.PLATFORM.equals(orgId)) return;
        Organization org = orgs.findById(orgId).orElse(null);
        if (org != null && "SUSPENDED".equals(org.getStatus()))
            throw ApiException.forbidden("This organisation's account is suspended. Contact WorkEasy360 support.");
        Subscription s = current(orgId).orElse(null);
        if (s == null) return;
        if ("SUSPENDED".equals(s.getStatus()) || "EXPIRED".equals(s.getStatus()) || "CANCELLED".equals(s.getStatus()))
            throw ApiException.forbidden("This organisation's subscription is not active. Contact your administrator or WorkEasy360 support.");
        if ("TRIAL".equals(s.getStatus()) && s.getTrialEndsAt() != null && s.getTrialEndsAt().isBefore(Instant.now()))
            throw ApiException.forbidden("This organisation's trial has ended. Choose a plan to continue.");
    }

    /** Seat limit: adding a person must stay within the plan. */
    public void requireUserCapacity(String orgId) {
        Integer max = limit(orgId, true);
        if (max != null && users.countByOrgId(orgId) >= max)
            throw ApiException.conflict("Your plan allows up to " + max + " people. Upgrade the plan to add more.");
    }

    /** Course limit: creating a course must stay within the plan. */
    public void requireCourseCapacity(String orgId) {
        Integer max = limit(orgId, false);
        if (max != null && courses.countByOrgId(orgId) >= max)
            throw ApiException.conflict("Your plan allows up to " + max + " courses. Upgrade the plan to add more.");
    }

    private Integer limit(String orgId, boolean usersLimit) {
        if (orgId == null || Organization.PLATFORM.equals(orgId)) return null;
        return current(orgId).flatMap(this::planOf).map(p -> usersLimit ? p.getMaxUsers() : p.getMaxCourses()).orElse(null);
    }
}
