package com.workeasy360.backend.security;

import com.workeasy360.backend.domain.Enums;
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

/** Validates the Bearer JWT (or a short-lived query-param token for <video> tags) and sets the SecurityContext. */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {
    private final JwtService jwt;
    private final SessionGuard guard;

    public JwtAuthFilter(JwtService jwt, SessionGuard guard) { this.jwt = jwt; this.guard = guard; }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest req, @NonNull HttpServletResponse res, @NonNull FilterChain chain)
            throws ServletException, IOException {
        String token = null;
        String header = req.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) token = header.substring(7);
        if (token == null) token = req.getParameter("access_token"); // for <video src="...&access_token=..."> streaming

        if (token != null) {
            try {
                var claims = jwt.parse(token);
                String userId = claims.getSubject();
                // A valid signature is not enough: the account must still be active, in an organization that may
                // sign in, and it runs with its CURRENT role and organization (a demotion applies without waiting
                // for the token to expire). No live state → unauthenticated → 401, which signs the browser out.
                SessionGuard.Live live = guard.check(userId);
                if (live != null) {
                    var principal = new CurrentUser(userId, live.role(), live.orgId());
                    var auth = new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities());
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (JwtException | IllegalArgumentException ignored) {
                // leave unauthenticated; endpoint-level security will reject with 401/403
            }
        }
        chain.doFilter(req, res);
    }
}
