package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.workeasy360.backend.sso.backchannel.SignInRecords;
import com.workeasy360.backend.sso.support.FakeWorkeasy360;
import com.workeasy360.backend.sso.support.SsoTestBase;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

@DisplayName("Sign-out: WorkEasyLMS only, or WorkEasyLMS and then WorkEasy360")
class SignOutTest extends SsoTestBase {

    @Test
    @DisplayName("sign out of WorkEasyLMS ends the session only (204), leaves the signed-out marker and calls nobody")
    void productOnly() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        String record = (String) person.session().getAttribute(SignInRecords.SESSION_ATTRIBUTE);
        Cookie csrf = csrfCookie(person.session());
        int providerCalls = FAKE.tokenRequests.size() + FAKE.entitlementRequests.size();

        MvcResult result = mvc.perform(post("/api/auth/logout").session(person.session()).cookie(csrf)
                .header("X-XSRF-TOKEN", csrf.getValue())).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(204);
        assertThat(person.session().isInvalid()).isTrue();
        assertThat(result.getResponse().getHeaders("Set-Cookie")).anySatisfy(c -> assertThat(c)
                .startsWith("__Host-lms_signed_out=1").contains("SameSite=Lax").contains("Secure"));
        assertThat(mvc.perform(get("/api/auth/session").session(person.session())).andReturn().getResponse().getStatus())
                .isEqualTo(401);
        assertThat(FAKE.tokenRequests.size() + FAKE.entitlementRequests.size()).isEqualTo(providerCalls);
        assertThat(record).isNotNull();
    }

    @Test
    @DisplayName("sign-out needs the CSRF token (a cross-site page cannot sign anyone out)")
    void csrf() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        assertThat(mvc.perform(post("/api/auth/logout").session(person.session())).andReturn().getResponse().getStatus())
                .isEqualTo(403);
        assertThat(signedIn(person.session())).isTrue();
    }

    @Test
    @DisplayName("and WorkEasy360: the browser goes to its end_session_endpoint with client_id and the registered post-logout URI")
    void andWorkeasy360() throws Exception {
        MvcResult result = mvc.perform(get("/api/auth/workeasy360/logout")).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(302);
        URI target = URI.create(result.getResponse().getHeader("Location"));
        assertThat(target.getScheme() + "://" + target.getAuthority() + target.getPath()).isEqualTo(FAKE.endSessionEndpoint());
        String query = URLDecoder.decode(target.getRawQuery(), StandardCharsets.UTF_8);
        assertThat(query).contains("client_id=" + FakeWorkeasy360.CLIENT_ID)
                .contains("post_logout_redirect_uri=" + FakeWorkeasy360.POST_LOGOUT_URI);

        FAKE.advertiseEndSession = false;
        provider.forgetDiscovery();
        assertThat(mvc.perform(get("/api/auth/workeasy360/logout")).andReturn().getResponse().getHeader("Location"))
                .isEqualTo("/#/login");
    }
}
