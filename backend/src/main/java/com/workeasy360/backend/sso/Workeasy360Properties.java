package com.workeasy360.backend.sso;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Everything WorkEasyLMS needs to be a client of WorkEasy360 Accounts, from the environment
 * ({@code WORKEASY360_ISSUER}, {@code WORKEASY360_CLIENT_ID}, ...; see docs/workeasy360-sso.md).
 *
 * <p>Only the issuer is configured about the provider: every endpoint comes from its discovery document at run
 * time. Nothing here is a secret except the private key, which is read from a file (preferred) or the variable.
 *
 * @param issuer                exact issuer identifier, e.g. {@code https://accounts.workeasy360.com}
 * @param clientId              this product's client id
 * @param redirectUri           the one registered callback; used verbatim, never derived from a request
 * @param keyId                 {@code kid} of the registered public key (the credential id)
 * @param privateKeyFile        path of the PEM private key (preferred)
 * @param privateKey            the PEM itself, with literal backslash-n allowed for one-line variables
 * @param productCode           the product code the ID token must carry
 * @param postLogoutRedirectUri registered post-logout URI; when empty, "sign out of WorkEasy360 too" is not offered
 * @param ssoOnly               {@code true}: WorkEasy360 is the only way in. Password sign-in, self-registration,
 *                              password resets and bearer tokens are refused. {@code false} (the default): both
 *                              ways work, so live customers keep their passwords until their organization moves
 * @param autoProvision         a first sign-in from a WorkEasy360 organization that is not linked yet creates its
 *                              WorkEasyLMS organization; {@code false}: it is refused until an operator links it
 * @param linkByVerifiedEmail   {@code false} (the default): a first sign-in whose address belongs to an existing
 *                              WorkEasyLMS account is refused ({@code account_conflict}) until an operator links the
 *                              account ({@code w360sso link-user}). {@code true}: such a sign-in links that account
 *                              itself, only inside the organization the sign-in is for, never an account linked
 *                              already, and audited
 * @param scopes                scopes requested at sign-in; every one must be registered for the client
 * @param appUrl                where the single-page app lives (APP_PUBLIC_URL); empty = this origin
 * @param discoveryTtl          how long the discovery document is reused
 * @param httpTimeout           overall deadline of every call to WorkEasy360
 */
@ConfigurationProperties(prefix = "workeasy360")
public record Workeasy360Properties(
        String issuer,
        String clientId,
        String redirectUri,
        String keyId,
        String privateKeyFile,
        String privateKey,
        @DefaultValue("workeasy_lms") String productCode,
        String postLogoutRedirectUri,
        @DefaultValue("false") boolean ssoOnly,
        @DefaultValue("true") boolean autoProvision,
        @DefaultValue("false") boolean linkByVerifiedEmail,
        @DefaultValue({"openid", "email", "profile", "organization"}) List<String> scopes,
        String appUrl,
        @DefaultValue("1h") Duration discoveryTtl,
        @DefaultValue("10s") Duration httpTimeout) {

    /** Everything a sign-in needs is present. Says nothing about whether WorkEasy360 is reachable. */
    public boolean isConfigured() {
        return hasText(issuer) && hasText(clientId) && hasText(redirectUri) && hasText(keyId)
                && (hasText(privateKeyFile) || hasText(privateKey));
    }

    /** Some, but not all, of the settings are present: a deployment mistake, refused at start-up. */
    public boolean isPartlyConfigured() {
        boolean any = hasText(issuer) || hasText(clientId) || hasText(redirectUri) || hasText(keyId)
                || hasText(privateKeyFile) || hasText(privateKey);
        return any && !isConfigured();
    }

    public boolean signOutOfWorkeasy360Offered() {
        return isConfigured() && hasText(postLogoutRedirectUri);
    }

    /** The single-page app's address for a hash route ({@code /courses} → {@code <app>/#/courses}). */
    public String appLocation(String hashRoute) {
        String base = hasText(appUrl) ? appUrl.strip().replaceAll("/+$", "") : "";
        return base + "/#" + hashRoute;
    }

    static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
