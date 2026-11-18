package com.workeasy360.backend.sso.backchannel;

import com.nimbusds.jose.Algorithm;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSVerifier;
import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.Curve;
import com.nimbusds.jose.jwk.ECKey;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.workeasy360.backend.sso.Workeasy360Properties;
import com.workeasy360.backend.sso.oidc.ProviderKeySet;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Verifies a logout token as OpenID Connect Back-Channel Logout 1.0 section 2.6 requires, in the form
 * Workeasy360 issues it (platform ADR-069; contract {@code docs/phase-3/04-oidc-contract.md} section 3.3).
 * Each step closes a named attack, so none is optional:
 *
 * <ol>
 *   <li>the JOSE header {@code typ} is {@code logout+jwt}: neither an ID token nor an access token (both
 *       signed by the same key, for the same audience) can be replayed as a logout instruction;
 *   <li>the key is chosen by {@code kid} from Workeasy360's key set (re-read once for an unknown
 *       {@code kid}: {@link ProviderKeySet});
 *   <li>the algorithm is <strong>the key's</strong> ({@code RS256} for an RSA key of at least 2048 bits,
 *       {@code ES256} for a P-256 key; a key declaring any other {@code alg} is not used), never the
 *       header's: {@code none}, HMAC-with-the-public-key and every other algorithm are refused;
 *   <li>the signature;
 *   <li>{@code iss} equals the configured issuer exactly (token substitution);
 *   <li>{@code aud} contains this client id (and {@code azp}, when present or when there are several
 *       audiences, is this client id): audience confusion;
 *   <li>{@code iat} is not in the future beyond {@link #LEEWAY} and not older than {@link #MAX_AGE};
 *       {@code exp} has not passed ({@link #LEEWAY} of clock skew); {@code nbf}, if present, has come;
 *   <li>{@code events} is an object holding the back-channel-logout event, itself an object;
 *   <li>there is <strong>no</strong> {@code nonce} (what keeps an ID token from being accepted as a logout
 *       token), and a {@code typ} claim, when present, is {@code logout_token};
 *   <li>{@code sub} and/or {@code sid} are present, as strings of at most 255 characters; {@code jti} is
 *       present. (That a {@code jti} is never accepted twice is {@link ReceivedLogoutTokens}' job.)
 * </ol>
 */
public class LogoutTokenVerifier {

    public static final String BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

    /** Clock skew allowed on {@code iat}, {@code nbf} and {@code exp}: the same as for ID tokens. */
    static final Duration LEEWAY = Duration.ofSeconds(30);
    /**
     * A logout token older than this is refused even if its {@code exp} allows it. Workeasy360 mints a fresh
     * token for every delivery attempt, valid for 120 seconds, so an old one can only be a replay.
     */
    static final Duration MAX_AGE = Duration.ofMinutes(10);
    /** A logout token is under a kilobyte; this bounds the work an anonymous caller can ask for. */
    static final int MAX_TOKEN_LENGTH = 16 * 1024;
    static final int MAX_CLAIM_LENGTH = 255;

    private static final Set<String> LOGOUT_TOKEN_TYPES = Set.of("logout+jwt", "application/logout+jwt");

    private final Workeasy360Properties properties;
    private final ProviderKeySet keys;
    private final Clock clock;

    public LogoutTokenVerifier(Workeasy360Properties properties, ProviderKeySet keys, Clock clock) {
        this.properties = properties;
        this.keys = keys;
        this.clock = clock;
    }

    /**
     * @throws LogoutTokenRejected the token must not be acted on (answer 400: Workeasy360 does not retry)
     * @throws ProviderKeySet.Unavailable the key set cannot be read, so the token can be neither accepted nor
     *         refused (answer 503: Workeasy360 retries)
     */
    public LogoutToken verify(String token) throws LogoutTokenRejected, ProviderKeySet.Unavailable {
        if (!properties.isConfigured()) {
            // Not a client of any provider: nothing could have signed a token for it.
            throw rejected("not_configured");
        }
        if (token == null || token.isBlank() || token.length() > MAX_TOKEN_LENGTH) {
            throw rejected("malformed");
        }
        SignedJWT jwt;
        try {
            jwt = SignedJWT.parse(token.strip());
        } catch (ParseException notAJws) {
            throw rejected("malformed");
        }

        JWSHeader header = jwt.getHeader();
        JOSEObjectType type = header.getType();
        if (type == null || !LOGOUT_TOKEN_TYPES.contains(type.getType().toLowerCase(Locale.ROOT))) {
            throw rejected("not_a_logout_token");
        }
        String kid = header.getKeyID();
        if (kid == null || kid.isBlank()) {
            throw rejected("no_key_id");
        }
        JWK key = keys.find(kid);
        if (key == null) {
            throw rejected("unknown_key");
        }
        JWSAlgorithm algorithm = algorithmOf(key);
        if (algorithm == null) {
            throw rejected("unsupported_key");
        }
        if (!algorithm.equals(header.getAlgorithm())) {
            throw rejected("algorithm_mismatch");
        }
        try {
            if (!jwt.verify(verifierFor(key))) {
                throw rejected("bad_signature");
            }
        } catch (JOSEException unusable) {
            throw rejected("bad_signature");
        }

        JWTClaimsSet claims;
        try {
            claims = jwt.getJWTClaimsSet();
        } catch (ParseException malformed) {
            throw rejected("malformed");
        }
        Map<String, Object> all = claims.getClaims();

        if (!properties.issuer().equals(all.get("iss"))) {
            throw rejected("wrong_issuer");
        }
        checkAudience(claims);

        Instant now = clock.instant();
        Instant issuedAt = instant(claims.getIssueTime());
        Instant expiresAt = instant(claims.getExpirationTime());
        if (issuedAt == null || expiresAt == null) {
            throw rejected("missing_claim");
        }
        if (issuedAt.isAfter(now.plus(LEEWAY))) {
            throw rejected("issued_in_future");
        }
        if (!now.isBefore(expiresAt.plus(LEEWAY))) {
            throw rejected("expired");
        }
        if (issuedAt.isBefore(now.minus(MAX_AGE))) {
            throw rejected("stale");
        }
        Instant notBefore = instant(claims.getNotBeforeTime());
        if (all.containsKey("nbf") && (notBefore == null || notBefore.isAfter(now.plus(LEEWAY)))) {
            throw rejected("not_yet_valid");
        }

        if (all.containsKey("typ") && !"logout_token".equals(all.get("typ"))) {
            throw rejected("not_a_logout_token");
        }
        if (!(all.get("events") instanceof Map<?, ?> events)
                || !(events.get(BACKCHANNEL_LOGOUT_EVENT) instanceof Map<?, ?>)) {
            throw rejected("missing_logout_event");
        }
        if (all.containsKey("nonce")) {
            // Back-Channel Logout 1.0 section 2.4: a logout token never carries a nonce.
            throw rejected("nonce_present");
        }
        String jti = string(all, "jti");
        if (jti == null) {
            throw rejected("missing_claim");
        }
        String subject = string(all, "sub");
        String sid = string(all, "sid");
        if (subject == null && sid == null) {
            throw rejected("no_subject_or_session");
        }

        Instant acceptableUntil = min(expiresAt.plus(LEEWAY), issuedAt.plus(MAX_AGE));
        return new LogoutToken(properties.issuer(), subject, sid, jti, acceptableUntil.plus(LEEWAY));
    }

    /**
     * The one algorithm a published key may verify: taken from the key, never from the token. {@code null}
     * for a key that is unusable here.
     */
    static JWSAlgorithm algorithmOf(JWK key) {
        JWSAlgorithm implied;
        if (key instanceof RSAKey rsa && rsa.size() >= 2048) {
            implied = JWSAlgorithm.RS256;
        } else if (key instanceof ECKey ec && Curve.P_256.equals(ec.getCurve())) {
            implied = JWSAlgorithm.ES256;
        } else {
            return null;
        }
        Algorithm declared = key.getAlgorithm();
        if (declared != null && !implied.getName().equals(declared.getName())) {
            return null;
        }
        return implied;
    }

    private static JWSVerifier verifierFor(JWK key) throws JOSEException {
        if (key instanceof RSAKey rsa) {
            return new RSASSAVerifier(rsa);
        }
        if (key instanceof ECKey ec) {
            return new ECDSAVerifier(ec);
        }
        throw new JOSEException("unsupported key type");
    }

    private void checkAudience(JWTClaimsSet claims) throws LogoutTokenRejected {
        Object raw = claims.getClaim("aud");
        boolean wellFormed = raw instanceof String
                || raw instanceof List<?> list && list.stream().allMatch(String.class::isInstance);
        List<String> audience = claims.getAudience();
        String clientId = properties.clientId();
        if (!wellFormed || !audience.contains(clientId)) {
            throw rejected("wrong_audience");
        }
        Object authorizedParty = claims.getClaim("azp");
        if ((audience.size() > 1 || authorizedParty != null) && !clientId.equals(authorizedParty)) {
            throw rejected("wrong_audience");
        }
    }

    /** A claim that, when present, must be a non-blank string of at most {@link #MAX_CLAIM_LENGTH}. */
    private static String string(Map<String, Object> claims, String name) throws LogoutTokenRejected {
        if (!claims.containsKey(name)) {
            return null;
        }
        if (!(claims.get(name) instanceof String value) || value.isBlank() || value.length() > MAX_CLAIM_LENGTH) {
            throw rejected("invalid_" + name);
        }
        return value;
    }

    private static Instant instant(Date date) {
        return date == null ? null : date.toInstant();
    }

    private static Instant min(Instant a, Instant b) {
        return a.isBefore(b) ? a : b;
    }

    private static LogoutTokenRejected rejected(String reason) {
        return new LogoutTokenRejected(reason);
    }
}
