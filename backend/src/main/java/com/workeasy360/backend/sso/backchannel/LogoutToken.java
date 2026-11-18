package com.workeasy360.backend.sso.backchannel;

import java.time.Instant;

/**
 * A logout token that passed every check of {@link LogoutTokenVerifier}: what it asks WorkEasyLMS to end.
 *
 * @param issuer    the configured issuer (the token's {@code iss}, which had to equal it exactly)
 * @param subject   the person ({@code sub}), or {@code null}
 * @param sid       the Workeasy360 sign-in that ended ({@code sid}), or {@code null}: then every session of
 *                  {@code subject} ends. At least one of the two is present.
 * @param jti       the token's unique id, accepted at most once
 * @param keepUntil the instant after which the token can no longer pass verification, plus clock leeway:
 *                  how long its {@code jti} has to be remembered
 */
public record LogoutToken(String issuer, String subject, String sid, String jti, Instant keepUntil) {
}
