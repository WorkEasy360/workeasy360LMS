package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


import com.workeasy360.backend.sso.support.FakeWorkeasy360.LogoutTokenSpec;
import com.workeasy360.backend.sso.support.SsoTestBase;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

@EnabledIfEnvironmentVariable(named = "LMS_TEST_DB_URL", matches = ".+", disabledReason = "needs PostgreSQL: set LMS_TEST_DB_URL")
@DisplayName("Back-channel logout: WorkEasy360 ends the sessions a sign-in opened")
class BackchannelLogoutTest extends SsoTestBase {

    private static final String PATH = "/api/auth/workeasy360/backchannel-logout";

    private MockHttpSession signedInWith(UUID organization, String subject, String sid) throws Exception {
        MvcResult result = signInFresh("organization=" + organization, spec -> {
            spec.subject = subject;
            if (sid != null) {
                spec.extra.put("sid", sid);
            }
        });
        assertThat(ssoError(result)).isNull();
        return sessionOf(result);
    }

    private String token(Consumer<LogoutTokenSpec> customizer) throws Exception {
        LogoutTokenSpec spec = new LogoutTokenSpec();
        customizer.accept(spec);
        return FAKE.mintLogoutToken(spec);
    }

    private MvcResult deliver(String logoutToken) throws Exception {
        return mvc.perform(post(PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).param("logout_token", logoutToken))
                .andReturn();
    }

    private int sessionStatus(MockHttpSession session) throws Exception {
        return mvc.perform(get("/api/auth/session").session(session)).andReturn().getResponse().getStatus();
    }

    @Test
    @DisplayName("a valid token naming a sid ends that sign-in's sessions only; 200 with no body and no cookie")
    void validSid() throws Exception {
        UUID organization = UUID.randomUUID();
        String person = uuid();
        String sid = uuid();
        MockHttpSession ended = signedInWith(organization, person, sid);
        MockHttpSession otherSignIn = signedInWith(organization, person, uuid());
        MockHttpSession colleague = signedInWith(organization, uuid(), uuid());

        MvcResult result = deliver(token(spec -> {
            spec.subject = person;
            spec.sid = sid;
        }));

        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        assertThat(result.getResponse().getContentAsString()).isEmpty();
        assertThat(result.getResponse().getHeaders("Set-Cookie")).isEmpty();
        assertThat(result.getResponse().getHeader("Cache-Control")).contains("no-store");
        assertThat(sessionStatus(ended)).isEqualTo(401);
        mvc.perform(get("/api/courses").session(ended)).andExpect(status().isUnauthorized());
        assertThat(sessionStatus(otherSignIn)).isEqualTo(200);
        assertThat(sessionStatus(colleague)).isEqualTo(200);
    }

    @Test
    @DisplayName("a token naming only the person ends every session of that person")
    void subjectOnly() throws Exception {
        UUID organization = UUID.randomUUID();
        String person = uuid();
        MockHttpSession first = signedInWith(organization, person, uuid());
        MockHttpSession withoutSid = signedInWith(organization, person, null);
        MockHttpSession colleague = signedInWith(organization, uuid(), null);

        assertThat(deliver(token(spec -> spec.subject = person)).getResponse().getStatus()).isEqualTo(200);

        assertThat(sessionStatus(first)).isEqualTo(401);
        assertThat(sessionStatus(withoutSid)).isEqualTo(401);
        assertThat(sessionStatus(colleague)).isEqualTo(200);
    }

    @Test
    @DisplayName("forged or malformed tokens are 400 invalid_request and end nothing")
    void forged() throws Exception {
        UUID organization = UUID.randomUUID();
        String person = uuid();
        String sid = uuid();
        MockHttpSession session = signedInWith(organization, person, sid);
        List<Consumer<LogoutTokenSpec>> forgeries = List.of(
                spec -> spec.signing = "WRONG_KEY",
                spec -> spec.signing = "UNKNOWN_KID",
                spec -> spec.signing = "NO_KID",
                spec -> spec.signing = "NONE",
                spec -> spec.signing = "HS256_WITH_PUBLIC_KEY",
                spec -> spec.issuer = FAKE.issuer() + "/",
                spec -> spec.audience = "another-product",
                spec -> spec.headerType = "JWT",
                spec -> spec.headerType = null,
                spec -> spec.extra.put("nonce", "n"),
                spec -> spec.events = Map.of("http://schemas.openid.net/event/something-else", Map.of()),
                spec -> spec.omit.add("events"),
                spec -> spec.omit.add("jti"),
                spec -> spec.typ = "id_token",
                spec -> {
                    spec.issuedAt = Instant.now().minusSeconds(3600);
                    spec.expiresAt = Instant.now().minusSeconds(3000);
                },
                spec -> {
                    spec.subject = null;
                    spec.sid = null;
                });
        for (Consumer<LogoutTokenSpec> forgery : forgeries) {
            MvcResult result = deliver(token(spec -> {
                spec.subject = person;
                spec.sid = sid;
                forgery.accept(spec);
            }));
            assertThat(result.getResponse().getStatus()).isEqualTo(400);
            assertThat(result.getResponse().getContentAsString()).contains("invalid_request");
        }
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED).param("logout_token", "not.a.jwt"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(PATH).contentType(MediaType.APPLICATION_FORM_URLENCODED)).andExpect(status().isBadRequest());
        assertThat(sessionStatus(session)).as("nothing was ended").isEqualTo(200);
    }

    @Test
    @DisplayName("the same token again is 200 and ends nothing more: a session opened since survives")
    void replayed() throws Exception {
        UUID organization = UUID.randomUUID();
        String person = uuid();
        MockHttpSession first = signedInWith(organization, person, uuid());
        String logoutToken = token(spec -> spec.subject = person);

        assertThat(deliver(logoutToken).getResponse().getStatus()).isEqualTo(200);
        assertThat(sessionStatus(first)).isEqualTo(401);

        MockHttpSession later = signedInWith(organization, person, uuid());
        MvcResult again = deliver(logoutToken);
        assertThat(again.getResponse().getStatus()).isEqualTo(200);
        assertThat(again.getResponse().getContentAsString()).isEmpty();
        assertThat(sessionStatus(later)).isEqualTo(200);
        assertThat(jdbc.queryForObject("select count(*) from received_logout_tokens where issuer = ?", Integer.class,
                FAKE.issuer())).isPositive();
    }

    @Test
    @DisplayName("a logout that overtakes its sign-in: the callback for that sid is refused as 'expired'")
    void overtakesTheCallback() throws Exception {
        String person = uuid();
        String sid = uuid();
        Started started = start(null);
        String code = FAKE.issueCode(started.authorization(), spec -> {
            spec.subject = person;
            spec.extra.put("sid", sid);
        });
        assertThat(deliver(token(spec -> {
            spec.subject = person;
            spec.sid = sid;
        })).getResponse().getStatus()).isEqualTo(200);

        MvcResult callback = callback(started, code, started.authorization().state());
        assertThat(ssoError(callback)).isEqualTo("expired");
        assertThat(signedIn(sessionOf(callback))).isFalse();
    }

    @Test
    @DisplayName("a key rotation is followed: a token signed with a newly published key verifies")
    void rotation() throws Exception {
        UUID organization = UUID.randomUUID();
        String person = uuid();
        MockHttpSession session = signedInWith(organization, person, null);
        var rotated = FAKE.rotateIn();
        assertThat(deliver(token(spec -> {
            spec.subject = person;
            spec.signWith = rotated;
        })).getResponse().getStatus()).isEqualTo(200);
        assertThat(sessionStatus(session)).isEqualTo(401);
    }

    @Test
    @DisplayName("any other method is 405")
    void otherMethods() throws Exception {
        mvc.perform(get(PATH)).andExpect(status().isMethodNotAllowed()).andExpect(jsonPath("$.error").value("invalid_request"));
    }
}
