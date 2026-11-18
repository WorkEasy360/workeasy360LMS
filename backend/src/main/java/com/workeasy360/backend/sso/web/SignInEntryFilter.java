package com.workeasy360.backend.sso.web;

import com.workeasy360.backend.sso.SignInErrors;
import com.workeasy360.backend.sso.Workeasy360Properties;
import com.workeasy360.backend.sso.oidc.AuthorizationRequestResolver;
import com.workeasy360.backend.sso.oidc.Workeasy360Provider;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Pre-flight in front of Spring's authorization-request redirect. Spring would answer a failed discovery with a bare
 * 500; this asks for the registration first, so a WorkEasy360 that is down (or a deployment where sign-in is not
 * configured) becomes the sign-in error {@code unavailable} on the app's sign-in page.
 *
 * <p>The launcher's {@code /?organization=<uuid>} is not seen here: WorkEasyLMS's pages are static files served by
 * the web server, so the single-page app forwards it to {@code /api/auth/workeasy360/start?organization=<uuid>}.
 */
public class SignInEntryFilter extends OncePerRequestFilter {

    private final Workeasy360Provider provider;
    private final Workeasy360Properties properties;

    public SignInEntryFilter(Workeasy360Provider provider, Workeasy360Properties properties) {
        this.provider = provider;
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String path = request.getServletPath() + (request.getPathInfo() == null ? "" : request.getPathInfo());
        if ("GET".equals(request.getMethod()) && AuthorizationRequestResolver.START_PATH.equals(path)) {
            try {
                provider.registration();
            } catch (OAuth2AuthenticationException unavailable) {
                SignInHandlers.fail(properties, response, SignInErrors.UNAVAILABLE);
                return;
            }
        }
        filterChain.doFilter(request, response);
    }

    static void redirect(HttpServletResponse response, String location) {
        response.setStatus(HttpServletResponse.SC_FOUND);
        response.setHeader("Location", location);
        response.setHeader("Cache-Control", "no-store");
    }
}
