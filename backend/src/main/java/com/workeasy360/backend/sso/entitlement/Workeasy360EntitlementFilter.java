package com.workeasy360.backend.sso.entitlement;

import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.sso.SsoResponses;
import com.workeasy360.backend.sso.Workeasy360User;
import com.workeasy360.backend.sso.identity.OrganizationLinks;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Keeps asking WorkEasy360 whether a signed-in person may still use WorkEasyLMS, for every authenticated API request
 * (after authorization), through the cache in {@link Workeasy360Entitlements}.
 *
 * <ul>
 *   <li>A WorkEasy360 session: asked about the person ({@code organization_id} + {@code subject}).
 *   <li>A password (bearer) session in a tenant linked to WorkEasy360: asked about the organization, so a tenant
 *       whose WorkEasy360 access ended stops for every one of its people, however they signed in.
 *   <li>Anyone else (a tenant not linked to WorkEasy360, the platform owner): not asked; WorkEasyLMS's own
 *       organization and subscription checks apply as before.
 * </ul>
 *
 * Answers: ended &rarr; 403 {@code workeasy360_access_ended} (with the provider's {@code reason}); allowed but not
 * writable &rarr; writes get 403 {@code workeasy360_read_only}; WorkEasy360 refusing this product's own client
 * &rarr; 403 {@code workeasy360_access_unverified}. The session itself stays valid, so the person sees why and can
 * sign out. Not applied to {@code /api/auth/**} (sign-in, sign-out, who-am-I), the public endpoints or the stream.
 */
public class Workeasy360EntitlementFilter extends OncePerRequestFilter {

    public static final String ACCESS_ENDED = "workeasy360_access_ended";
    public static final String READ_ONLY = "workeasy360_read_only";
    public static final String ACCESS_UNVERIFIED = "workeasy360_access_unverified";

    private static final Set<String> READ_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    private final Workeasy360Entitlements entitlements;
    private final OrganizationLinks links;
    private final SsoResponses responses;

    public Workeasy360EntitlementFilter(Workeasy360Entitlements entitlements, OrganizationLinks links,
                                        SsoResponses responses) {
        this.entitlements = entitlements;
        this.links = links;
        this.responses = responses;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath() + (request.getPathInfo() == null ? "" : request.getPathInfo());
        return !path.startsWith("/api/") || path.startsWith("/api/auth/") || path.startsWith("/api/public/")
                || path.equals("/api/sync/stream") || path.startsWith("/api/certificates/verify/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Workeasy360Entitlements.Access access = null;
        if (authentication != null && authentication.getPrincipal() instanceof Workeasy360User user) {
            access = entitlements.accessFor(user.signIn().workeasy360OrganizationId(), user.signIn().subject());
        } else if (authentication != null && authentication.getPrincipal() instanceof CurrentUser user
                && user.getRole() != Role.PLATFORM) {
            Optional<UUID> linked = links.workeasy360OrganizationOf(user.getOrgId());
            if (linked.isPresent()) {
                access = entitlements.accessFor(linked.get(), null);
            }
        }
        if (access != null) {
            boolean write = !READ_METHODS.contains(request.getMethod());
            if (access.refused()) {
                responses.write(request, response, HttpStatus.FORBIDDEN, ACCESS_UNVERIFIED,
                        "WorkEasyLMS cannot confirm your organization's access with WorkEasy360 at the moment. "
                                + "Try again in a few minutes; if this continues, contact support.", access.reason());
                return;
            }
            if (!access.allowed()) {
                responses.write(request, response, HttpStatus.FORBIDDEN, ACCESS_ENDED,
                        "Your access to WorkEasyLMS has ended. An owner can renew it in WorkEasy360.", access.reason());
                return;
            }
            if (write && !access.writeAllowed()) {
                responses.write(request, response, HttpStatus.FORBIDDEN, READ_ONLY,
                        "Your organization's WorkEasyLMS access is read-only at the moment: you can view but not "
                                + "change anything. An owner can resolve this in WorkEasy360.", access.reason());
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}
