package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workeasy360.backend.sso.support.FakeWorkeasy360;
import com.workeasy360.backend.sso.support.SsoTestBase;
import jakarta.servlet.http.Cookie;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

@DisplayName("Sign in with WorkEasy360: the happy path, end to end")
class SignInFlowTest extends SsoTestBase {

    @Test
    @DisplayName("the authorization request carries PKCE S256, state, nonce, the exact redirect URI and the scopes")
    void authorizationRequest() throws Exception {
        String organization = uuid();
        Started started = start("organization=" + organization.toUpperCase() + "&next=/courses");
        FakeWorkeasy360.Authorization a = started.authorization();

        assertThat(a.responseType()).isEqualTo("code");
        assertThat(a.clientId()).isEqualTo(FakeWorkeasy360.CLIENT_ID);
        assertThat(a.redirectUri()).isEqualTo(FakeWorkeasy360.REDIRECT_URI);
        assertThat(a.scope()).isEqualTo("openid email profile organization");
        assertThat(a.codeChallengeMethod()).isEqualTo("S256");
        assertThat(a.codeChallenge()).matches("[A-Za-z0-9_-]{43}");
        assertThat(a.state()).hasSizeGreaterThanOrEqualTo(32);
        assertThat(a.nonce()).hasSizeGreaterThanOrEqualTo(32);
        assertThat(a.organization()).as("forwarded in canonical form").isEqualTo(organization);
        assertThat(a.all()).doesNotContainKey("next");
        assertThat(start("organization=not-a-uuid").authorization().organization()).as("only a UUID is forwarded").isNull();
    }

    @Test
    @DisplayName("a first sign-in creates the organization and its administrator, and a server-side session; no token reaches the browser")
    void happyPath() throws Exception {
        UUID organization = UUID.randomUUID();
        String subject = uuid();
        Started started = start("organization=" + organization + "&next=/courses");
        MvcResult callback = signIn(started, spec -> {
            spec.subject = subject;
            spec.email = "Ada.Admin+" + subject.substring(0, 6) + "@Example.com";
            spec.name = "Ada Admin";
            spec.organizationName = "Acme Learning " + subject.substring(0, 6);
        });

        assertThat(callback.getResponse().getStatus()).isEqualTo(302);
        assertThat(location(callback)).isEqualTo("/#/courses");
        assertThat(callback.getResponse().getContentAsString()).isEmpty();
        MockHttpSession session = sessionOf(callback);
        assertThat(signedIn(session)).isTrue();
        assertThat(session.getId()).as("a new session at sign-in (no fixation)").isNotEqualTo(started.session().getId());
        assertThat(started.session().isInvalid()).isTrue();

        // The code exchange: private_key_jwt verified by the provider, PKCE verifier sent, nothing else as a secret.
        assertThat(FAKE.assertionProblems).isEmpty();
        Map<String, String> token = FAKE.tokenRequests.get(0);
        assertThat(token).containsEntry("grant_type", "authorization_code")
                .containsEntry("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer")
                .containsKey("code_verifier").doesNotContainKey("client_secret");
        assertThat(FAKE.userinfoCalls).as("the ID token carries everything").isZero();
        // Asked about the person before anything was created for them.
        assertThat(FAKE.entitlementRequests).anySatisfy(r -> {
            assertThat(r.organizationId()).isEqualTo(organization.toString());
            assertThat(r.subject()).isEqualTo(subject);
        });

        mvc.perform(get("/api/auth/session").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.method").value("workeasy360"))
                .andExpect(jsonPath("$.user.role").value("ADMIN"))
                .andExpect(jsonPath("$.user.email").value(("ada.admin+" + subject.substring(0, 6) + "@example.com")))
                .andExpect(jsonPath("$.organization.workeasy360OrganizationId").value(organization.toString()))
                .andExpect(jsonPath("$.workeasy360SignOut").value(true));
        mvc.perform(get("/api/courses").session(session)).andExpect(status().isOk());
        mvc.perform(get("/api/courses")).andExpect(status().isUnauthorized());

        String orgId = jdbc.queryForObject("select org_id from workeasy360_organizations where workeasy360_org_id = ?",
                String.class, organization.toString());
        assertThat(jdbc.queryForObject("select name from organizations where id = ?", String.class, orgId))
                .isEqualTo("Acme Learning " + subject.substring(0, 6));
        assertThat(jdbc.queryForObject("select count(*) from subscriptions where org_id = ?", Integer.class, orgId))
                .as("its access comes from WorkEasy360, not a WorkEasyLMS plan").isZero();
        assertThat(jdbc.queryForObject("select count(*) from federated_identities where issuer = ? and subject = ?",
                Integer.class, FAKE.issuer(), subject)).isEqualTo(1);
    }

    @Test
    @DisplayName("the next person of the organization is a learner, and the same person again is the same account")
    void peopleOfAnOrganization() throws Exception {
        UUID organization = UUID.randomUUID();
        String owner = uuid();
        String colleague = uuid();
        SignedIn first = signedIn(organization, owner, null);
        SignedIn second = signedIn(organization, colleague, null);
        SignedIn again = signedIn(organization, owner, null);

        String firstId = userOf(first.session());
        assertThat(roleOf(first.session())).isEqualTo("ADMIN");
        assertThat(roleOf(second.session())).isEqualTo("LEARNER");
        assertThat(userOf(again.session())).isEqualTo(firstId);
        assertThat(jdbc.queryForObject("select count(distinct org_id) from users where id in (?, ?)", Integer.class,
                firstId, userOf(second.session()))).as("one organization").isEqualTo(1);
    }

    @Test
    @DisplayName("an unsafe next route lands on the home page")
    void unsafeNext() throws Exception {
        for (String next : new String[] {"//evil.example", "/\\evil", "https://evil.example", "/login", "/api/auth/session",
                "/%2F%2Fevil", "/ok\twith-tab"}) {
            MvcResult callback = signIn(start("next=" + encode(next)), null);
            assertThat(location(callback)).as(next).isEqualTo("/#/");
        }
    }

    @Test
    @DisplayName("a callback whose state does not match, or a callback replayed, is 'expired' and exchanges nothing")
    void stateAndReplay() throws Exception {
        Started started = start(null);
        String code = FAKE.issueCode(started.authorization(), null);
        MvcResult wrong = callback(started, code, started.authorization().state() + "x");
        assertThat(ssoError(wrong)).isEqualTo("expired");
        assertThat(FAKE.tokenRequests).isEmpty();

        MvcResult ok = callback(started, code, started.authorization().state());
        assertThat(ssoError(ok)).as("a failed callback does not consume the flow of a different state").isNull();
        Started second = start(null);
        String secondCode = FAKE.issueCode(second.authorization(), null);
        assertThat(ssoError(callback(second, secondCode, second.authorization().state()))).isNull();
        MvcResult replayed = callback(second, secondCode, second.authorization().state());
        assertThat(ssoError(replayed)).as("the flow is single use").isEqualTo("expired");
    }

    @Test
    @DisplayName("provider errors map to the shared vocabulary")
    void providerErrors() throws Exception {
        Started started = start(null);
        MvcResult result = mvc.perform(get("/api/auth/callback/workeasy360").param("error", "access_denied")
                .param("state", started.authorization().state()).session(started.session())).andReturn();
        assertThat(ssoError(result)).isEqualTo("cancelled");
        Started another = start(null);
        MvcResult notEntitled = mvc.perform(get("/api/auth/callback/workeasy360").param("error", "product_not_entitled")
                .param("state", another.authorization().state()).session(another.session())).andReturn();
        assertThat(ssoError(notEntitled)).isEqualTo("not_entitled");
    }

    @Test
    @DisplayName("WorkEasy360 down: starting a sign-in lands on the sign-in page as 'unavailable'")
    void providerDown() throws Exception {
        FAKE.discoveryDown = true;
        MvcResult result = mvc.perform(get("/api/auth/workeasy360/start")).andReturn();
        assertThat(location(result)).isEqualTo("/#/login?sso_error=unavailable");
        mvc.perform(get("/api/auth/workeasy360/config")).andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.ssoOnly").value(false));
    }

    @Test
    @DisplayName("writes with a WorkEasy360 session need the CSRF token and an allowed origin")
    void csrfAndOrigin() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        Cookie csrf = csrfCookie(person.session());
        String body = "{\"id\":\"c-" + UUID.randomUUID().toString().substring(0, 8) + "\",\"title\":\"Onboarding\"}";

        mvc.perform(post("/api/courses").session(person.session()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("csrf_invalid"));
        // A foreign origin: CORS refuses it before anything else looks at it.
        mvc.perform(post("/api/courses").session(person.session()).cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .header("Origin", "https://evil.example").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        // What CORS lets through, the origin check still refuses: a cross-site fetch without an Origin header, and an
        // origin CORS takes for this server's own that is not one of the app's.
        mvc.perform(post("/api/courses").session(person.session()).cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .header("Sec-Fetch-Site", "cross-site").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("origin_not_allowed"));
        mvc.perform(post("/api/courses").session(person.session()).cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .header("Origin", "http://localhost").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("origin_not_allowed"));
        mvc.perform(post("/api/courses").session(person.session()).cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .header("Origin", "http://localhost:5173").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
    }

    private String userOf(MockHttpSession session) throws Exception {
        String json = mvc.perform(get("/api/auth/session").session(session)).andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(json, "$.user.id");
    }

    private String roleOf(MockHttpSession session) throws Exception {
        String json = mvc.perform(get("/api/auth/session").session(session)).andReturn().getResponse().getContentAsString();
        return com.jayway.jsonpath.JsonPath.read(json, "$.user.role");
    }
}
