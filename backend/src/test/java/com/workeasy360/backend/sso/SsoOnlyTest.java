package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workeasy360.backend.security.JwtService;
import com.workeasy360.backend.sso.support.SsoTestBase;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

@EnabledIfEnvironmentVariable(named = "LMS_TEST_DB_URL", matches = ".+", disabledReason = "needs PostgreSQL: set LMS_TEST_DB_URL")
@TestPropertySource(properties = {"workeasy360.sso-only=true", "workeasy360.auto-provision=false"})
@DisplayName("WORKEASY360_SSO_ONLY: WorkEasy360 is the only way in; auto-provisioning off needs an operator link")
class SsoOnlyTest extends SsoTestBase {

    @Autowired private JwtService jwt;

    @Test
    @DisplayName("every password path answers 403, and a bearer token is refused with workeasy360_sign_in_required")
    void passwordsOff() throws Exception {
        String body = "{\"email\":\"maya@example.com\",\"password\":\"Passw0rd-123\",\"name\":\"Maya\",\"token\":\"t\"}";
        for (String path : new String[] {"/api/auth/login", "/api/auth/register", "/api/auth/forgot", "/api/auth/reset",
                "/api/public/organizations"}) {
            mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.message").value(PasswordSignInPolicy.SSO_ONLY_MESSAGE));
        }
        String stillValid = jwt.issue("u-maya", "LEARNER", "org-default");
        mvc.perform(get("/api/courses").header("Authorization", "Bearer " + stillValid))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("workeasy360_sign_in_required"));
        mvc.perform(get("/api/auth/workeasy360/config")).andExpect(jsonPath("$.ssoOnly").value(true));
    }

    @Test
    @DisplayName("with auto-provisioning off, an organization nobody linked is refused; once an operator links it, sign-in works")
    void operatorLinkRequired() throws Exception {
        UUID organization = UUID.randomUUID();
        assertThat(ssoError(signInFresh("organization=" + organization, null))).isEqualTo("refused");

        jdbc.update("insert into organizations (id, name, slug, status) values (?, ?, ?, 'ACTIVE')",
                "org-op" + organization.toString().substring(0, 8), "Operator Linked", "op-" + organization.toString().substring(0, 8));
        links.insert(FAKE.issuer(), organization, "org-op" + organization.toString().substring(0, 8), "operator", java.time.Instant.now());
        SignedIn person = signedIn(organization, uuid(), null);
        mvc.perform(get("/api/courses").session(person.session())).andExpect(status().isOk());
    }
}
