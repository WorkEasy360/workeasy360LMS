package com.workeasy360.backend.sso.web;

import com.workeasy360.backend.service.AuditService;
import com.workeasy360.backend.sso.SignInErrors;
import com.workeasy360.backend.sso.Workeasy360Authentication;
import com.workeasy360.backend.sso.Workeasy360Principal;
import com.workeasy360.backend.sso.Workeasy360Properties;
import com.workeasy360.backend.sso.backchannel.SignInRecords;
import com.workeasy360.backend.sso.backchannel.SignInSessions;
import com.workeasy360.backend.sso.oidc.NextPath;
import com.workeasy360.backend.sso.oidc.Workeasy360OidcUserService.SignedInUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.context.SecurityContextRepository;

/**
 * What happens when the callback finishes. Logs carry codes and ids, never an authorization code, token, state or
 * nonce.
 */
public final class SignInHandlers {

    private static final Logger log = LoggerFactory.getLogger(SignInHandlers.class);

    private SignInHandlers() {
    }

    /**
     * By now Spring has already replaced the session (session fixation: {@code newSession()}, nothing carried over,
     * which also ends any previous person's session in this browser). This swaps the authentication Spring built,
     * which still holds the verified ID token, for the slim principal kept in the session, saves it into the fresh
     * session and lands the browser on the app. A successful sign-in also clears the signed-out marker.
     *
     * <p>The session is recorded against the WorkEasy360 sign-in that opened it (the ID token's {@code sid}, when
     * there is one) and the person, so that a back-channel logout can end it: in this instance's index of its own
     * sessions ({@link SignInSessions}) and in the record every instance shares ({@link SignInRecords}), whose id
     * the session keeps. If WorkEasy360 has already ended that sign-in (its logout token overtook the browser), the
     * session is ended at once and the sign-in fails as {@code expired}. If the shared record cannot be written, the
     * session is ended and the sign-in fails as {@code unavailable}: a session a logout token could not reach is
     * never handed out.
     */
    public static AuthenticationSuccessHandler success(Workeasy360Properties properties, SecurityContextRepository repository,
                                                       SignedOutMarker marker, SignInSessions signIns,
                                                       SignInRecords records, AuditService audit) {
        return (HttpServletRequest request, HttpServletResponse response, Authentication authentication) -> {
            if (!(authentication.getPrincipal() instanceof SignedInUser user)) {
                log.error("workeasy360.sign_in_failed code={}", SignInErrors.REFUSED);
                SecurityContextHolder.clearContext();
                HttpSession created = request.getSession(false);
                if (created != null) {
                    created.invalidate();
                }
                fail(properties, response, SignInErrors.REFUSED);
                return;
            }
            Workeasy360Principal principal = user.principal();
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(new Workeasy360Authentication(principal));
            SecurityContextHolder.setContext(context);
            repository.saveContext(context, request, response);
            HttpSession session = request.getSession(false);
            String record = null;
            String refusal = null;
            if (session == null || !signIns.opened(session, principal.issuer(), principal.subject(), user.sid())) {
                refusal = SignInErrors.EXPIRED;
            } else {
                try {
                    record = records.open(principal.issuer(), principal.subject(), user.sid());
                    if (record == null) {
                        refusal = SignInErrors.EXPIRED;
                    }
                } catch (RuntimeException failure) {
                    log.error("workeasy360.sign_in_record_failed type={}", failure.getClass().getSimpleName());
                    refusal = SignInErrors.UNAVAILABLE;
                }
            }
            if (refusal != null) {
                log.warn("workeasy360.sign_in_failed code={} reason={}", refusal,
                        SignInErrors.EXPIRED.equals(refusal) ? "sign_in_already_ended" : "sign_in_not_recorded");
                SecurityContextHolder.clearContext();
                if (session != null) {
                    session.invalidate();
                }
                fail(properties, response, refusal);
                return;
            }
            session.setAttribute(SignInRecords.SESSION_ATTRIBUTE, record);
            marker.clear(response);
            audit.record(principal.userId(), principal.orgId(), "workeasy360.sign_in", "aal " + principal.aal());
            log.info("workeasy360.sign_in user={} organization={}", principal.userId(), principal.orgId());
            SignInEntryFilter.redirect(response, properties.appLocation(user.next() == null ? NextPath.HOME : user.next()));
        };
    }

    /** Every failure lands on the sign-in page with a code from the fixed vocabulary; no session is created. */
    public static AuthenticationFailureHandler failure(Workeasy360Properties properties) {
        return (HttpServletRequest request, HttpServletResponse response, AuthenticationException exception) -> {
            String code = SignInErrors.forFailure(request, exception);
            log.warn("workeasy360.sign_in_failed code={} cause={}", code, exception.getClass().getSimpleName());
            SecurityContextHolder.clearContext();
            fail(properties, response, code);
        };
    }

    static void fail(Workeasy360Properties properties, HttpServletResponse response, String code) {
        SignInEntryFilter.redirect(response, properties.appLocation("/login?sso_error=" + code));
    }
}
