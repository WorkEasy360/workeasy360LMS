package com.workeasy360.backend.sso.oidc;

import com.nimbusds.jwt.JWTParser;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.oauth2.client.oidc.authentication.OidcIdTokenDecoderFactory;
import org.springframework.security.oauth2.client.oidc.authentication.OidcIdTokenValidator;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.core.converter.ClaimTypeConverter;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoderFactory;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.web.client.RestTemplate;

/**
 * Verifies the ID token offline, in the steps the integration contract requires, each closing a named attack:
 *
 * <ol>
 *   <li>the key is chosen by {@code kid} from the provider's key set (cached; Nimbus re-reads it once when the
 *       {@code kid} is unknown, which is how a rotation is followed), and a token without a {@code kid} is refused;
 *   <li>the algorithm is restricted to {@code RS256} and {@code ES256} and the key must suit it, so {@code none},
 *       HMAC-with-the-public-key and every other algorithm are refused;
 *   <li>{@code aud} is this client id and nothing else; {@code iss} is the configured issuer exactly;
 *   <li>{@code exp}, {@code nbf} and {@code iat} with 30 seconds of leeway;
 *   <li>{@code typ} is {@code id_token} (an access token is not an identity assertion), {@code jti} is present,
 *       {@code organization_id} is a UUID, {@code product_code} is this product's;
 *   <li>{@code email} is present and {@code email_verified} is {@code true} (WorkEasyLMS keys its accounts'
 *       profile on the address and links an existing account by it, so an unverified address is refused);
 *   <li>the nonce is checked by Spring's OIDC provider against the pending request.
 * </ol>
 *
 * <p>The userinfo endpoint is never called. Ported from Easy Project's decoder, plus the e-mail checks.
 */
public class IdTokenDecoderFactory implements JwtDecoderFactory<ClientRegistration> {

    static final Duration LEEWAY = Duration.ofSeconds(30);
    public static final String WRONG_PRODUCT = "wrong_product";
    public static final String INVALID_ID_TOKEN = "invalid_id_token";
    public static final String EMAIL_MISSING = "email_missing";
    public static final String EMAIL_UNVERIFIED = "email_unverified";

    private final String productCode;
    private final ProviderHttp http;
    private final Map<String, JwtDecoder> decoders = new ConcurrentHashMap<>();

    public IdTokenDecoderFactory(String productCode, ProviderHttp http) {
        this.productCode = productCode;
        this.http = http;
    }

    @Override
    public JwtDecoder createDecoder(ClientRegistration registration) {
        // Keyed by where the keys come from, so a changed discovery document gets its own decoder (and key cache).
        String key = registration.getProviderDetails().getJwkSetUri() + '|' + registration.getClientId() + '|'
                + registration.getProviderDetails().getIssuerUri();
        if (decoders.size() > 8) {
            decoders.clear();
        }
        return decoders.computeIfAbsent(key, ignored -> build(registration));
    }

    private JwtDecoder build(ClientRegistration registration) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder
                .withJwkSetUri(registration.getProviderDetails().getJwkSetUri())
                .jwsAlgorithms(algorithms -> {
                    algorithms.clear();
                    algorithms.add(SignatureAlgorithm.RS256);
                    algorithms.add(SignatureAlgorithm.ES256);
                })
                // The key set is fetched with the deadline-bounded, redirect-free client.
                .restOperations(new RestTemplate(http.asRequestFactory()))
                .build();
        decoder.setJwtValidator(validators(registration, productCode));
        Converter<Map<String, Object>, Map<String, Object>> claims =
                new ClaimTypeConverter(OidcIdTokenDecoderFactory.createDefaultClaimTypeConverters());
        decoder.setClaimSetConverter(claims);
        return token -> {
            try {
                requireKeyId(token);
                return decoder.decode(token);
            } catch (JwtException exception) {
                throw exception;
            } catch (RuntimeException exception) {
                // Anything unexpected is a failed verification, never a 500 from the callback.
                throw new JwtException("The ID token could not be verified.", exception);
            }
        };
    }

    /** The header must name the key ({@code kid}): WorkEasy360 always does. */
    static void requireKeyId(String token) {
        try {
            String keyId = JWTParser.parse(token).getHeader().toJSONObject().get("kid") instanceof String kid
                    ? kid : null;
            if (keyId == null || keyId.isBlank()) {
                throw new BadJwtException("The ID token has no key id (kid).");
            }
        } catch (java.text.ParseException malformed) {
            throw new BadJwtException("The ID token is malformed.");
        }
    }

    static OAuth2TokenValidator<Jwt> validators(ClientRegistration registration, String productCode) {
        OidcIdTokenValidator oidc = new OidcIdTokenValidator(registration);
        oidc.setClockSkew(LEEWAY);
        return new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(LEEWAY),
                oidc,
                new ClaimsValidator(registration.getClientId(), productCode));
    }

    /** The checks the WorkEasy360 contract adds to OpenID Connect's. */
    static final class ClaimsValidator implements OAuth2TokenValidator<Jwt> {

        private final String clientId;
        private final String productCode;

        ClaimsValidator(String clientId, String productCode) {
            this.clientId = clientId;
            this.productCode = productCode;
        }

        @Override
        public OAuth2TokenValidatorResult validate(Jwt token) {
            List<String> audience = token.getAudience();
            if (audience == null || audience.size() != 1 || !clientId.equals(audience.get(0))) {
                return failure(INVALID_ID_TOKEN, "aud is not exactly this client");
            }
            if (!"id_token".equals(token.getClaimAsString("typ"))) {
                return failure(INVALID_ID_TOKEN, "typ is not id_token");
            }
            String jti = token.getClaimAsString(JwtClaimNames.JTI);
            if (jti == null || jti.isBlank()) {
                return failure(INVALID_ID_TOKEN, "jti is missing");
            }
            String organization = token.getClaimAsString("organization_id");
            if (organization == null || organization.isBlank() || !isUuid(organization)) {
                return failure(INVALID_ID_TOKEN, "organization_id is missing");
            }
            String subject = token.getSubject();
            if (subject == null || subject.isBlank() || subject.length() > 255) {
                return failure(INVALID_ID_TOKEN, "sub is missing");
            }
            if (!productCode.equals(token.getClaimAsString("product_code"))) {
                return failure(WRONG_PRODUCT, "product_code is not this product");
            }
            String email = token.getClaimAsString("email");
            if (email == null || email.isBlank() || email.length() > 200 || !email.contains("@")) {
                return failure(EMAIL_MISSING, "email is missing");
            }
            if (!Boolean.TRUE.equals(token.getClaim("email_verified"))) {
                return failure(EMAIL_UNVERIFIED, "email_verified is not true");
            }
            return OAuth2TokenValidatorResult.success();
        }

        private static OAuth2TokenValidatorResult failure(String code, String description) {
            return OAuth2TokenValidatorResult.failure(new OAuth2Error(code, description, null));
        }
    }

    /** A canonical 36-character UUID. {@link UUID#fromString} alone also accepts shortened forms. */
    public static boolean isUuid(String value) {
        if (value == null || value.length() != 36) {
            return false;
        }
        try {
            UUID.fromString(value);
            return true;
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }
}
