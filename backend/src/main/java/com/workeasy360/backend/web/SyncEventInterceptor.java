package com.workeasy360.backend.web;

import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.SyncService;
import com.workeasy360.backend.service.SyncService.Audience;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.lang.Nullable;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Turns every successful mutating API call into a real-time sync event, by URL — one place instead of a hook in
 * every controller, so a new endpoint cannot be forgotten. Runs after the response is written (the work is
 * committed; a failed request never broadcasts). Events carry no records: clients re-pull through the normal
 * authorized endpoints.
 *
 * High-frequency learner activity (lesson progress, quiz attempts, submissions) goes to staff plus the actor only;
 * everything else is announced to the whole organization, because the re-pull itself enforces who sees what.
 */
@Component
public class SyncEventInterceptor implements HandlerInterceptor {
    private final SyncService sync;
    public SyncEventInterceptor(SyncService sync) { this.sync = sync; }

    @Override
    public void afterCompletion(@NonNull HttpServletRequest req, @NonNull HttpServletResponse res, @NonNull Object handler, @Nullable Exception ex) {
        if (ex != null || res.getStatus() < 200 || res.getStatus() >= 300) return;
        String m = req.getMethod();
        if (!("POST".equals(m) || "PUT".equals(m) || "DELETE".equals(m) || "PATCH".equals(m))) return;
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof CurrentUser me)) return;

        String path = req.getRequestURI();
        Mapped e = map(path);
        if (e == null) return;
        sync.publish(me.getOrgId(), e.type, e.audience, me.getId(), e.audience == Audience.USER ? me.getId() : null);
    }

    private record Mapped(String type, Audience audience) {}

    private static Mapped map(String p) {
        // Private/own-only or noisy endpoints: no broadcast (coach chats, AI drafts, guide telemetry, auth, the stream itself).
        if (p.startsWith("/api/sync") || p.startsWith("/api/auth") || p.startsWith("/api/ai")
                || p.startsWith("/api/coach") || p.startsWith("/api/guides") || p.startsWith("/api/recommendations")
                || p.startsWith("/api/plans")) return null;

        if (p.startsWith("/api/notifications")) return new Mapped("notifications", Audience.USER); // read-markers: other tabs of the same user
        if (p.startsWith("/api/settings")) return new Mapped("settings", Audience.ORG);
        if (p.startsWith("/api/users")) return new Mapped("users", Audience.ORG);
        if (p.startsWith("/api/community")) return new Mapped("community", Audience.ORG);
        if (p.startsWith("/api/skills") || p.matches("/api/courses/[^/]+/skills") || p.matches("/api/lessons/[^/]+/skills")
                || p.startsWith("/api/me/skills") || p.startsWith("/api/paths")) return new Mapped("skills", Audience.ORG);

        // Learning state. Low-frequency events everyone may need (enrolment, orders, reviews, certificates) go
        // org-wide; per-click learner activity goes to staff + the learner only.
        if (p.matches("/api/courses/[^/]+/(learners.*|enroll)") || p.startsWith("/api/orders")
                || p.startsWith("/api/certificates") || p.startsWith("/api/submissions")) return new Mapped("learning", Audience.ORG);
        if (p.matches("/api/lessons/[^/]+/(progress|quiz-attempts|submissions)")) return new Mapped("learning", Audience.STAFF_AND_ACTOR);

        // Course structure (courses, modules, lessons, videos).
        if (p.startsWith("/api/courses") || p.startsWith("/api/modules") || p.startsWith("/api/lessons")
                || p.startsWith("/api/videos")) return new Mapped("courses", Audience.ORG);
        return null;
    }
}
