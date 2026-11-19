package com.workeasy360.backend.sso.web;

import com.workeasy360.backend.sso.SsoResponses;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * A write that relies on the WorkEasy360 session cookie must come from WorkEasyLMS's own pages: its {@code Origin},
 * when the browser sends one, must be one of the app's origins ({@code CORS_ORIGINS} and {@code APP_PUBLIC_URL}),
 * and its {@code Sec-Fetch-Site} must not be {@code cross-site}. Refused before CSRF is even looked at.
 *
 * <p>Defence in depth next to the CSRF token and {@code SameSite=Lax}: a page on a sibling subdomain is "same
 * site", so the browser would send it the cookie, but it cannot make its requests carry one of the app's origins.
 * Requests that carry a bearer token do not use the cookie and are not affected; a client that sends neither header
 * (curl, server to server) is not a browser and is left to the session and CSRF checks.
 */
public class SameOriginWritesFilter extends OncePerRequestFilter {

    public static final String CODE = "origin_not_allowed";

    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final Set<String> allowedOrigins;
    private final SsoResponses responses;

    public SameOriginWritesFilter(Set<String> allowedOrigins, SsoResponses responses) {
        this.allowedOrigins = allowedOrigins;
        this.responses = responses;
    }

    /** The scheme, host and port of a URL, as browsers write an {@code Origin}; {@code null} when it is not one. */
    public static String originOf(String url) {
        if (url == null || url.isBlank()) {
            return null;
        }
        try {
            URI uri = URI.create(url.strip());
            if (uri.getScheme() == null || uri.getHost() == null) {
                return null;
            }
            return uri.getScheme().toLowerCase(Locale.ROOT) + "://" + uri.getHost().toLowerCase(Locale.ROOT)
                    + (uri.getPort() < 0 ? "" : ":" + uri.getPort());
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String authorization = request.getHeader("Authorization");
        return SAFE_METHODS.contains(request.getMethod()) || request.getSession(false) == null
                || (authorization != null && !authorization.isBlank());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String site = request.getHeader("Sec-Fetch-Site");
        String origin = request.getHeader("Origin");
        boolean refused = site != null && "cross-site".equals(site.toLowerCase(Locale.ROOT));
        if (origin != null && !allowedOrigins.contains(originOf(origin))) {
            refused = true;
        }
        if (refused) {
            responses.write(request, response, HttpStatus.FORBIDDEN, CODE,
                    "This request did not come from WorkEasyLMS's own pages.", null);
            return;
        }
        filterChain.doFilter(request, response);
    }
}
