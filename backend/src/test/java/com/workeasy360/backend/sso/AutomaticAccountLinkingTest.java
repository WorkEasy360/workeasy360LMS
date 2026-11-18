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
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MvcResult;

/**
 * {@code WORKEASY360_LINK_BY_VERIFIED_EMAIL=true}: a first sign-in may link the existing account with the
 * WorkEasy360-verified address, but only in the organization the sign-in is for, never an account linked already,
 * and every such link is audited. The account keeps its password.
 */
@EnabledIfEnvironmentVariable(named = "LMS_TEST_DB_URL", matches = ".+", disabledReason = "needs PostgreSQL: set LMS_TEST_DB_URL")
@TestPropertySource(properties = "workeasy360.link-by-verified-email=true")
@DisplayName("WORKEASY360_LINK_BY_VERIFIED_EMAIL: same organization only, never re-linked, always audited")
class AutomaticAccountLinkingTest extends AccountLinkingTestBase {

    @Test
    @DisplayName("a verified match in the organization the sign-in is for is linked and audited as automatic; the password stays")
    void sameTenantVerifiedMatchLinks() throws Exception {
        Legacy legacy = legacyCustomer(Role.INSTRUCTOR);
        String token = login(legacy.email());
        String subject = uuid();

        SignedIn linked = signedIn(legacy.workeasy360Org(), subject, legacy.email().toUpperCase());

        String json = mvc.perform(get("/api/auth/session").session(linked.session())).andReturn().getResponse().getContentAsString();
        assertThat((String) JsonPath.read(json, "$.user.id")).isEqualTo(legacy.user().getId());
        assertThat((String) JsonPath.read(json, "$.user.role")).as("the role WorkEasyLMS gave them stays").isEqualTo("INSTRUCTOR");
        assertThat(jdbc.queryForObject("select user_id from federated_identities where issuer = ? and subject = ?",
                String.class, FAKE.issuer(), subject)).isEqualTo(legacy.user().getId());
        String detail = jdbc.queryForObject("select detail from audit_events where action = 'workeasy360.account_linked'"
                + " and org_id = ?", String.class, legacy.orgId());
        assertThat(detail).contains("automatic").contains(legacy.user().getId()).contains(subject)
                .contains(legacy.workeasy360Org().toString());
        assertThat(jdbc.queryForObject("select actor_id from audit_events where action = 'workeasy360.account_linked'"
                + " and org_id = ?", String.class, legacy.orgId())).isEqualTo(legacy.user().getId());

        guard.evictAll();
        mvc.perform(get("/api/courses").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        login(legacy.email());
    }

    @Test
    @DisplayName("a match in another organization never links: account_conflict, and the new tenant is rolled back")
    void crossTenantNeverLinks() throws Exception {
        Legacy legacy = legacyCustomer(Role.ADMIN);
        UUID elsewhere = UUID.randomUUID();

        MvcResult result = signInFresh("organization=" + elsewhere, spec -> spec.email = legacy.email());

        assertThat(ssoError(result)).isEqualTo("account_conflict");
        assertThat(identityCount(legacy.user().getId())).isZero();
        assertThat(jdbc.queryForObject("select count(*) from workeasy360_organizations where workeasy360_org_id = ?",
                Integer.class, elsewhere.toString())).as("the other organization's tenant was rolled back").isZero();

        // A WorkEasyLMS-only organization (never linked) is another tenant too.
        String suffix = uuid().substring(0, 8);
        Organization productOnly = orgs.saveAndFlush(Organization.builder().name("Only " + suffix).slug("only-" + suffix)
                .status("ACTIVE").build());
        User unlinkedTenant = account(productOnly.getId(), Role.ADMIN);
        assertThat(ssoError(signInFresh("organization=" + legacy.workeasy360Org(), spec -> spec.email = unlinkedTenant.getEmail())))
                .isEqualTo("account_conflict");
        assertThat(identityCount(unlinkedTenant.getId())).isZero();
        assertThat(auditCount("workeasy360.account_linked", legacy.orgId())).isZero();
        assertThat(auditCount("workeasy360.account_linked", productOnly.getId())).isZero();
    }

    @Test
    @DisplayName("an account linked already is never re-linked to another WorkEasy360 person")
    void alreadyLinkedNeverRelinks() throws Exception {
        Legacy legacy = legacyCustomer(Role.LEARNER);
        String first = uuid();
        signedIn(legacy.workeasy360Org(), first, legacy.email());

        MvcResult second = signInFresh("organization=" + legacy.workeasy360Org(), spec -> {
            spec.subject = uuid();
            spec.email = legacy.email();
        });

        assertThat(ssoError(second)).isEqualTo("account_conflict");
        assertThat(jdbc.queryForObject("select subject from federated_identities where user_id = ?", String.class,
                legacy.user().getId())).isEqualTo(first);
        assertThat(auditCount("workeasy360.account_linked", legacy.orgId())).isEqualTo(1);
    }

    @Test
    @DisplayName("an unverified address never links (the ID token is refused first)")
    void unverifiedNeverLinks() throws Exception {
        Legacy legacy = legacyCustomer(Role.LEARNER);
        MvcResult result = signInFresh("organization=" + legacy.workeasy360Org(), spec -> {
            spec.email = legacy.email();
            spec.emailVerified = false;
        });
        assertThat(ssoError(result)).isEqualTo("email_unverified");
        assertThat(identityCount(legacy.user().getId())).isZero();
    }
}
