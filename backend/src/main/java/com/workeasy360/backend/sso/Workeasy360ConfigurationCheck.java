package com.workeasy360.backend.sso;

import com.workeasy360.backend.sso.oidc.ClientKey;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

/**
 * Refuses to start a deployment whose WorkEasy360 sign-in settings are wrong, so the mistake surfaces before the
 * first person does. No value is ever printed, only names.
 *
 * <ul>
 *   <li>{@code WORKEASY360_SSO_ONLY=true} without the settings: nobody could sign in at all.
 *   <li>Some of the settings but not all: a half-finished deployment.
 *   <li>The issuer or the redirect URI not an absolute {@code https} URL. Plain {@code http} is accepted only for a
 *       loopback host ({@code localhost}, {@code ::1} or any address of {@code 127.0.0.0/8}, as the platform defines
 *       loopback) and only under a local profile ({@code dev}, {@code local} or {@code test}): a local provider such
 *       as {@code http://127.0.0.1:8031}, and WorkEasyLMS on, say, {@code http://127.0.0.12:8312}.
 *   <li>A private key that cannot be read or is not an RSA (2048+) or EC P-256 key.
 * </ul>
 *
 * With none of the settings and SSO-only off, WorkEasyLMS starts as before and its sign-in page simply does not
 * offer WorkEasy360.
 */
public class Workeasy360ConfigurationCheck implements InitializingBean {

    static final Set<String> LOOPBACK_NAMES = Set.of("localhost", "[::1]", "::1", "[0:0:0:0:0:0:0:1]");
    private static final Pattern IPV4 = Pattern.compile("(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})");

    private final Workeasy360Properties properties;
    private final Environment environment;

    public Workeasy360ConfigurationCheck(Workeasy360Properties properties, Environment environment) {
        this.properties = properties;
        this.environment = environment;
    }

    public static boolean localProfile(Environment environment) {
        return environment.acceptsProfiles(Profiles.of("dev", "local", "test"));
    }

    @Override
    public void afterPropertiesSet() {
        if (!properties.isConfigured() && !properties.isPartlyConfigured()) {
            if (properties.ssoOnly()) {
                throw new IllegalStateException("WORKEASY360_SSO_ONLY is true but WorkEasy360 sign-in is not configured;"
                        + " missing: " + String.join(", ", missing()) + " (docs/workeasy360-sso.md)");
            }
            return;
        }
        if (properties.isPartlyConfigured()) {
            throw new IllegalStateException("WorkEasy360 sign-in is partly configured; missing: "
                    + String.join(", ", missing()) + " (docs/workeasy360-sso.md)");
        }
        boolean local = localProfile(environment);
        if (!acceptable(properties.issuer(), local) || !acceptable(properties.redirectUri(), local)
                || (Workeasy360Properties.hasText(properties.postLogoutRedirectUri())
                    && !acceptable(properties.postLogoutRedirectUri(), local))) {
            throw new IllegalStateException("WORKEASY360_ISSUER, WORKEASY360_REDIRECT_URI and"
                    + " WORKEASY360_POST_LOGOUT_REDIRECT_URI must be absolute https URLs (plain http only for a loopback"
                    + " host under a local profile).");
        }
        try {
            ClientKey.parse(ClientKey.readPem(properties.privateKeyFile(), properties.privateKey()), properties.keyId());
        } catch (IllegalArgumentException invalidKey) {
            throw new IllegalStateException("The WorkEasy360 private key cannot be used: " + invalidKey.getMessage());
        }
    }

    private List<String> missing() {
        List<String> missing = new ArrayList<>();
        if (!Workeasy360Properties.hasText(properties.issuer())) missing.add("WORKEASY360_ISSUER");
        if (!Workeasy360Properties.hasText(properties.clientId())) missing.add("WORKEASY360_CLIENT_ID");
        if (!Workeasy360Properties.hasText(properties.redirectUri())) missing.add("WORKEASY360_REDIRECT_URI");
        if (!Workeasy360Properties.hasText(properties.keyId())) missing.add("WORKEASY360_KEY_ID");
        if (!Workeasy360Properties.hasText(properties.privateKeyFile())
                && !Workeasy360Properties.hasText(properties.privateKey())) {
            missing.add("WORKEASY360_PRIVATE_KEY_FILE (or WORKEASY360_PRIVATE_KEY)");
        }
        return missing;
    }

    static boolean acceptable(String value, boolean local) {
        try {
            URI uri = URI.create(value.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawFragment() != null) {
                return false;
            }
            if ("https".equals(scheme)) {
                return true;
            }
            return "http".equals(scheme) && local && loopback(uri.getHost());
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }

    /**
     * Loopback as the platform and its reference connector define it (Python's {@code ipaddress.is_loopback},
     * RFC 6890): {@code localhost}, {@code ::1} and the whole of {@code 127.0.0.0/8}, not only {@code 127.0.0.1}.
     * Decided on the text alone: a host name is never resolved.
     */
    static boolean loopback(String host) {
        String name = host.toLowerCase(Locale.ROOT);
        if (LOOPBACK_NAMES.contains(name)) {
            return true;
        }
        Matcher octets = IPV4.matcher(name);
        if (!octets.matches() || !"127".equals(octets.group(1))) {
            return false;
        }
        for (int i = 2; i <= 4; i++) {
            if (Integer.parseInt(octets.group(i)) > 255) {
                return false;
            }
        }
        return true;
    }
}
