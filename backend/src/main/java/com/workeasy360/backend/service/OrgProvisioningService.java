package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.Plan;
import com.workeasy360.backend.domain.Subscription;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.repo.Repos.PlanRepo;
import com.workeasy360.backend.repo.Repos.SubscriptionRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.web.ApiException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;

/**
 * Creates a customer organization end to end — organization, settings, subscription, first administrator — in one
 * transaction, so a half-provisioned customer can never exist. The administrator never receives a password through
 * any channel: they get a one-time password-reset link (e-mailed when SMTP is configured, otherwise returned once
 * to the caller to hand over).
 *
 * Idempotency: a verified payment reference (orderRef) that was already provisioned returns the existing
 * organization instead of creating a duplicate, so a replayed webhook or double-submitted form is harmless.
 */
@Service
public class OrgProvisioningService {
    private final OrganizationRepo orgs; private final SubscriptionRepo subscriptions; private final PlanRepo plans;
    private final UserRepo users; private final PasswordEncoder encoder; private final OrgSettingsService settings;
    private final PasswordResetService passwordResets; private final MailService mail; private final AuditService audit;
    private final SecureRandom random = new SecureRandom();

    public OrgProvisioningService(OrganizationRepo orgs, SubscriptionRepo subscriptions, PlanRepo plans, UserRepo users,
                                  PasswordEncoder encoder, OrgSettingsService settings, PasswordResetService passwordResets,
                                  MailService mail, AuditService audit) {
        this.orgs = orgs; this.subscriptions = subscriptions; this.plans = plans; this.users = users;
        this.encoder = encoder; this.settings = settings; this.passwordResets = passwordResets; this.mail = mail; this.audit = audit;
    }

    public record Provisioned(String orgId, String orgName, String slug, String adminUserId, String adminEmail,
                              String planId, String subscriptionStatus, String resetPath, boolean emailed, boolean alreadyExisted) {}

    @Transactional
    public Provisioned provision(String companyName, String adminName, String adminEmail, String planId, String orderRef) {
        String name = companyName == null ? "" : companyName.trim();
        String email = adminEmail == null ? "" : adminEmail.trim().toLowerCase();
        String person = adminName == null || adminName.isBlank() ? "Administrator" : adminName.trim();
        if (name.length() < 2 || name.length() > 160) throw ApiException.badRequest("Enter your company name.");
        if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$") || email.length() > 160) throw ApiException.badRequest("Enter a valid e-mail address for the administrator.");

        // A replayed payment webhook or a double-submitted form must not create a second organization.
        if (orderRef != null && !orderRef.isBlank()) {
            var existing = subscriptions.findByOrderRef(orderRef);
            if (existing.isPresent()) {
                Subscription s = existing.get();
                Organization org = orgs.findById(s.getOrgId()).orElseThrow();
                User admin = users.findByOrgIdAndRole(org.getId(), Role.ADMIN).stream().findFirst().orElse(null);
                return new Provisioned(org.getId(), org.getName(), org.getSlug(), admin == null ? null : admin.getId(),
                        admin == null ? null : admin.getEmail(), s.getPlanId(), s.getStatus(), null, false, true);
            }
        }
        if (users.findByEmailIgnoreCase(email).isPresent())
            throw ApiException.conflict("An account with that e-mail already exists. Sign in instead, or use a different address.");

        Plan plan = plans.findById(planId == null || planId.isBlank() ? "plan-starter" : planId)
                .filter(p -> "ACTIVE".equals(p.getStatus()))
                .orElseThrow(() -> ApiException.badRequest("That plan is not available."));

        Organization org = orgs.save(Organization.builder().name(name).slug(uniqueSlug(name)).status("ACTIVE").build());
        settings.forOrg(org.getId()); // the organization's own settings row, seeded with defaults + its name

        boolean paid = orderRef != null && !orderRef.isBlank();
        Instant now = Instant.now();
        Subscription sub = subscriptions.save(Subscription.builder()
                .orgId(org.getId()).planId(plan.getId())
                .status(paid ? "ACTIVE" : "TRIAL")
                .trialEndsAt(paid ? null : now.plus(plan.getTrialDays() == null ? 14 : plan.getTrialDays(), ChronoUnit.DAYS))
                .renewsAt(paid ? now.plus("ANNUAL".equals(plan.getBillingPeriod()) ? 365 : 30, ChronoUnit.DAYS) : null)
                .orderRef(paid ? orderRef : null)
                .build());

        // The first administrator: created with a random password nobody knows; handover is a one-time reset link.
        byte[] b = new byte[24]; random.nextBytes(b);
        User admin = users.save(User.builder()
                .name(person).email(email).role(Role.ADMIN).orgId(org.getId())
                .passwordHash(encoder.encode(Base64.getUrlEncoder().withoutPadding().encodeToString(b)))
                .title("Administrator").dept("Management").hue((int) (Math.abs(email.hashCode()) % 360))
                .status("ACTIVE").streak(0).build());

        String token = passwordResets.issue(admin.getId(), null);
        String resetPath = "#/reset/" + token;
        boolean emailed = mail.enabled();
        if (emailed) {
            String base = mail.publicUrl();
            mail.send(email, "Your WorkEasyLMS workspace for " + name + " is ready",
                    "Hi " + person + ",\n\nYour organisation's WorkEasyLMS workspace has been created on the " + plan.getName() + " plan.\n\n"
                    + "Set your administrator password here (the link works once, for " + PasswordResetService.EXPIRY_MINUTES + " minutes):\n"
                    + (base.isBlank() ? "" : base + "/") + resetPath
                    + "\n\nAfter signing in: set your organisation name and logo under Settings, then add instructors and learners under People."
                    + "\n\n— WorkEasyLMS · workeasy360.com");
        }
        audit.record(admin.getId(), org.getId(), "org.provisioned",
                name + " (" + org.getSlug() + ") on " + plan.getName() + (paid ? ", paid ref " + orderRef : ", trial"));
        return new Provisioned(org.getId(), org.getName(), org.getSlug(), admin.getId(), admin.getEmail(),
                plan.getId(), sub.getStatus(), emailed ? null : resetPath, emailed, false);
    }

    private String uniqueSlug(String name) {
        String base = name.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        if (base.isBlank()) base = "org";
        if (base.length() > 60) base = base.substring(0, 60);
        String slug = base;
        int n = 2;
        while (orgs.findBySlugIgnoreCase(slug).isPresent()) slug = base + "-" + n++;
        return slug;
    }
}
