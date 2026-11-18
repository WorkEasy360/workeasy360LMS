package com.workeasy360.backend.sso;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/**
 * Who signed in with WorkEasy360, as kept in the server-side session.
 *
 * <p>Deliberately slim: no tokens of any kind. The ID token was verified and spent at sign-in; the session proves
 * which WorkEasyLMS account the person is and which organization the sign-in was pinned to, and nothing the browser
 * sends afterwards can change either. The account's role is <em>not</em> kept here: every request reads it afresh
 * ({@code SessionGuard}), so a role change or a deactivation applies at once.
 *
 * @param userId                    the WorkEasyLMS user ({@code users.id}) linked to (issuer, sub)
 * @param orgId                     the WorkEasyLMS organization ({@code organizations.id}) linked to the
 *                                  WorkEasy360 organization the token named
 * @param workeasy360OrganizationId the token's {@code organization_id}
 * @param issuer                    the issuer that vouched for the identity
 * @param subject                   the issuer's {@code sub} (what the entitlement API is asked about)
 * @param aal                       authenticator assurance level reported by WorkEasy360 (1 or 2)
 * @param authTime                  when WorkEasy360 authenticated the person, if it said
 */
public record Workeasy360Principal(
        String userId,
        String orgId,
        UUID workeasy360OrganizationId,
        String issuer,
        String subject,
        int aal,
        Instant authTime) implements Serializable {

    private static final long serialVersionUID = 1L;

    @Override
    public String toString() {
        // Never personal data: principals end up in log lines.
        return "Workeasy360Principal[user=" + userId + ", organization=" + orgId + "]";
    }
}
