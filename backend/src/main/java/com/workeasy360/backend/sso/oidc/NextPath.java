package com.workeasy360.backend.sso.oidc;

import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Where to land after a successful sign-in: a same-site route of the single-page app, or its home page.
 *
 * <p>WorkEasyLMS uses hash routes, so {@code next} is the route written as a path ({@code /courses}); the success
 * handler turns it into {@code <app>/#/courses}. The value is validated as a same-site path first (universal-SSO
 * design section 3.8): it starts with a single {@code /}, has no backslash, {@code #}, whitespace or control
 * character, is at most 2,048 characters, and is not an authentication page. Percent-encoded slashes, backslashes
 * and control characters are refused too. Anything else lands on the home page.
 */
public final class NextPath {

    public static final String HOME = "/";
    static final int MAX_LENGTH = 2048;

    private static final Pattern ENCODED_DANGER =
            Pattern.compile("%(2f|5c|[01][0-9a-f]|7f)", Pattern.CASE_INSENSITIVE);
    /** The app's sign-in and account-recovery pages: landing on one after a sign-in would loop. */
    private static final Set<String> AUTH_PAGES = Set.of("/login", "/signup", "/signup-org", "/forgot", "/reset");

    private NextPath() {
    }

    /** The validated route (always starting with {@code /}), or {@link #HOME}. */
    public static String sanitize(String value) {
        if (value == null || value.isEmpty() || value.length() > MAX_LENGTH) {
            return HOME;
        }
        String route = value;
        if (route.startsWith("/#/")) {
            route = route.substring(2);
        }
        if (!route.startsWith("/") || route.startsWith("//") || route.startsWith("/\\")) {
            return HOME;
        }
        for (int i = 0; i < route.length(); i++) {
            char c = route.charAt(i);
            if (c == '\\' || c == '#' || Character.isISOControl(c) || Character.isWhitespace(c)
                    || Character.isSpaceChar(c)) {
                return HOME;
            }
        }
        if (ENCODED_DANGER.matcher(route).find()) {
            return HOME;
        }
        String path = route;
        int query = path.indexOf('?');
        if (query >= 0) {
            path = path.substring(0, query);
        }
        String lower = path.toLowerCase(Locale.ROOT).replaceAll("/+$", "");
        if (lower.equals("/api") || lower.startsWith("/api/")) {
            return HOME;
        }
        for (String page : AUTH_PAGES) {
            if (lower.equals(page) || lower.startsWith(page + "/")) {
                return HOME;
            }
        }
        return route;
    }
}
