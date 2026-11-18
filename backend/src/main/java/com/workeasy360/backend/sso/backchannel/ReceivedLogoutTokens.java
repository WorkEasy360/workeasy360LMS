package com.workeasy360.backend.sso.backchannel;

import java.time.Instant;

/**
 * The {@code jti} of every logout token WorkEasyLMS has acted on, so that none is acted on twice.
 *
 * <p>Recording the {@code jti} and ending the sessions are one unit: if ending them fails, the {@code jti} is
 * not recorded, so Workeasy360's retry of the same request is not refused as a replay.
 */
public interface ReceivedLogoutTokens {

    /**
     * Accepts a logout token at most once.
     *
     * @param keepUntil  when the record may be forgotten: after it, the token no longer passes verification
     * @param endSessions what accepting the token does; when it throws, nothing is recorded and the exception
     *                   propagates
     * @return {@code false}, without running {@code endSessions}, when this {@code jti} was accepted before
     * @throws RuntimeException when the record cannot be read or written (nothing was recorded)
     */
    boolean acceptOnce(String issuer, String jti, Instant keepUntil, Runnable endSessions);
}
