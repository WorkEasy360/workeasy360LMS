package com.workeasy360.backend.sso.oidc;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Locale;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;

/**
 * Turns {@code GET /api/auth/workeasy360/start?organization=&next=} into the authorization request: state, nonce
 * and a PKCE S256 challenge (Spring's defaults plus {@code withPkce()}, because this is a confidential client and
 * Spring only applies PKCE to public ones by default), the registered redirect URI verbatim, and the
 * {@code organization} parameter only when the launcher named a UUID.
 *
 * <p>The requested organization and the sanitized {@code next} route travel as attributes of the authorization
 * request, which the {@link PendingFlowRepository} keeps server-side for the callback; the browser never carries
 * them back.
 */
public class AuthorizationRequestResolver implements OAuth2AuthorizationRequestResolver {

    public static final String START_PATH = "/api/auth/workeasy360/start";
    public static final String ATTR_ORGANIZATION = "w360.organization";
    public static final String ATTR_NEXT = "w360.next";

    private final DefaultOAuth2AuthorizationRequestResolver delegate;

    public AuthorizationRequestResolver(ClientRegistrationRepository registrations) {
        this.delegate = new DefaultOAuth2AuthorizationRequestResolver(registrations, "/oauth2/authorization");
        this.delegate.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request) {
        return matches(request) ? build(request) : null;
    }

    @Override
    public OAuth2AuthorizationRequest resolve(HttpServletRequest request, String clientRegistrationId) {
        return Workeasy360Provider.REGISTRATION_ID.equals(clientRegistrationId) && matches(request)
                ? build(request) : null;
    }

    private OAuth2AuthorizationRequest build(HttpServletRequest request) {
        OAuth2AuthorizationRequest base = delegate.resolve(request, Workeasy360Provider.REGISTRATION_ID);
        if (base == null) {
            return null;
        }
        String organization = organization(request.getParameter("organization"));
        String next = NextPath.sanitize(request.getParameter("next"));
        return OAuth2AuthorizationRequest.from(base)
                .additionalParameters(parameters -> {
                    if (!organization.isEmpty()) {
                        parameters.put("organization", organization);
                    }
                })
                .attributes(attributes -> {
                    attributes.put(ATTR_ORGANIZATION, organization);
                    attributes.put(ATTR_NEXT, next);
                })
                .build();
    }

    /** Exactly this path (not a prefix, not another method). */
    static boolean matches(HttpServletRequest request) {
        return "GET".equals(request.getMethod()) && START_PATH.equals(request.getServletPath() + pathInfo(request));
    }

    private static String pathInfo(HttpServletRequest request) {
        return request.getPathInfo() == null ? "" : request.getPathInfo();
    }

    /** The organization in canonical lower-case form when it is a UUID, otherwise empty (and not forwarded). */
    static String organization(String value) {
        return IdTokenDecoderFactory.isUuid(value == null ? null : value.trim())
                ? value.trim().toLowerCase(Locale.ROOT) : "";
    }
}
