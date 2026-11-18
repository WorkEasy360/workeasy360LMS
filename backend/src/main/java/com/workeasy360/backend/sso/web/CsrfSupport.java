package com.workeasy360.backend.sso.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.function.Supplier;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.csrf.XorCsrfTokenRequestAttributeHandler;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * The single-page-app CSRF pattern from the Spring Security reference: the token lives in the readable
 * {@code XSRF-TOKEN} cookie and the app echoes it in the {@code X-XSRF-TOKEN} header on every write.
 * Forms (which cannot set headers) would still be checked against the BREACH-protected parameter.
 */
public final class CsrfSupport {

    private CsrfSupport() {
    }

    /** Resolves the header's plain token, and falls back to the BREACH-protected form parameter. */
    public static final class SpaCsrfTokenRequestHandler implements CsrfTokenRequestHandler {

        private final CsrfTokenRequestHandler plain = new CsrfTokenRequestAttributeHandler();
        private final CsrfTokenRequestHandler xor = new XorCsrfTokenRequestAttributeHandler();

        @Override
        public void handle(HttpServletRequest request, HttpServletResponse response,
                           Supplier<CsrfToken> csrfToken) {
            this.xor.handle(request, response, csrfToken);
        }

        @Override
        public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
            String header = request.getHeader(csrfToken.getHeaderName());
            return (StringUtils.hasText(header) ? this.plain : this.xor).resolveCsrfTokenValue(request, csrfToken);
        }
    }

    /**
     * Spring defers loading the token until something reads it, which means the cookie would never be
     * issued to a page that only reads. Reading it on every request that has a session (the only requests
     * whose writes need it: bearer-token requests are exempt) makes sure the app always has one.
     */
    public static final class CsrfCookieFilter extends OncePerRequestFilter {

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                        FilterChain filterChain) throws ServletException, IOException {
            CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
            if (token != null && request.getSession(false) != null) {
                token.getToken();
            }
            filterChain.doFilter(request, response);
        }
    }
}
