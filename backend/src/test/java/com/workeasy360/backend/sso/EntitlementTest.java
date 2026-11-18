package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workeasy360.backend.sso.support.FakeWorkeasy360.EntitlementReply;
import com.workeasy360.backend.sso.support.SsoTestBase;
import jakarta.servlet.http.Cookie;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

@DisplayName("Entitlement: asked of WorkEasy360 at sign-in and on its cadence; fails closed on a refusal of this client")
class EntitlementTest extends SsoTestBase {

    @Test
    @DisplayName("not entitled at sign-in: refused with its reason, and nothing is created")
    void notEntitledAtSignIn() throws Exception {
        UUID organization = UUID.randomUUID();
        FAKE.entitlementHandler = request -> EntitlementReply.deny("not_entitled");
        MvcResult result = signInFresh("organization=" + organization, null);
        assertThat(ssoError(result)).isEqualTo("not_entitled");
        assertThat(signedIn(sessionOf(result))).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from workeasy360_organizations where workeasy360_org_id = ?",
                Integer.class, organization.toString())).isZero();

        FAKE.entitlementHandler = request -> EntitlementReply.deny("no_seat");
        entitlements.clear();
        assertThat(ssoError(signInFresh("organization=" + organization, null))).isEqualTo("no_seat");
        FAKE.entitlementHandler = request -> EntitlementReply.deny("membership_inactive");
        entitlements.clear();
        assertThat(ssoError(signInFresh("organization=" + organization, null))).isEqualTo("membership_inactive");
    }

    @Test
    @DisplayName("access ending after sign-in: every API request is refused with workeasy360_access_ended; the session stays")
    void accessEnds() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        mvc.perform(get("/api/courses").session(person.session())).andExpect(status().isOk());

        FAKE.entitlementHandler = request -> EntitlementReply.deny("expired");
        entitlements.clear(); // the cadence elapsed
        mvc.perform(get("/api/courses").session(person.session()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("workeasy360_access_ended"))
                .andExpect(jsonPath("$.reason").value("expired"));
        mvc.perform(get("/api/auth/session").session(person.session())).andExpect(status().isOk());
    }

    @Test
    @DisplayName("read-only: reads work, writes are refused with workeasy360_read_only")
    void readOnly() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        FAKE.entitlementHandler = request -> EntitlementReply.allow(900, false);
        entitlements.clear();
        Cookie csrf = csrfCookie(person.session());
        mvc.perform(get("/api/courses").session(person.session())).andExpect(status().isOk());
        mvc.perform(post("/api/courses").session(person.session()).cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"id\":\"c-ro" + uuid().substring(0, 6) + "\",\"title\":\"x\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("workeasy360_read_only"));
    }

    @Test
    @DisplayName("WorkEasy360 refusing this product's own client fails closed for everyone (workeasy360_access_unverified)")
    void clientRefused() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        FAKE.entitlementHandler = request -> EntitlementReply.status(401);
        entitlements.clear();
        mvc.perform(get("/api/courses").session(person.session()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("workeasy360_access_unverified"));
        int asked = FAKE.entitlementRequests.size();
        mvc.perform(get("/api/courses").session(person.session()))
                .andExpect(jsonPath("$.code").value("workeasy360_access_unverified"));
        assertThat(FAKE.entitlementRequests).as("closed for a minute without asking again").hasSize(asked);
        // And a new sign-in during the refusal is not let in either.
        assertThat(ssoError(signInFresh("organization=" + UUID.randomUUID(), null))).isEqualTo("unavailable");
    }

    @Test
    @DisplayName("an outage is never a denial: the last answer stands")
    void outage() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        FAKE.entitlementHandler = request -> EntitlementReply.status(503);
        mvc.perform(get("/api/courses").session(person.session())).andExpect(status().isOk());
        entitlements.clear(); // no answer known yet: access continues
        mvc.perform(get("/api/courses").session(person.session())).andExpect(status().isOk());
    }

    @Test
    @DisplayName("one question per person per revalidate_after, not one per request")
    void cadence() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        int afterSignIn = FAKE.entitlementRequests.size();
        for (int i = 0; i < 5; i++) {
            mvc.perform(get("/api/courses").session(person.session())).andExpect(status().isOk());
        }
        assertThat(FAKE.entitlementRequests).as("the sign-in's answer is reused").hasSize(afterSignIn);
        assertThat(FAKE.entitlementRequests.get(afterSignIn - 1).subject()).isEqualTo(person.subject());
    }
}
