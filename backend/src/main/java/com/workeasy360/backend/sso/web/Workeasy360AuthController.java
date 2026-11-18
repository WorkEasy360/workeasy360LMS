package com.workeasy360.backend.sso.web;

import com.workeasy360.backend.dto.AuthDtos.UserDto;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.sso.Workeasy360Properties;
import com.workeasy360.backend.sso.Workeasy360User;
import com.workeasy360.backend.sso.oidc.AuthorizationRequestResolver;
import com.workeasy360.backend.sso.oidc.Workeasy360Provider;
import com.workeasy360.backend.web.ApiException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The parts of WorkEasy360 sign-in that are not the OAuth redirects themselves. (Start and callback are Spring
 * Security filters; {@code POST /api/auth/logout} is its logout filter, CSRF-protected for a session.)
 */
@RestController
@RequestMapping("/api/auth")
public class Workeasy360AuthController {

    private static final Logger log = LoggerFactory.getLogger(Workeasy360AuthController.class);

    private final Workeasy360Properties properties;
    private final Workeasy360Provider provider;
    private final UserRepo users;
    private final SignedOutMarker marker;

    public Workeasy360AuthController(Workeasy360Properties properties, Workeasy360Provider provider, UserRepo users,
                                     SignedOutMarker marker) {
        this.properties = properties;
        this.provider = provider;
        this.users = users;
        this.marker = marker;
    }

    /** Public: what the sign-in page offers. Names nothing secret. */
    @GetMapping("/workeasy360/config")
    public Map<String, Object> config() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("enabled", properties.isConfigured());
        config.put("ssoOnly", properties.ssoOnly());
        config.put("startPath", AuthorizationRequestResolver.START_PATH);
        config.put("workeasy360SignOut", properties.signOutOfWorkeasy360Offered());
        config.put("signedOutMarker", marker.cookieName());
        return config;
    }

    /**
     * Who is signed in, and how. Requires a session or a token (anything else is the 401 from the filter chain), so
     * the single-page app learns "signed out" from a 401. The WorkEasy360 session itself is never visible to script:
     * this is how the app finds out it has one.
     */
    @GetMapping("/session")
    public Map<String, Object> session(@AuthenticationPrincipal CurrentUser principal) {
        if (principal == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Sign in to continue");
        }
        UserDto user = users.findById(principal.getId()).map(UserDto::of)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Sign in to continue"));
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("authenticated", true);
        response.put("method", principal instanceof Workeasy360User ? "workeasy360" : "password");
        response.put("user", user);
        Map<String, Object> organization = new LinkedHashMap<>();
        organization.put("id", principal.getOrgId());
        if (principal instanceof Workeasy360User signedIn) {
            organization.put("workeasy360OrganizationId", signedIn.signIn().workeasy360OrganizationId().toString());
        }
        response.put("organization", organization);
        response.put("workeasy360SignOut", principal instanceof Workeasy360User && properties.signOutOfWorkeasy360Offered());
        return response;
    }

    /**
     * "Sign out of WorkEasyLMS and WorkEasy360": sends the browser to WorkEasy360's {@code end_session_endpoint}
     * with this client's id and its registered post-logout URI (WorkEasy360 asks the person to confirm). Changes
     * nothing here, so a link to it cannot sign anyone out of WorkEasyLMS; the app ends its own session first
     * ({@code POST /api/auth/logout}). Without a post-logout URI configured, or when WorkEasy360 advertises no
     * end-session endpoint, it lands on the sign-in page.
     */
    @GetMapping("/workeasy360/logout")
    public ResponseEntity<Void> endSession() {
        String target = properties.appLocation("/login");
        if (properties.signOutOfWorkeasy360Offered()) {
            try {
                String endpoint = provider.metadataString("end_session_endpoint");
                if (endpoint != null) {
                    target = endpoint + (endpoint.contains("?") ? "&" : "?")
                            + "client_id=" + URLEncoder.encode(properties.clientId(), StandardCharsets.UTF_8)
                            + "&post_logout_redirect_uri="
                            + URLEncoder.encode(properties.postLogoutRedirectUri(), StandardCharsets.UTF_8);
                }
            } catch (OAuth2AuthenticationException unavailable) {
                log.warn("workeasy360.end_session_unavailable");
            }
        }
        return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, target)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }
}
