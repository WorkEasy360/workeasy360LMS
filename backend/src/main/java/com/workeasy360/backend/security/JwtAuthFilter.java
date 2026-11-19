package com.workeasy360.backend.security;

import com.workeasy360.backend.sso.Workeasy360Properties;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Date;

/**
 * Validates the Bearer JWT of a password sign-in (or a short-lived query-param token for &lt;video&gt; tags) and sets
 * the SecurityContext.
 *
 * <p>A request that carries a bearer token is decided by that token alone: when it is valid it wins over any
 * WorkEasy360 session cookie the browser also sent, and when it is not the request is anonymous, never quietly
 * signed in by the cookie instead. With {@code WORKEASY360_SSO_ONLY=true} no bearer token is accepted at all
 * (the 401 says {@code workeasy360_sign_in_required}), so WorkEasy360 is the only way in.
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
    /** Request attribute naming why a bearer token was refused, for the 401 answer. */
    public static final String REFUSAL_CODE = JwtAuthFilter.class.getName() + ".REFUSAL";
    public static final String SIGN_IN_REQUIRED = "workeasy360_sign_in_required";

    private final JwtService jwt;
    private final SessionGuard guard;
    private final Workeasy360Properties sso;

    public JwtAuthFilter(JwtService jwt, SessionGuard guard, Workeasy360Properties sso) {
        this.jwt = jwt; this.guard = guard; this.sso = sso;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest req, @NonNull HttpServletResponse res, @NonNull FilterChain chain)
            throws ServletException, IOException {
        String token = null;
        String header = req.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) token = header.substring(7);
        if (token == null || token.isBlank()) token = req.getParameter("access_token"); // for <video src="...&access_token=..."> streaming

        if (token != null && !token.isBlank()) {
            // From here on the token decides: whatever a session cookie may have loaded is not used.
            SecurityContextHolder.clearContext();
            if (sso.ssoOnly()) {
                req.setAttribute(REFUSAL_CODE, SIGN_IN_REQUIRED);
            } else {
                try {
                    var claims = jwt.parse(token);
                    String userId = claims.getSubject();
                    // A valid signature is not enough: the account must still be active, in an organization that may
                    // sign in, and it runs with its CURRENT role and organization (a demotion applies without waiting
                    // for the token to expire). No live state → unauthenticated → 401, which signs the browser out.
                    SessionGuard.Live live = guard.check(userId);
                    if (live != null && issuedAfter(claims.getIssuedAt(), live)) {
                        var principal = new CurrentUser(userId, live.role(), live.orgId());
                        var auth = new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    }
                } catch (JwtException | IllegalArgumentException ignored) {
                    // leave unauthenticated; endpoint-level security will reject with 401/403
                }
            }
        }
        chain.doFilter(req, res);
    }

    /** Tokens issued before the account was linked to WorkEasy360 were ended at the link. */
    private static boolean issuedAfter(Date issuedAt, SessionGuard.Live live) {
        if (live.tokensValidAfter() == null) return true;
        if (issuedAt == null) return false;
        // iat has whole seconds: a token from the same second as the link was issued before it.
        return issuedAt.toInstant().isAfter(live.tokensValidAfter());
    }
}
