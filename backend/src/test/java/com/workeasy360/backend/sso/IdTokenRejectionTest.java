package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;

import com.workeasy360.backend.sso.support.FakeWorkeasy360;
import com.workeasy360.backend.sso.support.SsoTestBase;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Every way an ID token (or the provider describing itself) can be wrong is refused, with no session and no account
 * or organization created.
 */
@DisplayName("Sign in with WorkEasy360: forged and wrong ID tokens are refused")
class IdTokenRejectionTest extends SsoTestBase {

    private void refused(String expectedCode, Consumer<FakeWorkeasy360.IdTokenSpec> bend) throws Exception {
        UUID organization = UUID.randomUUID();
        String subject = uuid();
        MvcResult result = signInFresh("organization=" + organization, spec -> {
            spec.subject = subject;
            bend.accept(spec);
        });
        assertThat(ssoError(result)).isEqualTo(expectedCode);
        assertThat(signedIn(sessionOf(result))).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from federated_identities where subject = ?", Integer.class, subject))
                .as("no account").isZero();
        assertThat(jdbc.queryForObject("select count(*) from workeasy360_organizations where workeasy360_org_id = ?",
                Integer.class, organization.toString())).as("no organization").isZero();
    }

    @Test
    @DisplayName("an issuer other than exactly the configured one")
    void wrongIssuer() throws Exception {
        refused("refused", spec -> spec.issuer = FAKE.issuer() + "/");
        refused("refused", spec -> spec.issuer = "https://accounts.workeasy360.com.evil.example");
    }

    @Test
    @DisplayName("an audience other than exactly this client")
    void wrongAudience() throws Exception {
        refused("refused", spec -> spec.audience = "another-product");
        refused("refused", spec -> spec.audience = List.of(FakeWorkeasy360.CLIENT_ID, "another-product"));
    }

    @Test
    @DisplayName("a bad signature, an unknown key, no algorithm, and the public key used as an HMAC secret")
    void signatures() throws Exception {
        refused("refused", spec -> spec.signing = "WRONG_KEY");
        refused("refused", spec -> spec.signing = "UNKNOWN_KID");
        refused("refused", spec -> spec.signing = "NONE");
        refused("refused", spec -> spec.signing = "HS256_WITH_PUBLIC_KEY");
        refused("refused", spec -> spec.signing = "NO_KID");
    }

    @Test
    @DisplayName("a nonce from another request, or none")
    void nonce() throws Exception {
        refused("refused", spec -> spec.nonce = "a-nonce-from-another-session");
        refused("refused", spec -> spec.omit.add("nonce"));
    }

    @Test
    @DisplayName("expired, issued in the future, or not yet valid")
    void times() throws Exception {
        refused("refused", spec -> {
            spec.issuedAt = Instant.now().minusSeconds(900);
            spec.expiresAt = Instant.now().minusSeconds(600);
        });
        refused("refused", spec -> spec.notBefore = Instant.now().plusSeconds(600));
    }

    @Test
    @DisplayName("an access token presented as an identity assertion, or no jti")
    void typeAndJti() throws Exception {
        refused("refused", spec -> spec.typ = "access_token");
        refused("refused", spec -> spec.omit.add("jti"));
    }

    @Test
    @DisplayName("a token for another product")
    void wrongProduct() throws Exception {
        refused("wrong_product", spec -> spec.productCode = "easy_project");
        refused("wrong_product", spec -> spec.omit.add("product_code"));
    }

    @Test
    @DisplayName("no organization, or one that is not a UUID")
    void missingOrganization() throws Exception {
        refused("refused", spec -> spec.omit.add("organization_id"));
        refused("refused", spec -> spec.organizationId = "not-a-uuid");
    }

    @Test
    @DisplayName("an e-mail address WorkEasy360 has not verified, or none")
    void email() throws Exception {
        refused("email_unverified", spec -> spec.emailVerified = false);
        refused("email_unverified", spec -> spec.omit.add("email_verified"));
        refused("email_missing", spec -> spec.omit.add("email"));
    }

    @Test
    @DisplayName("a token for another organization than the one the launcher named")
    void wrongOrganization() throws Exception {
        refused("wrong_organization", spec -> spec.organizationId = UUID.randomUUID().toString());
    }

    @Test
    @DisplayName("a discovery document naming another issuer: sign-in is unavailable")
    void discoveryIssuer() throws Exception {
        FAKE.discoveryIssuerOverride = "https://somebody-else.example";
        assertThat(location(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .get("/api/auth/workeasy360/start")).andReturn())).isEqualTo("/#/login?sso_error=unavailable");
    }

    @Test
    @DisplayName("a refused code exchange (replayed code, wrong PKCE verifier) is 'refused'")
    void tokenEndpointRefusal() throws Exception {
        Started started = start(null);
        String code = FAKE.issueCode(started.authorization(), null);
        FAKE.tokenOverride = request -> new FakeWorkeasy360.EntitlementReply(400, java.util.Map.of("error", "invalid_grant"));
        assertThat(ssoError(callback(started, code, started.authorization().state()))).isEqualTo("refused");
    }
}
