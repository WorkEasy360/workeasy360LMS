package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.sso.support.SsoTestBase;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MvcResult;

@EnabledIfEnvironmentVariable(named = "LMS_TEST_DB_URL", matches = ".+", disabledReason = "needs PostgreSQL: set LMS_TEST_DB_URL")
@DisplayName("Password sign-in keeps working next to WorkEasy360 sign-in (WORKEASY360_SSO_ONLY off)")
class PasswordSignInTest extends SsoTestBase {

    @Autowired private UserRepo users;
    @Autowired private PasswordEncoder encoder;

    private String passwordAccount() {
        String email = "pw-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
        users.saveAndFlush(User.builder().name("Pat Password").email(email).role(Role.LEARNER).orgId("org-default")
                .passwordHash(encoder.encode("Passw0rd-123")).title("Learner").dept("x").hue(1).status("ACTIVE").streak(0).build());
        return email;
    }

    @Test
    @DisplayName("login returns a bearer token as before, creates no session, and the API accepts the token")
    void passwordLogin() throws Exception {
        String email = passwordAccount();
        MvcResult login = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"Passw0rd-123\"}")).andExpect(status().isOk()).andReturn();
        assertThat(login.getRequest().getSession(false)).as("no server-side session for a password sign-in").isNull();
        String token = JsonPath.read(login.getResponse().getContentAsString(), "$.token");

        mvc.perform(get("/api/courses").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
        mvc.perform(get("/api/auth/session").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()).andExpect(jsonPath("$.method").value("password"));
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"wrong\"}")).andExpect(status().isUnauthorized());
        // A bearer write needs no CSRF token: the token, not a cookie, authenticates it.
        mvc.perform(post("/api/notifications/read-all").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
    }

    @Test
    @DisplayName("a request with a bearer token is decided by it alone: a WorkEasy360 cookie never stands in for a bad token")
    void bearerDecides() throws Exception {
        SignedIn person = signedIn(UUID.randomUUID(), uuid(), null);
        mvc.perform(get("/api/courses").session(person.session()).header("Authorization", "Bearer not-a-token"))
                .andExpect(status().isUnauthorized());

        String email = passwordAccount();
        String token = JsonPath.read(mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"Passw0rd-123\"}")).andReturn().getResponse()
                .getContentAsString(), "$.token");
        mvc.perform(get("/api/auth/session").session(person.session()).header("Authorization", "Bearer " + token))
                .andExpect(jsonPath("$.method").value("password")).andExpect(jsonPath("$.user.email").value(email));
    }

    @Test
    @DisplayName("the sign-in page is told WorkEasy360 is offered and password sign-in is still on")
    void config() throws Exception {
        mvc.perform(get("/api/auth/workeasy360/config")).andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.ssoOnly").value(false))
                .andExpect(jsonPath("$.startPath").value("/api/auth/workeasy360/start"))
                .andExpect(jsonPath("$.signedOutMarker").value("__Host-lms_signed_out"));
    }
}
