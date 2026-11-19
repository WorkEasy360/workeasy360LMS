package com.workeasy360.backend.sso.backchannel;

import com.workeasy360.backend.sso.oidc.ProviderKeySet;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The back-channel logout endpoint (OpenID Connect Back-Channel Logout 1.0 sections 2.5 to 2.8; Workeasy360
 * ADR-069): {@code POST /api/auth/workeasy360/backchannel-logout} with the form field {@code logout_token}.
 *
 * <p>Workeasy360 calls it, server to server, when a Workeasy360 sign-in that opened WorkEasyLMS sessions
 * ends: a sign-out, an account switch, a revoked session, a password change or reset, "sign out everywhere".
 * No browser is involved, so there is no CSRF token, no session and no cookie: the token's signature is the
 * authentication. It has its own security filter chain ({@code SecurityConfiguration}).
 *
 * <p>The sessions it names end on every instance: the shared {@link SignInRecords} rows are deleted in the
 * transaction that records the {@code jti}, and each instance's {@link SignInRevocationFilter} ends its own
 * sessions at their next request. This instance's own sessions are also ended at once ({@link SignInSessions}).
 *
 * <ul>
 *   <li><strong>200</strong>: the token verified and the sessions it names have ended (or had already). The same
 *       token delivered again (its {@code jti} was already acted on; a duplicate, or a retry of a delivery whose
 *       answer was lost) gets the same 200 and ends nothing more: a {@code jti} is acted on once.
 *   <li><strong>400</strong> {@code invalid_request}: the token does not verify. Nothing was ended. Workeasy360
 *       does not retry a 400.
 *   <li><strong>503</strong> {@code temporarily_unavailable}: the key set could not be read, or recording the
 *       token or ending the sessions failed. Nothing was recorded, so Workeasy360's retry is processed afresh.
 * </ul>
 *
 * Every answer is {@code Cache-Control: no-store}, set by that filter chain. Logs carry a reason code, the
 * {@code jti} and the ids, never the token.
 */
@RestController
public class BackchannelLogoutController {

    public static final String PATH = "/api/auth/workeasy360/backchannel-logout";

    private static final Logger log = LoggerFactory.getLogger(BackchannelLogoutController.class);

    private final LogoutTokenVerifier verifier;
    private final ReceivedLogoutTokens received;
    private final SignInRecords records;
    private final SignInSessions sessions;

    public BackchannelLogoutController(LogoutTokenVerifier verifier, ReceivedLogoutTokens received,
                                       SignInRecords records, SignInSessions sessions) {
        this.verifier = verifier;
        this.received = received;
        this.records = records;
        this.sessions = sessions;
    }

    @PostMapping(PATH)
    public ResponseEntity<Map<String, String>> logout(
            @RequestParam(name = "logout_token", required = false) String logoutToken) {
        LogoutToken token;
        try {
            token = verifier.verify(logoutToken);
        } catch (LogoutTokenRejected rejected) {
            log.warn("workeasy360.logout_token_rejected reason={}", rejected.reason());
            return error(HttpStatus.BAD_REQUEST, "invalid_request");
        } catch (ProviderKeySet.Unavailable unavailable) {
            log.warn("workeasy360.logout_token_unverifiable reason={}", unavailable.getMessage());
            return error(HttpStatus.SERVICE_UNAVAILABLE, "temporarily_unavailable");
        }

        int[] ended = new int[2];
        boolean accepted;
        try {
            // One transaction: the jti, the shared records (every instance), then this instance's own sessions.
            // If any of it fails, nothing is recorded and the retry is processed afresh.
            accepted = received.acceptOnce(token.issuer(), token.jti(), token.keepUntil(), () -> {
                ended[0] = records.end(token.issuer(), token.subject(), token.sid());
                ended[1] = sessions.end(token.issuer(), token.subject(), token.sid());
            });
        } catch (RuntimeException failure) {
            log.error("workeasy360.backchannel_logout_failed jti={} type={}", token.jti(),
                    failure.getClass().getSimpleName());
            return error(HttpStatus.SERVICE_UNAVAILABLE, "temporarily_unavailable");
        }
        if (!accepted) {
            // Acted on before (by this instance or another): what it asked for is done. Nothing is ended again, so
            // a copy cannot end sessions opened since; the answer is the success the first delivery got.
            log.warn("workeasy360.logout_token_duplicate jti={} sessions_ended=0", token.jti());
            return ResponseEntity.ok().build();
        }
        log.info("workeasy360.backchannel_logout jti={} subject={} sign_in={} sessions_ended={} ended_here={}",
                token.jti(), token.subject() == null ? "-" : token.subject(),
                token.sid() == null ? "all" : token.sid(), ended[0], ended[1]);
        return ResponseEntity.ok().build();
    }

    /**
     * Any other method. Without this the application's catch-all exception handler would answer a stray
     * {@code GET} with a 500.
     */
    @RequestMapping(PATH)
    public ResponseEntity<Map<String, String>> otherMethods() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .allow(HttpMethod.POST)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("error", "invalid_request"));
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatus status, String code) {
        return ResponseEntity.status(status)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("error", code));
    }
}
