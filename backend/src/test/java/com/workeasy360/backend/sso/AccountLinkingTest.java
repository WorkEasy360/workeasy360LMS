package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.User;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Account linking with the default settings ({@code WORKEASY360_LINK_BY_VERIFIED_EMAIL} off): an address that
 * belongs to an existing WorkEasyLMS account is never merged by a sign-in; the operator links it
 * ({@code w360sso link-user}), audited, and the account keeps its password.
 */
@EnabledIfEnvironmentVariable(named = "LMS_TEST_DB_URL", matches = ".+", disabledReason = "needs PostgreSQL: set LMS_TEST_DB_URL")
@DisplayName("Account linking by default: an e-mail match is refused; the operator links, audited")
class AccountLinkingTest extends AccountLinkingTestBase {

    @Test
    @DisplayName("a verified e-mail match to an account in the linked organization is account_conflict; nothing is linked or changed")
    void emailMatchRefusedByDefault() throws Exception {
        Legacy legacy = legacyCustomer(Role.INSTRUCTOR);
        String token = login(legacy.email());

        MvcResult result = signInFresh("organization=" + legacy.workeasy360Org(), spec -> spec.email = legacy.email().toUpperCase());

        assertThat(ssoError(result)).isEqualTo("account_conflict");
        assertThat(signedIn(sessionOf(result))).isFalse();
        assertThat(identityCount(legacy.user().getId())).as("no identity was linked").isZero();
        assertThat(users.countByOrgId(legacy.orgId())).as("no second account was created").isEqualTo(1);
        assertThat(auditCount("workeasy360.account_linked", legacy.orgId())).isZero();
        // The account is exactly as it was: its password and its bearer token still work.
        mvc.perform(get("/api/courses").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        login(legacy.email());
    }

    @Test
    @DisplayName("w360sso link-user binds the account to the WorkEasy360 person, audited with actor and reason; password and sessions stay")
    void operatorLinksAndAudits() throws Exception {
        Legacy legacy = legacyCustomer(Role.INSTRUCTOR);
        String token = login(legacy.email());
        String subject = uuid();

        Run run = operator("link-user", "--user=" + legacy.email().toUpperCase(),
                "--workeasy360-organization=" + legacy.workeasy360Org(), "--subject=" + subject,
                "--actor=ops-oncall@workeasy360", "--reason=ticket LMS-42: migrating Legacy to WorkEasy360");
        assertThat(run.status()).as(run.output()).isZero();
        assertThat(run.output()).contains("linked account " + legacy.user().getId());

        assertThat(jdbc.queryForObject("select user_id from federated_identities where issuer = ? and subject = ?",
                String.class, FAKE.issuer(), subject)).isEqualTo(legacy.user().getId());
        String detail = jdbc.queryForObject("select detail from audit_events where action = 'workeasy360.operator.link_user'"
                + " and org_id = ?", String.class, legacy.orgId());
        assertThat(detail).contains(legacy.user().getId()).contains(subject).contains(legacy.workeasy360Org().toString())
                .contains(FAKE.issuer()).contains("ops-oncall@workeasy360").contains("ticket LMS-42");
        assertThat(jdbc.queryForObject("select at from audit_events where action = 'workeasy360.operator.link_user'"
                + " and org_id = ?", java.sql.Timestamp.class, legacy.orgId())).isNotNull();

        // The person now signs in with WorkEasy360 as that account, with the role WorkEasyLMS gave it.
        SignedIn linked = signedIn(legacy.workeasy360Org(), subject, legacy.email());
        String json = mvc.perform(get("/api/auth/session").session(linked.session())).andReturn().getResponse().getContentAsString();
        assertThat((String) JsonPath.read(json, "$.user.id")).isEqualTo(legacy.user().getId());
        assertThat((String) JsonPath.read(json, "$.user.role")).isEqualTo("INSTRUCTOR");

        // Nothing about the existing sign-in was removed: SSO-only is what retires it (docs section 7).
        guard.evictAll();
        mvc.perform(get("/api/courses").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        login(legacy.email());
    }

    @Test
    @DisplayName("w360sso link-user refuses: no actor or reason, a linked account, a taken WorkEasy360 person, another organization")
    void operatorRefusesConflicts() throws Exception {
        Legacy legacy = legacyCustomer(Role.LEARNER);
        Legacy other = legacyCustomer(Role.LEARNER);
        String org = "--workeasy360-organization=" + legacy.workeasy360Org();

        assertThat(operator("link-user", "--user=" + legacy.email(), org, "--subject=" + uuid(), "--reason=r").status())
                .as("no --actor").isEqualTo(2);
        assertThat(operator("link-user", "--user=" + legacy.email(), org, "--subject=" + uuid(), "--actor=ops").status())
                .as("no --reason").isEqualTo(2);
        assertThat(operator("link-user", "--user=" + legacy.email(), org, "--actor=ops", "--reason=r").status())
                .as("no --subject").isEqualTo(2);

        // The account belongs to another organization than the one the WorkEasy360 organization is linked to.
        Run crossTenant = operator("link-user", "--user=" + other.user().getId(), org, "--subject=" + uuid(), "--actor=ops", "--reason=r");
        assertThat(crossTenant.status()).isEqualTo(1);
        assertThat(crossTenant.output()).contains("refused").contains("another organization");
        // A WorkEasy360 organization nobody linked.
        assertThat(operator("link-user", "--user=" + legacy.email(), "--workeasy360-organization=" + UUID.randomUUID(),
                "--subject=" + uuid(), "--actor=ops", "--reason=r").status()).isEqualTo(1);
        // The platform owner is never linked.
        User platform = account(Organization.PLATFORM, Role.PLATFORM);
        assertThat(operator("link-user", "--user=" + platform.getId(), org, "--subject=" + uuid(), "--actor=ops", "--reason=r").status())
                .isEqualTo(1);

        String subject = uuid();
        assertThat(operator("link-user", "--user=" + legacy.email(), org, "--subject=" + subject, "--actor=ops", "--reason=r").status())
                .isZero();
        // The account is linked already: never re-linked to another person.
        Run relink = operator("link-user", "--user=" + legacy.email(), org, "--subject=" + uuid(), "--actor=ops", "--reason=r");
        assertThat(relink.status()).isEqualTo(1);
        assertThat(relink.output()).contains("already linked");
        // The WorkEasy360 person is linked already: never to a second account.
        Legacy sameOrg = legacyIn(legacy, Role.LEARNER);
        Run taken = operator("link-user", "--user=" + sameOrg.user().getId(), org, "--subject=" + subject, "--actor=ops", "--reason=r");
        assertThat(taken.status()).isEqualTo(1);
        assertThat(taken.output()).contains("already linked to account " + legacy.user().getId());

        assertThat(jdbc.queryForObject("select user_id from federated_identities where issuer = ? and subject = ?",
                String.class, FAKE.issuer(), subject)).isEqualTo(legacy.user().getId());
        assertThat(identityCount(sameOrg.user().getId())).isZero();
        assertThat(identityCount(other.user().getId())).isZero();
        assertThat(auditCount("workeasy360.operator.link_user", legacy.orgId())).isEqualTo(1);
        assertThat(auditCount("workeasy360.operator.link_user", other.orgId())).isZero();
    }
}
