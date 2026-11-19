package com.workeasy360.backend.sso;

import com.workeasy360.backend.sso.oidc.IdTokenDecoderFactory;
import com.workeasy360.backend.sso.oidc.Workeasy360Provider;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.Set;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthorizationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.web.client.ResourceAccessException;

/**
 * The only values {@code sso_error} ever takes, and how every kind of sign-in failure maps onto them
 * (universal-SSO completion design section 3.11). The vocabulary is shared by every WorkEasy360 product, so one set
 * of messages serves all of them; the single-page app turns each code into a sentence. Everything not listed is
 * {@code refused}; the detail goes to the log (as a code, never a token, state or nonce), not to the browser.
 */
public final class SignInErrors {

    public static final String CANCELLED = "cancelled";
    public static final String EXPIRED = "expired";
    public static final String UNAVAILABLE = "unavailable";
    public static final String REFUSED = "refused";
    public static final String NOT_ENTITLED = "not_entitled";
    public static final String NO_SEAT = "no_seat";
    public static final String ORGANIZATION_INACTIVE = "organization_inactive";
    public static final String EMAIL_MISSING = "email_missing";
    public static final String EMAIL_UNVERIFIED = "email_unverified";
    public static final String ACCOUNT_CONFLICT = "account_conflict";
    public static final String ACCOUNT_DISABLED = "account_disabled";
    public static final String MEMBERSHIP_INACTIVE = "membership_inactive";
    public static final String WRONG_PRODUCT = "wrong_product";
    public static final String WRONG_ORGANIZATION = "wrong_organization";

    public static final Set<String> VOCABULARY = Set.of(
            CANCELLED, EXPIRED, UNAVAILABLE, REFUSED, "rate_limited", NOT_ENTITLED, NO_SEAT,
            "provider_membership_inactive", ORGANIZATION_INACTIVE, "access_policy", EMAIL_MISSING,
            EMAIL_UNVERIFIED, ACCOUNT_CONFLICT, ACCOUNT_DISABLED, MEMBERSHIP_INACTIVE,
            WRONG_PRODUCT, WRONG_ORGANIZATION);

    /** OAuth {@code error} values WorkEasy360's authorization endpoint redirects back with. */
    private static final Map<String, String> PROVIDER_ERRORS = Map.ofEntries(
            Map.entry("access_denied", CANCELLED),
            Map.entry("login_required", EXPIRED),
            Map.entry("organization_required", EXPIRED),
            Map.entry("product_not_entitled", NOT_ENTITLED),
            Map.entry("product_no_seat", NO_SEAT),
            Map.entry("membership_inactive", "provider_membership_inactive"),
            Map.entry("organization_inactive", ORGANIZATION_INACTIVE),
            Map.entry("access_policy_denied", "access_policy"),
            Map.entry("integration_suspended", UNAVAILABLE),
            Map.entry("unauthorized_client", UNAVAILABLE),
            Map.entry("interaction_required", EXPIRED),
            Map.entry("invalid_scope", UNAVAILABLE),
            Map.entry("server_error", UNAVAILABLE),
            Map.entry("temporarily_unavailable", UNAVAILABLE));

    private SignInErrors() {
    }

    /** The code for a callback that came back with {@code error=...}. */
    public static String forProviderError(String providerError) {
        if (providerError == null) {
            return REFUSED;
        }
        String bounded = providerError.length() > 64 ? providerError.substring(0, 64) : providerError;
        return PROVIDER_ERRORS.getOrDefault(bounded, REFUSED);
    }

    /** The code for a failed sign-in, from the callback request and what went wrong. */
    public static String forFailure(HttpServletRequest request, AuthenticationException failure) {
        if (request.getParameter("error") != null) {
            return forProviderError(request.getParameter("error"));
        }
        if (failure instanceof OAuth2AuthenticationException oauth) {
            return forOAuthError(oauth.getError().getErrorCode(), oauth);
        }
        return REFUSED;
    }

    private static String forOAuthError(String code, Throwable failure) {
        return switch (code == null ? "" : code) {
            // Spring: no/unknown state, no pending flow, a missing code, an unknown registration.
            case "authorization_request_not_found", "invalid_request", "client_registration_not_found",
                    "invalid_state_parameter" -> EXPIRED;
            case Workeasy360Provider.UNAVAILABLE, "temporarily_unavailable", "server_error" -> UNAVAILABLE;
            // The routine "start again": an expired, reused or mismatched code or PKCE verifier.
            case "invalid_grant" -> REFUSED;
            case "invalid_token_response" -> unreachable(failure) ? UNAVAILABLE : REFUSED;
            case IdTokenDecoderFactory.INVALID_ID_TOKEN -> idTokenFailure(failure);
            default -> VOCABULARY.contains(code) ? code : REFUSED;
        };
    }

    private static final Set<String> NAMED_TOKEN_FAILURES = Set.of(WRONG_PRODUCT, EMAIL_MISSING, EMAIL_UNVERIFIED);

    private static String idTokenFailure(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof JwtValidationException validation) {
                for (OAuth2Error error : validation.getErrors()) {
                    if (NAMED_TOKEN_FAILURES.contains(error.getErrorCode())) {
                        return error.getErrorCode();
                    }
                }
            }
        }
        // The key set could not be fetched: WorkEasy360's problem, not a bad token.
        return unreachable(failure) ? UNAVAILABLE : REFUSED;
    }

    /** The failure is a network or 5xx problem talking to WorkEasy360 rather than a refusal by it. */
    private static boolean unreachable(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            if (cause instanceof ResourceAccessException
                    || cause instanceof org.springframework.web.client.HttpServerErrorException
                    || cause instanceof com.nimbusds.jose.RemoteKeySourceException
                    || cause instanceof java.net.ConnectException
                    || cause instanceof java.net.SocketTimeoutException) {
                return true;
            }
            if (cause instanceof OAuth2AuthorizationException authorization && authorization != failure
                    && "temporarily_unavailable".equals(authorization.getError().getErrorCode())) {
                return true;
            }
        }
        return false;
    }
}
