package com.workeasy360.backend.sso.backchannel;

import com.workeasy360.backend.sso.SsoResponses;
import com.workeasy360.backend.sso.Workeasy360Authentication;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Ends, on whichever instance holds it, a WorkEasy360 session whose sign-in a logout token ended on any instance.
 * It runs for every request that comes with a signed-in session, before anything reads who the request is for, and
 * asks the shared {@link SignInRecords} each time (one primary-key read; nothing is cached).
 *
 * <ul>
 *   <li>Record open: the request goes on as usual.
 *   <li>Record gone, or no record id in the session at all: the session is invalidated here and the request goes on
 *       as anonymous, so the API answers 401 exactly as for an expired session. This also covers a session brought
 *       back by a restart (persisted sessions): the record is the authority, not the session.
 *   <li>The record cannot be read (the database): 503 {@code session_unverifiable}. The session is neither trusted
 *       nor ended; the next request asks again.
 * </ul>
 *
 * Requests without a session, and the short-lived session of a sign-in still in progress, are not looked up.
 */
public class SignInRevocationFilter extends OncePerRequestFilter {

    public static final String UNVERIFIABLE = "session_unverifiable";

    private static final Logger log = LoggerFactory.getLogger(SignInRevocationFilter.class);

    private final SignInRecords records;
    private final SsoResponses responses;

    public SignInRevocationFilter(SignInRecords records, SsoResponses responses) {
        this.records = records;
        this.responses = responses;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        HttpSession session = request.getSession(false);
        Object recordId;
        try {
            if (session == null || !signedIn(session)) {
                filterChain.doFilter(request, response);
                return;
            }
            recordId = session.getAttribute(SignInRecords.SESSION_ATTRIBUTE);
        } catch (IllegalStateException invalidatedMeanwhile) {
            filterChain.doFilter(request, response);
            return;
        }

        boolean open;
        try {
            open = recordId instanceof String id && records.isOpen(id);
        } catch (RuntimeException failure) {
            log.error("workeasy360.sign_in_unverifiable type={}", failure.getClass().getSimpleName());
            responses.write(request, response, HttpStatus.SERVICE_UNAVAILABLE, UNVERIFIABLE,
                    "WorkEasyLMS cannot confirm your session at the moment. Try again in a moment.", null);
            return;
        }
        if (!open) {
            log.info("workeasy360.session_ended reason={} record={}",
                    recordId == null ? "no_record" : "sign_in_ended", recordId == null ? "-" : recordId);
            try {
                session.invalidate();
            } catch (IllegalStateException alreadyInvalidated) {
                // Ended meanwhile: the same outcome.
            }
            SecurityContextHolder.clearContext();
        }
        filterChain.doFilter(request, response);
    }

    /** The session holds the authentication a WorkEasy360 sign-in saves (a pending sign-in's session does not). */
    static boolean signedIn(HttpSession session) {
        return session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY)
                instanceof SecurityContext context && context.getAuthentication() instanceof Workeasy360Authentication;
    }
}
