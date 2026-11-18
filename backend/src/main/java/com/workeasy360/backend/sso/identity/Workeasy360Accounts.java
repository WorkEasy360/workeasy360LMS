package com.workeasy360.backend.sso.identity;

import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.service.AuditService;
import com.workeasy360.backend.service.EntitlementService;
import com.workeasy360.backend.service.OrgSettingsService;
import com.workeasy360.backend.sso.SignInErrors;
import com.workeasy360.backend.sso.Workeasy360Properties;
import com.workeasy360.backend.web.ApiException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Turns a verified WorkEasy360 sign-in into a WorkEasyLMS account in a WorkEasyLMS organization, or refuses it.
 *
 * <h2>Organization</h2>
 * The token's {@code organization_id} is looked up in {@link OrganizationLinks}. Not linked yet: with
 * {@code WORKEASY360_AUTO_PROVISION} on (the default) a new WorkEasyLMS organization is created and linked, named
 * from {@code organization_name} (the {@code organization} scope); otherwise the sign-in is refused until an operator
 * links one ({@code w360sso link}). A linked organization that is suspended in WorkEasyLMS, or whose own WorkEasyLMS
 * subscription has lapsed, is refused. A new organization gets no WorkEasyLMS subscription: its access is decided by
 * WorkEasy360's entitlement alone.
 *
 * <h2>Person</h2>
 * Identity is (issuer, {@code sub}) ({@link FederatedIdentities}), never the e-mail. A person seen before is the
 * account linked then, which must still be in the organization the token names: <strong>a sign-in never crosses
 * organizations</strong> ({@code account_conflict}). A person not seen before is, in this order:
 * <ol>
 *   <li>when an existing account has the same address: <strong>refused</strong> ({@code account_conflict}) by
 *       default. Nothing is merged on an address; an operator links the account ({@code w360sso link-user}, audited,
 *       {@link Workeasy360Operator}). Only with {@code WORKEASY360_LINK_BY_VERIFIED_EMAIL=true} is that account
 *       linked by the sign-in itself, and then only when WorkEasy360 says {@code email_verified} (the ID token check
 *       already insists), only inside the organization the token names, never an account already linked to another
 *       identity, never the platform owner, and each such link is audited ({@code workeasy360.account_linked},
 *       automatic). A link never removes the account's password or ends its sessions: {@code WORKEASY360_SSO_ONLY}
 *       is what retires password sign-in;</li>
 *   <li>otherwise a new account: the organization's administrator when it has nobody yet (the first person of an
 *       organization WorkEasy360 just created), a learner otherwise. Administrators change roles under People as
 *       before.</li>
 * </ol>
 * An address that belongs to an account in another organization is refused ({@code account_conflict}): WorkEasyLMS
 * addresses are unique, so the person cannot have a second account. A deactivated account is refused
 * ({@code account_disabled}).
 *
 * <p>Everything happens in one transaction, retried when a concurrent first sign-in of the same organization or
 * person won the race (the unique constraints decide; the loser reads the winner's rows).
 */
@Service
public class Workeasy360Accounts {

    private static final Logger log = LoggerFactory.getLogger(Workeasy360Accounts.class);
    private static final int ATTEMPTS = 3;

    /** The verified claims a sign-in carries. */
    public record SignInClaims(String issuer, String subject, UUID workeasy360OrgId, String organizationName,
                               String email, String name) {
    }

    /** The account the sign-in is for. */
    public record Linked(String userId, String orgId, Role role) {
    }

    /** The sign-in must not go ahead; {@link #code()} is from the {@code sso_error} vocabulary. */
    public static final class Refused extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private final String code;

        public Refused(String code, String reason) {
            super(reason, null, false, false);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }

    private final Workeasy360Properties properties;
    private final OrganizationLinks links;
    private final FederatedIdentities identities;
    private final UserRepo users;
    private final OrganizationRepo orgs;
    private final OrgSettingsService settings;
    private final EntitlementService lmsPlans;
    private final AuditService audit;
    private final PasswordEncoder encoder;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public Workeasy360Accounts(Workeasy360Properties properties, OrganizationLinks links, FederatedIdentities identities,
                               UserRepo users, OrganizationRepo orgs, OrgSettingsService settings,
                               EntitlementService lmsPlans, AuditService audit, PasswordEncoder encoder,
                               JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                               Clock clock) {
        this.properties = properties;
        this.links = links;
        this.identities = identities;
        this.users = users;
        this.orgs = orgs;
        this.settings = settings;
        this.lmsPlans = lmsPlans;
        this.audit = audit;
        this.encoder = encoder;
        this.jdbc = jdbc;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    /**
     * @throws Refused when the sign-in must not go ahead
     * @throws RuntimeException when the database cannot be used (the caller answers {@code unavailable})
     */
    public Linked signIn(SignInClaims claims) {
        DataIntegrityViolationException last = null;
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            try {
                return transactions.execute(status -> signInOnce(claims));
            } catch (DataIntegrityViolationException raced) {
                last = raced;
            }
        }
        throw last;
    }

    private Linked signInOnce(SignInClaims claims) {
        Instant now = clock.instant();
        String orgId = organization(claims, now);
        // One sign-in at a time per organization from here on: "the first person becomes its administrator" must not
        // be true of two people at once.
        jdbc.query("select id from organizations where id = ? for update", rs -> { }, orgId);

        Optional<FederatedIdentities.Identity> known = identities.find(claims.issuer(), claims.subject());
        if (known.isPresent()) {
            User user = users.findById(known.get().userId())
                    .orElseThrow(() -> new Refused(SignInErrors.REFUSED, "linked account vanished"));
            requireUsable(user, orgId);
            identities.signedIn(known.get().id(), claims.email(), claims.name(), now);
            return new Linked(user.getId(), orgId, user.getRole());
        }

        String email = claims.email().strip().toLowerCase(Locale.ROOT);
        Optional<User> sameAddress = users.findByEmailIgnoreCase(email);
        if (sameAddress.isPresent()) {
            User user = sameAddress.get();
            requireUsable(user, orgId); // the platform owner, another organization (another tenant), deactivated
            if (identities.forUser(user.getId()).isPresent()) {
                throw new Refused(SignInErrors.ACCOUNT_CONFLICT, "account already linked to another identity");
            }
            if (!properties.linkByVerifiedEmail()) {
                // The same address is not the same person: an operator vouches for the link (w360sso link-user).
                log.info("workeasy360.account_link_refused user={} organization={} reason=operator_link_required",
                        user.getId(), orgId);
                throw new Refused(SignInErrors.ACCOUNT_CONFLICT,
                        "an account with this address exists and is not linked; an operator links it (w360sso link-user)");
            }
            identities.insert(claims.issuer(), claims.subject(), user.getId(), email, claims.name(), now);
            // The password and the sessions the account has are left as they are: WORKEASY360_SSO_ONLY retires them.
            audit.record(user.getId(), orgId, "workeasy360.account_linked",
                    "automatic link by WorkEasy360-verified address (WORKEASY360_LINK_BY_VERIFIED_EMAIL=true): account "
                            + user.getId() + " to WorkEasy360 person " + claims.subject() + " of organization "
                            + claims.workeasy360OrgId() + " under " + claims.issuer() + "; password and sessions kept");
            log.info("workeasy360.account_linked user={} organization={} automatic=true", user.getId(), orgId);
            return new Linked(user.getId(), orgId, user.getRole());
        }

        boolean first = users.countByOrgId(orgId) == 0;
        if (!first) {
            try {
                lmsPlans.requireUserCapacity(orgId); // the organization's own WorkEasyLMS plan, when it has one
            } catch (ApiException full) {
                throw new Refused(SignInErrors.NO_SEAT, "WorkEasyLMS plan seat limit reached");
            }
        }
        Role role = first ? Role.ADMIN : Role.LEARNER;
        String name = displayName(claims.name(), email);
        User user = users.saveAndFlush(User.builder()
                .name(name).email(email).role(role).orgId(orgId)
                .passwordHash(encoder.encode(unguessable()))
                .title(first ? "Administrator" : "Learner").dept(first ? "Management" : "WorkEasy360")
                .hue((int) (Math.abs(email.hashCode()) % 360)).status("ACTIVE").streak(0)
                .tokensValidAfter(now)
                .build());
        identities.insert(claims.issuer(), claims.subject(), user.getId(), email, claims.name(), now);
        audit.record(user.getId(), orgId, "workeasy360.account_created", "first WorkEasy360 sign-in, role " + role);
        log.info("workeasy360.account_created user={} organization={} role={}", user.getId(), orgId, role);
        return new Linked(user.getId(), orgId, role);
    }

    /** The WorkEasyLMS organization for the token's organization, created and linked when allowed. */
    private String organization(SignInClaims claims, Instant now) {
        Optional<OrganizationLinks.Link> link = links.find(claims.issuer(), claims.workeasy360OrgId());
        String orgId;
        if (link.isPresent()) {
            orgId = link.get().orgId();
        } else if (properties.autoProvision()) {
            String name = organizationName(claims.organizationName());
            Organization created = orgs.saveAndFlush(Organization.builder()
                    .name(name).slug(uniqueSlug(name)).status("ACTIVE").build());
            settings.forOrg(created.getId());
            links.insert(claims.issuer(), claims.workeasy360OrgId(), created.getId(), OrganizationLinks.BY_FIRST_SIGN_IN, now);
            audit.record(null, created.getId(), "workeasy360.organization_linked",
                    "created at the first WorkEasy360 sign-in for organization " + claims.workeasy360OrgId());
            log.info("workeasy360.organization_created organization={} workeasy360_organization={}",
                    created.getId(), claims.workeasy360OrgId());
            orgId = created.getId();
        } else {
            throw new Refused(SignInErrors.REFUSED, "organization not linked and auto-provisioning is off");
        }
        Organization org = orgs.findById(orgId)
                .orElseThrow(() -> new Refused(SignInErrors.ORGANIZATION_INACTIVE, "linked organization vanished"));
        if (Organization.PLATFORM.equals(org.getId())) {
            throw new Refused(SignInErrors.REFUSED, "the platform organization cannot be signed in to");
        }
        if ("SUSPENDED".equals(org.getStatus())) {
            throw new Refused(SignInErrors.ORGANIZATION_INACTIVE, "organization suspended in WorkEasyLMS");
        }
        try {
            lmsPlans.requireSignInAllowed(org.getId()); // its own WorkEasyLMS subscription, when it still has one
        } catch (ApiException lapsed) {
            throw new Refused(SignInErrors.NOT_ENTITLED, "WorkEasyLMS subscription not active");
        }
        return org.getId();
    }

    private static void requireUsable(User user, String orgId) {
        if (user.getRole() == Role.PLATFORM || Organization.PLATFORM.equals(user.getOrgId())) {
            throw new Refused(SignInErrors.ACCOUNT_CONFLICT, "the platform owner account is never linked");
        }
        if (!orgId.equals(user.getOrgId())) {
            throw new Refused(SignInErrors.ACCOUNT_CONFLICT, "account belongs to another organization");
        }
        if ("INACTIVE".equalsIgnoreCase(user.getStatus())) {
            throw new Refused(SignInErrors.ACCOUNT_DISABLED, "account deactivated");
        }
    }

    private String unguessable() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String displayName(String name, String email) {
        String value = name == null || name.isBlank() ? email.substring(0, email.indexOf('@')) : name.strip();
        if (value.length() < 2) {
            value = email;
        }
        return value.length() > 160 ? value.substring(0, 160) : value;
    }

    private static String organizationName(String name) {
        String value = name == null || name.isBlank() ? "WorkEasy360 organization" : name.strip();
        return value.length() > 160 ? value.substring(0, 160) : value;
    }

    private String uniqueSlug(String name) {
        String base = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        if (base.isBlank()) {
            base = "org";
        }
        if (base.length() > 60) {
            base = base.substring(0, 60);
        }
        String slug = base;
        int n = 2;
        while (orgs.findBySlugIgnoreCase(slug).isPresent()) {
            slug = base + "-" + n++;
        }
        return slug;
    }
}
