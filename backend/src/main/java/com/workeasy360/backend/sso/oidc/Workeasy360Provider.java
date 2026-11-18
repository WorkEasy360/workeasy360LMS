package com.workeasy360.backend.sso.oidc;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.factories.DefaultJWSSignerFactory;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.workeasy360.backend.sso.Workeasy360Properties;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;

/**
 * WorkEasy360 Accounts as a client registration: learnt <em>lazily</em> from the configured issuer's discovery
 * document on first use and cached, so WorkEasyLMS boots (and keeps serving password sign-ins) while WorkEasy360 is
 * down. A failure to discover is {@code unavailable}, never a crash.
 *
 * <p>What is checked: the document's {@code issuer} equals the configured one exactly (a document naming another
 * issuer describes somebody else's authorization server), and it names the authorization, token and key-set
 * endpoints. The registration is cached for {@code workeasy360.discovery-ttl} (one hour); if a refresh then fails
 * the previous document keeps being used rather than turning a WorkEasy360 blip into a sign-in outage, and a failed
 * attempt is not repeated for {@link #RETRY_AFTER}.
 *
 * <p>The document is fetched with {@link ProviderHttp} (an overall deadline, no redirects), never with Spring's
 * {@code ClientRegistrations.fromIssuerLocation}, whose client has no timeout. Ported from Easy Project's
 * {@code com.projectmodule.security.oidc.Workeasy360Provider}.
 */
public class Workeasy360Provider implements ClientRegistrationRepository {

    public static final String REGISTRATION_ID = "workeasy360";
    /** Error code carried by the exception when WorkEasy360 cannot be reached or described itself oddly. */
    public static final String UNAVAILABLE = "unavailable";

    static final Duration RETRY_AFTER = Duration.ofSeconds(15);

    private static final Logger log = LoggerFactory.getLogger(Workeasy360Provider.class);
    private static final String ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

    private final Workeasy360Properties properties;
    private final ProviderHttp http;
    private final Clock clock;
    private final ReentrantLock refreshLock = new ReentrantLock();
    private final Object keyLock = new Object();

    private volatile Discovered discovered;
    private volatile Instant lastFailure = Instant.MIN;
    private volatile JWK clientKey;

    public Workeasy360Provider(Workeasy360Properties properties, ProviderHttp http, Clock clock) {
        this.properties = properties;
        this.http = http;
        this.clock = clock;
    }

    private record Discovered(ClientRegistration registration, Map<String, Object> metadata, Instant fetchedAt) {
    }

    public Workeasy360Properties properties() {
        return properties;
    }

    public ProviderHttp http() {
        return http;
    }

    public boolean isConfigured() {
        return properties.isConfigured();
    }

    // --- ClientRegistrationRepository ---------------------------------------------

    @Override
    public ClientRegistration findByRegistrationId(String registrationId) {
        if (!REGISTRATION_ID.equals(registrationId)) {
            return null;
        }
        return registration();
    }

    /**
     * @throws OAuth2AuthenticationException with error {@link #UNAVAILABLE} when sign-in is not configured or
     *         WorkEasy360 cannot be discovered
     */
    public ClientRegistration registration() {
        return current().registration();
    }

    /** The discovery document (for {@code end_session_endpoint}, {@code workeasy360_entitlement_endpoint}). */
    public Map<String, Object> metadata() {
        return current().metadata();
    }

    public String metadataString(String name) {
        return metadata().get(name) instanceof String value && !value.isBlank() ? value : null;
    }

    // --- the client credential --------------------------------------------------------

    /**
     * The signing key. Parsed on first use, so a bad key is reported when it is first needed (and at start-up by
     * the configuration check), never with its contents.
     */
    public JWK clientKey() {
        JWK key = clientKey;
        if (key == null) {
            synchronized (keyLock) {
                key = clientKey;
                if (key == null) {
                    key = ClientKey.parse(
                            ClientKey.readPem(properties.privateKeyFile(), properties.privateKey()),
                            properties.keyId());
                    clientKey = key;
                }
            }
        }
        return key;
    }

    /**
     * RFC 7523 section 3: iss = sub = client id, aud = the token endpoint, a fresh jti, 60 seconds. Used for the
     * entitlement API; the token endpoint's own assertion is built by Spring's converter with the same claims.
     */
    public String clientAssertion() {
        try {
            JWK key = clientKey();
            Instant now = clock.instant();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(properties.clientId())
                    .subject(properties.clientId())
                    .audience(registration().getProviderDetails().getTokenUri())
                    .issueTime(Date.from(now))
                    .expirationTime(Date.from(now.plusSeconds(60)))
                    .jwtID(UUID.randomUUID().toString())
                    .build();
            JWSAlgorithm algorithm = key.getAlgorithm() instanceof JWSAlgorithm jws ? jws : JWSAlgorithm.RS256;
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(algorithm).keyID(key.getKeyID()).build(), claims);
            jwt.sign(new DefaultJWSSignerFactory().createJWSSigner(key, algorithm));
            return jwt.serialize();
        } catch (JOSEException exception) {
            throw new IllegalStateException("The client assertion could not be signed.");
        }
    }

    public static String assertionType() {
        return ASSERTION_TYPE;
    }

    /** Drops the cached discovery document so the next use fetches it again (tests, and a deliberate refresh). */
    public void forgetDiscovery() {
        discovered = null;
        lastFailure = Instant.MIN;
    }

    // --- discovery -----------------------------------------------------------------------

    /**
     * The cached document, refreshed when older than the TTL. Network I/O never happens under a monitor other
     * threads wait on once there is a document to use: while one thread refreshes a stale snapshot, every other
     * thread keeps using it. Only the very first discovery makes callers wait, bounded by the HTTP deadline.
     */
    private Discovered current() {
        Discovered snapshot = discovered;
        Instant now = clock.instant();
        if (isFresh(snapshot, now)) {
            return snapshot;
        }
        if (!properties.isConfigured()) {
            throw unavailable("sign-in is not configured");
        }
        if (snapshot != null) {
            if (!now.isBefore(lastFailure.plus(RETRY_AFTER)) && refreshLock.tryLock()) {
                try {
                    return refresh(snapshot);
                } finally {
                    refreshLock.unlock();
                }
            }
            Discovered latest = discovered;
            return latest != null ? latest : snapshot;
        }
        refreshLock.lock();
        try {
            Discovered latest = discovered;
            if (latest != null) {
                return latest;
            }
            return refresh(null);
        } finally {
            refreshLock.unlock();
        }
    }

    private boolean isFresh(Discovered snapshot, Instant now) {
        return snapshot != null && now.isBefore(snapshot.fetchedAt().plus(properties.discoveryTtl()));
    }

    /** Called holding {@code refreshLock}. */
    private Discovered refresh(Discovered snapshot) {
        Instant started = clock.instant();
        if (started.isBefore(lastFailure.plus(RETRY_AFTER))) {
            if (snapshot != null) {
                return snapshot;
            }
            throw unavailable("discovery failed a moment ago");
        }
        try {
            Discovered fresh = fetch(started);
            discovered = fresh;
            return fresh;
        } catch (RuntimeException | IOException failure) {
            lastFailure = started;
            log.warn("workeasy360.discovery_failed reason={}", describe(failure));
            if (snapshot != null) {
                return snapshot;
            }
            throw unavailable("discovery failed");
        }
    }

    private Discovered fetch(Instant now) throws IOException {
        String url = properties.issuer().replaceAll("/+$", "") + "/.well-known/openid-configuration";
        ProviderHttp.Response response = http.get(url);
        if (response.status() != 200 || response.body().isEmpty()) {
            throw new IOException("discovery answered " + response.status());
        }
        Map<String, Object> document = response.body();
        // Exact string equality, as OpenID Connect Discovery requires.
        if (!properties.issuer().equals(document.get("issuer"))) {
            throw new IllegalStateException("the discovery document names a different issuer");
        }
        for (String required : List.of("authorization_endpoint", "token_endpoint", "jwks_uri")) {
            if (!(document.get(required) instanceof String value) || value.isBlank()) {
                throw new IllegalStateException("the discovery document has no " + required);
            }
        }
        Map<String, Object> metadata = Collections.unmodifiableMap(new LinkedHashMap<>(document));
        ClientRegistration registration = ClientRegistration.withRegistrationId(REGISTRATION_ID)
                .clientName("WorkEasy360")
                .clientId(properties.clientId())
                .clientAuthenticationMethod(ClientAuthenticationMethod.PRIVATE_KEY_JWT)
                .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
                // The registered callback, verbatim: never rebuilt from the request's Host.
                .redirectUri(properties.redirectUri())
                .scope(properties.scopes())
                .authorizationUri((String) document.get("authorization_endpoint"))
                .tokenUri((String) document.get("token_endpoint"))
                .jwkSetUri((String) document.get("jwks_uri"))
                .issuerUri(properties.issuer())
                // Never called (the ID token carries everything), but Spring wants a value for an OIDC provider.
                .userInfoUri(document.get("userinfo_endpoint") instanceof String userinfo ? userinfo : null)
                .userNameAttributeName("sub")
                .providerConfigurationMetadata(metadata)
                .build();
        return new Discovered(registration, metadata, now);
    }

    private static OAuth2AuthenticationException unavailable(String reason) {
        return new OAuth2AuthenticationException(new OAuth2Error(UNAVAILABLE, reason, null));
    }

    private static String describe(Exception failure) {
        // The class and, for our own messages, the text; never a response body.
        return failure instanceof IllegalStateException || failure instanceof IOException
                ? failure.getClass().getSimpleName() + ": " + failure.getMessage()
                : failure.getClass().getSimpleName();
    }
}
