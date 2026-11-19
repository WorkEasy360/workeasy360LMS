package com.workeasy360.backend.sso;

import com.workeasy360.backend.sso.identity.FederatedIdentities;
import com.workeasy360.backend.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Where WorkEasyLMS's own passwords still apply.
 *
 * <ul>
 *   <li>{@code WORKEASY360_SSO_ONLY=true}: nowhere. Password sign-in, self-registration, self-serve organization
 *       sign-up, password resets and password changes answer 403, and bearer tokens are refused
 *       ({@code JwtAuthFilter}).
 *   <li>Otherwise everywhere, except for an account linked to WorkEasy360: a link leaves the password it had as it
 *       was (it keeps working until SSO-only, which is what retires it), but it cannot get a new one through a reset
 *       link or a password change (it signs in with WorkEasy360).
 * </ul>
 */
@Component
public class PasswordSignInPolicy {

    public static final String SSO_ONLY_MESSAGE =
            "WorkEasyLMS signs in with WorkEasy360. Choose \"Continue with WorkEasy360\" on the sign-in page.";
    public static final String FEDERATED_MESSAGE =
            "This account signs in with WorkEasy360, so its WorkEasyLMS password cannot be reset or changed.";

    private final Workeasy360Properties properties;
    private final FederatedIdentities identities;

    public PasswordSignInPolicy(Workeasy360Properties properties, FederatedIdentities identities) {
        this.properties = properties;
        this.identities = identities;
    }

    public boolean ssoOnly() {
        return properties.ssoOnly();
    }

    /** @throws ApiException 403 when WorkEasy360 is the only way in */
    public void requirePasswordsAllowed() {
        if (properties.ssoOnly()) {
            throw new ApiException(HttpStatus.FORBIDDEN, SSO_ONLY_MESSAGE);
        }
    }

    public boolean signsInWithWorkeasy360(String userId) {
        return userId != null && identities.isFederated(userId);
    }

    /** @throws ApiException 403 under SSO-only, 400 for an account linked to WorkEasy360 */
    public void requirePasswordAccount(String userId) {
        requirePasswordsAllowed();
        if (signsInWithWorkeasy360(userId)) {
            throw ApiException.badRequest(FEDERATED_MESSAGE);
        }
    }
}
