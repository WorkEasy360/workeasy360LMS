package com.workeasy360.backend.sso.oidc;

import com.workeasy360.backend.sso.SignInErrors;
import com.workeasy360.backend.sso.Workeasy360Principal;
import com.workeasy360.backend.sso.entitlement.Workeasy360Entitlements;
import com.workeasy360.backend.sso.identity.Workeasy360Accounts;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserRequest;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * The last step of authentication, run by Spring's OIDC provider after the code was exchanged and the ID token
 * verified (signature, issuer, audience, time, nonce, type, product, organization, e-mail). It:
 *
 * <ol>
 *   <li>does <strong>not</strong> call the userinfo endpoint: the ID token already carries everything;
 *   <li>binds the sign-in to the organization the launcher named: if the start asked for organization A and the
 *       token says B, the sign-in is refused ({@code wrong_organization});
 *   <li>asks the entitlement API whether this person may use WorkEasyLMS in that organization, <em>before</em>
 *       anything is created for them: a denial is refused with its reason; an outage is never a denial;
 *   <li>maps the person and the organization to a WorkEasyLMS account and tenant ({@link Workeasy360Accounts}).
 * </ol>
 *
 * Because this runs inside the authentication step, a refusal here means no session exists afterwards.
 */
public class Workeasy360OidcUserService implements OAuth2UserService<OidcUserRequest, OidcUser> {

    private static final Logger log = LoggerFactory.getLogger(Workeasy360OidcUserService.class);

    private final Workeasy360Accounts accounts;
    private final Workeasy360Entitlements entitlements;

    public Workeasy360OidcUserService(Workeasy360Accounts accounts, Workeasy360Entitlements entitlements) {
        this.accounts = accounts;
        this.entitlements = entitlements;
    }

    /** What a successful sign-in produced: the verified token plus the principal to keep in the session. */
    public static final class SignedInUser extends DefaultOidcUser {

        private static final long serialVersionUID = 1L;

        private final Workeasy360Principal principal;
        private final String next;

        SignedInUser(OidcIdToken idToken, Workeasy360Principal principal, String next) {
            super(List.of(new SimpleGrantedAuthority("ROLE_WORKEASY360_SESSION")), idToken, null, "sub");
            this.principal = principal;
            this.next = next;
        }

        public Workeasy360Principal principal() {
            return principal;
        }

        /** The sanitized route to land on, from the start request. */
        public String next() {
            return next;
        }

        /**
         * The WorkEasy360 sign-in that issued the ID token ({@code sid}), or {@code null}. WorkEasy360 includes it
         * only for a product that registered a back-channel logout URI (platform ADR-069).
         */
        public String sid() {
            Object sid = getIdToken().getClaim("sid");
            return sid instanceof String value && !value.isBlank() && value.length() <= 255 ? value : null;
        }
    }

    @Override
    public OidcUser loadUser(OidcUserRequest userRequest) throws OAuth2AuthenticationException {
        OidcIdToken token = userRequest.getIdToken();
        OAuth2AuthorizationRequest started = startedRequest();
        if (started == null) {
            throw failure("authorization_request_not_found");
        }
        String organizationClaim = token.getClaimAsString("organization_id");
        UUID organization = IdTokenDecoderFactory.isUuid(organizationClaim) ? UUID.fromString(organizationClaim) : null;
        if (organization == null) {
            throw failure(IdTokenDecoderFactory.INVALID_ID_TOKEN);
        }
        String requested = started.getAttribute(AuthorizationRequestResolver.ATTR_ORGANIZATION);
        if (requested != null && !requested.isEmpty() && !UUID.fromString(requested).equals(organization)) {
            log.warn("workeasy360.sign_in_failed code={}", SignInErrors.WRONG_ORGANIZATION);
            throw failure(SignInErrors.WRONG_ORGANIZATION);
        }
        String issuer = userRequest.getClientRegistration().getProviderDetails().getIssuerUri();
        String subject = token.getSubject();

        Workeasy360Entitlements.Access access = entitlements.accessFor(organization, subject);
        if (access.refused()) {
            throw failure(SignInErrors.UNAVAILABLE);
        }
        if (!access.allowed()) {
            String code = switch (access.reason()) {
                case "no_seat" -> SignInErrors.NO_SEAT;
                case "membership_inactive" -> SignInErrors.MEMBERSHIP_INACTIVE;
                default -> SignInErrors.NOT_ENTITLED;
            };
            log.warn("workeasy360.sign_in_failed code={} reason={}", code, access.reason());
            throw failure(code);
        }

        Workeasy360Accounts.Linked linked;
        try {
            linked = accounts.signIn(new Workeasy360Accounts.SignInClaims(issuer, subject, organization,
                    token.getClaimAsString("organization_name"), token.getEmail(), token.getFullName()));
        } catch (Workeasy360Accounts.Refused refused) {
            log.warn("workeasy360.sign_in_failed code={} reason={}", refused.code(), refused.getMessage());
            throw failure(refused.code());
        } catch (RuntimeException exception) {
            log.error("workeasy360.account_store_failed type={}", exception.getClass().getSimpleName());
            throw failure(Workeasy360Provider.UNAVAILABLE);
        }
        Workeasy360Principal principal = new Workeasy360Principal(linked.userId(), linked.orgId(), organization,
                issuer, subject, aal(token), token.getAuthenticatedAt());
        String next = started.getAttribute(AuthorizationRequestResolver.ATTR_NEXT);
        return new SignedInUser(token, principal, next == null ? NextPath.HOME : next);
    }

    private static OAuth2AuthorizationRequest startedRequest() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servlet) {
            Object consumed = servlet.getRequest().getAttribute(PendingFlowRepository.CONSUMED_ATTRIBUTE);
            return consumed instanceof OAuth2AuthorizationRequest request ? request : null;
        }
        return null;
    }

    private static int aal(OidcIdToken token) {
        Object value = token.getClaim("aal");
        return value instanceof Number number ? number.intValue() : 1;
    }

    private static OAuth2AuthenticationException failure(String code) {
        return new OAuth2AuthenticationException(new OAuth2Error(code));
    }
}
