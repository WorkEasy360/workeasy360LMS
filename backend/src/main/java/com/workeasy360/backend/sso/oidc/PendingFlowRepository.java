package com.workeasy360.backend.sso.oidc;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.io.Serializable;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.security.oauth2.client.web.AuthorizationRequestRepository;
import org.springframework.security.oauth2.core.endpoint.OAuth2AuthorizationRequest;
import org.springframework.security.oauth2.core.endpoint.OAuth2ParameterNames;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.util.WebUtils;

/**
 * The pending sign-ins (state, nonce, PKCE verifier, the organization the launcher named, and where to
 * land afterwards) of one browser, kept server-side in that browser's session.
 *
 * <p>Differences from Spring's stock session repository, all required by the product contract:
 * <ul>
 *   <li>a flow is good for <strong>ten minutes</strong> and for <strong>one callback</strong>: it is
 *       removed the moment a callback names it, before anything else is checked, so a replayed or failed
 *       callback cannot be retried;
 *   <li>up to {@link #MAX_FLOWS} flows per browser (two tabs may start a sign-in at once); older ones are
 *       dropped;
 *   <li>the state is compared in constant time;
 *   <li>the consumed request is also published as a request attribute, so the user service can read the
 *       organization that was asked for without a second store.
 * </ul>
 */
public class PendingFlowRepository implements AuthorizationRequestRepository<OAuth2AuthorizationRequest> {

    public static final Duration TTL = Duration.ofMinutes(10);
    public static final int MAX_FLOWS = 5;
    /** Request attribute holding the {@link OAuth2AuthorizationRequest} a callback just consumed. */
    public static final String CONSUMED_ATTRIBUTE = PendingFlowRepository.class.getName() + ".CONSUMED";

    private static final String SESSION_ATTRIBUTE = PendingFlowRepository.class.getName() + ".FLOWS";
    private static final int MAX_STATE_LENGTH = 512;

    private final Clock clock;

    public PendingFlowRepository(Clock clock) {
        this.clock = clock;
    }

    private record Pending(OAuth2AuthorizationRequest request, long createdAtMillis) implements Serializable {
    }

    @Override
    public OAuth2AuthorizationRequest loadAuthorizationRequest(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        String state = state(request);
        if (session == null || state == null) {
            return null;
        }
        synchronized (WebUtils.getSessionMutex(session)) {
            Pending pending = find(flows(session), state);
            return pending != null && fresh(pending) ? pending.request() : null;
        }
    }

    @Override
    public void saveAuthorizationRequest(OAuth2AuthorizationRequest authorizationRequest,
                                         HttpServletRequest request, HttpServletResponse response) {
        if (authorizationRequest == null) {
            HttpSession session = request.getSession(false);
            if (session != null) {
                session.removeAttribute(SESSION_ATTRIBUTE);
            }
            return;
        }
        HttpSession session = request.getSession();
        synchronized (WebUtils.getSessionMutex(session)) {
            if (session.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY) == null) {
                // A session that exists only to hold a pending sign-in must not outlive it: anybody can
                // start one, so it lives as long as the flow does and no longer. (A browser that is already
                // signed in keeps its own, longer, session untouched.)
                session.setMaxInactiveInterval((int) TTL.toSeconds());
            }
            Map<String, Pending> flows = flows(session);
            flows.values().removeIf(pending -> !fresh(pending));
            flows.put(authorizationRequest.getState(),
                    new Pending(authorizationRequest, clock.millis()));
            while (flows.size() > MAX_FLOWS) {
                flows.remove(flows.keySet().iterator().next());
            }
            session.setAttribute(SESSION_ATTRIBUTE, flows);
        }
    }

    @Override
    public OAuth2AuthorizationRequest removeAuthorizationRequest(HttpServletRequest request,
                                                                 HttpServletResponse response) {
        HttpSession session = request.getSession(false);
        String state = state(request);
        if (session == null || state == null) {
            return null;
        }
        synchronized (WebUtils.getSessionMutex(session)) {
            Map<String, Pending> flows = flows(session);
            Pending pending = find(flows, state);
            if (pending == null) {
                return null;
            }
            // Consumed first, whatever happens next.
            flows.remove(pending.request().getState());
            session.setAttribute(SESSION_ATTRIBUTE, flows);
            if (!fresh(pending)) {
                return null;
            }
            request.setAttribute(CONSUMED_ATTRIBUTE, pending.request());
            return pending.request();
        }
    }

    private boolean fresh(Pending pending) {
        return clock.millis() - pending.createdAtMillis() < TTL.toMillis();
    }

    private static String state(HttpServletRequest request) {
        String state = request.getParameter(OAuth2ParameterNames.STATE);
        return state == null || state.isEmpty() || state.length() > MAX_STATE_LENGTH ? null : state;
    }

    /** The flow whose state equals {@code state}, comparing every candidate in constant time. */
    private static Pending find(Map<String, Pending> flows, String state) {
        byte[] wanted = state.getBytes(StandardCharsets.UTF_8);
        Pending match = null;
        for (Map.Entry<String, Pending> entry : new ArrayList<>(flows.entrySet())) {
            if (MessageDigest.isEqual(entry.getKey().getBytes(StandardCharsets.UTF_8), wanted)) {
                match = entry.getValue();
            }
        }
        return match;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Pending> flows(HttpSession session) {
        Object stored = session.getAttribute(SESSION_ATTRIBUTE);
        return stored instanceof Map<?, ?> map ? (Map<String, Pending>) map : new LinkedHashMap<>();
    }
}
