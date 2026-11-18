package com.workeasy360.backend.sso.web;

import com.workeasy360.backend.security.SessionGuard;
import com.workeasy360.backend.sso.Workeasy360Authentication;
import com.workeasy360.backend.sso.Workeasy360Principal;
import com.workeasy360.backend.sso.Workeasy360User;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Turns the {@link Workeasy360Authentication} a WorkEasy360 sign-in saved into the session into the request's
 * principal: a {@link Workeasy360User} with the account's <em>current</em> role and organization, read through
 * {@link SessionGuard} exactly as a password session is.
 *
 * <p>The session is ended (and the request goes on as anonymous, so the API answers 401) when the account was
 * deactivated or deleted, its organization suspended or its WorkEasyLMS subscription lapsed, or the account now
 * belongs to an organization other than the one the sign-in was pinned to: a session never crosses organizations.
 *
 * <p>The replacement context is for this request only: nothing saves it back, so the session keeps the slim
 * principal and every request is decided afresh.
 */
public class Workeasy360SessionFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(Workeasy360SessionFilter.class);

    private final SessionGuard guard;

    public Workeasy360SessionFilter(SessionGuard guard) {
        this.guard = guard;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication instanceof Workeasy360Authentication signedIn) {
            Workeasy360Principal principal = signedIn.getPrincipal();
            SessionGuard.Live live = guard.check(principal.userId());
            if (live == null || !principal.orgId().equals(live.orgId())) {
                log.info("workeasy360.session_ended reason={} user={}",
                        live == null ? "account_or_organization_inactive" : "organization_changed", principal.userId());
                HttpSession session = request.getSession(false);
                if (session != null) {
                    try {
                        session.invalidate();
                    } catch (IllegalStateException alreadyInvalidated) {
                        // Ended meanwhile: the same outcome.
                    }
                }
                SecurityContextHolder.clearContext();
            } else {
                Workeasy360User user = new Workeasy360User(principal, live.role());
                SecurityContext context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities()));
                SecurityContextHolder.setContext(context);
            }
        }
        filterChain.doFilter(request, response);
    }
}
