package com.workeasy360.backend.sso.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.logout.LogoutHandler;

/**
 * "This browser signed out of WorkEasyLMS": the marker that stops the single-page app from starting a WorkEasy360
 * sign-in by itself (integration guide section 6b, rule 2), which it does only when WorkEasyLMS is SSO-only.
 *
 * <p>Both sign-outs ({@code POST /api/auth/logout}, and the first half of "sign out of WorkEasyLMS and WorkEasy360")
 * set it; a successful sign-in clears it. It is a session cookie (no {@code Max-Age}), {@code SameSite=Lax}, path
 * {@code /}, and deliberately readable by script: it holds nothing and grants nothing, so a planted one can only
 * make the app show its sign-in page instead of starting one. Over https it carries the {@code __Host-} prefix,
 * which a sibling {@code *.workeasy360.com} site cannot plant.
 */
public final class SignedOutMarker {

    public static final String SECURE_NAME = "__Host-lms_signed_out";
    public static final String PLAIN_NAME = "lms_signed_out";

    private final boolean secure;

    public SignedOutMarker(boolean secureCookies) {
        this.secure = secureCookies;
    }

    public String cookieName() {
        return secure ? SECURE_NAME : PLAIN_NAME;
    }

    /** Runs when {@code POST /api/auth/logout} is accepted, before the 204 is written. */
    public LogoutHandler onLogout() {
        return (HttpServletRequest request, HttpServletResponse response, Authentication authentication) -> set(response);
    }

    public void set(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, builder("1").build().toString());
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, builder("").maxAge(Duration.ZERO).build().toString());
    }

    private ResponseCookie.ResponseCookieBuilder builder(String value) {
        return ResponseCookie.from(cookieName(), value).path("/").secure(secure).httpOnly(false).sameSite("Lax");
    }
}
