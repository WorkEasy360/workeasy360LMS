package com.workeasy360.backend.sso.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.workeasy360.backend.security.SessionGuard;
import com.workeasy360.backend.sso.Workeasy360Authentication;
import com.workeasy360.backend.sso.entitlement.Workeasy360Entitlements;
import com.workeasy360.backend.sso.identity.OrganizationLinks;
import com.workeasy360.backend.sso.oidc.ProviderKeySet;
import com.workeasy360.backend.sso.oidc.Workeasy360Provider;
import jakarta.servlet.http.Cookie;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The whole WorkEasyLMS application (its real security chain, controllers, services and database) driven with MockMvc
 * against {@link FakeWorkeasy360}: start (capture state, nonce and the PKCE challenge from the redirect), then the
 * callback in the same session, exactly as a browser would. Nothing about sign-in is mocked.
 */
@SpringBootTest(properties = "spring.profiles.active=test")
@AutoConfigureMockMvc
public abstract class SsoTestBase {

    protected static final FakeWorkeasy360 FAKE = FakeWorkeasy360.shared();

    @DynamicPropertySource
    static void workeasy360(DynamicPropertyRegistry registry) {
        registry.add("workeasy360.issuer", FAKE::issuer);
        registry.add("workeasy360.client-id", () -> FakeWorkeasy360.CLIENT_ID);
        registry.add("workeasy360.redirect-uri", () -> FakeWorkeasy360.REDIRECT_URI);
        registry.add("workeasy360.post-logout-redirect-uri", () -> FakeWorkeasy360.POST_LOGOUT_URI);
        registry.add("workeasy360.key-id", () -> TestClientKeys.RSA_KEY_ID);
        registry.add("workeasy360.private-key-file", () -> TestClientKeys.RSA_FILE.toString());
        registry.add("workeasy360.http-timeout", () -> "3s");
    }

    @Autowired protected MockMvc mvc;
    @Autowired protected Workeasy360Entitlements entitlements;
    @Autowired protected Workeasy360Provider provider;
    @Autowired protected ProviderKeySet keys;
    @Autowired protected OrganizationLinks links;
    @Autowired protected SessionGuard guard;
    @Autowired protected JdbcTemplate jdbc;

    @BeforeEach
    void resetProvider() {
        FAKE.reset();
        entitlements.clear();
        provider.forgetDiscovery();
        keys.forget();
        links.forgetCache();
        guard.evictAll();
    }

    /** A sign-in that has been started: the browser's session and what the provider was asked. */
    public record Started(MockHttpSession session, String location, FakeWorkeasy360.Authorization authorization) {
    }

    protected Started start(String query) throws Exception {
        MvcResult result = mvc.perform(get("/api/auth/workeasy360/start" + (query == null ? "" : "?" + query))).andReturn();
        return started(result);
    }

    protected Started start(MockHttpSession existing, String query) throws Exception {
        MvcResult result = mvc.perform(get("/api/auth/workeasy360/start" + (query == null ? "" : "?" + query))
                .session(existing)).andReturn();
        return started(result);
    }

    private Started started(MvcResult result) {
        String location = result.getResponse().getHeader("Location");
        if (result.getResponse().getStatus() != 302 || location == null || !location.startsWith(FAKE.issuer())) {
            throw new AssertionError("start did not redirect to the provider: " + result.getResponse().getStatus() + " " + location);
        }
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        return new Started(session, location, FAKE.parse(location));
    }

    protected MvcResult callback(Started started, String code, String state) throws Exception {
        return mvc.perform(get("/api/auth/callback/workeasy360").param("code", code).param("state", state)
                .session(started.session())).andReturn();
    }

    /** The provider approves (default claims, then {@code customizer}); the browser comes back. */
    protected MvcResult signIn(Started started, Consumer<FakeWorkeasy360.IdTokenSpec> customizer) throws Exception {
        String code = FAKE.issueCode(started.authorization(), customizer);
        return callback(started, code, started.authorization().state());
    }

    protected MvcResult signInFresh(String query, Consumer<FakeWorkeasy360.IdTokenSpec> customizer) throws Exception {
        return signIn(start(query), customizer);
    }

    /** A person of an organization, signed in. */
    protected SignedIn signedIn(UUID organization, String subject, String email) throws Exception {
        MvcResult result = signInFresh("organization=" + organization, spec -> {
            spec.subject = subject;
            if (email != null) {
                spec.email = email;
            }
        });
        if (ssoError(result) != null) {
            throw new AssertionError("sign-in failed: " + ssoError(result));
        }
        return new SignedIn(sessionOf(result), subject, organization);
    }

    public record SignedIn(MockHttpSession session, String subject, UUID organization) {
    }

    protected static MockHttpSession sessionOf(MvcResult callbackResult) {
        return (MockHttpSession) callbackResult.getRequest().getSession(false);
    }

    /** The session holds a completed WorkEasy360 sign-in. */
    protected static boolean signedIn(MockHttpSession session) {
        return session != null && !session.isInvalid()
                && session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY) instanceof SecurityContext context
                && context.getAuthentication() instanceof Workeasy360Authentication;
    }

    protected static String location(MvcResult result) {
        return result.getResponse().getHeader("Location");
    }

    /** The {@code sso_error} of a failure redirect, or null when it is not one. */
    protected static String ssoError(MvcResult result) {
        String location = location(result);
        String prefix = "/#/login?sso_error=";
        return location != null && location.startsWith(prefix) ? location.substring(prefix.length()) : null;
    }

    /** The CSRF cookie the application issues to a session (any request with one does). */
    protected Cookie csrfCookie(MockHttpSession session) throws Exception {
        MvcResult result = mvc.perform(get("/api/auth/session").session(session)).andReturn();
        Cookie cookie = result.getResponse().getCookie("__Host-XSRF-TOKEN");
        if (cookie == null) {
            throw new AssertionError("no __Host-XSRF-TOKEN cookie was issued (status " + result.getResponse().getStatus() + ")");
        }
        return cookie;
    }

    protected static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    protected static String uuid() {
        return UUID.randomUUID().toString();
    }
}
