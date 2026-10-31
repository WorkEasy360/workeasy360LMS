package com.workeasy360.backend.security;

import com.workeasy360.backend.domain.Enums;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.repo.Repos.SubscriptionRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The live account state behind a token. A JWT is valid for hours, so its claims alone would let a deactivated or
 * deleted person, a demoted admin, or everyone in a suspended organization keep working until it expires. Every
 * authenticated request is checked against the database instead (cached briefly; evicted the moment an admin or the
 * platform owner changes someone), and the role and organization come from the database, not from the token.
 */
@Component
public class SessionGuard {
    private static final long TTL_MS = 15_000;

    /** What a request may run as; null = the token no longer grants access. */
    public record Live(Enums.Role role, String orgId) {}
    private record Entry(Live live, long at) {}

    private final UserRepo users; private final OrganizationRepo orgs; private final SubscriptionRepo subscriptions;
    private final ConcurrentHashMap<String, Entry> cache = new ConcurrentHashMap<>();

    public SessionGuard(UserRepo users, OrganizationRepo orgs, SubscriptionRepo subscriptions) {
        this.users = users; this.orgs = orgs; this.subscriptions = subscriptions;
    }

    public Live check(String userId) {
        long now = System.currentTimeMillis();
        Entry e = cache.get(userId);
        if (e != null && now - e.at() < TTL_MS) return e.live();
        Live live = load(userId);
        if (cache.size() > 50_000) cache.clear(); // bound memory; entries are cheap to rebuild
        cache.put(userId, new Entry(live, now));
        return live;
    }

    private Live load(String userId) {
        var u = users.findById(userId).orElse(null);
        if (u == null || "INACTIVE".equalsIgnoreCase(u.getStatus())) return null;
        String org = u.getOrgId() == null ? Organization.DEFAULT : u.getOrgId();
        if (!Organization.PLATFORM.equals(org)) {
            var o = orgs.findById(org).orElse(null);
            if (o != null && "SUSPENDED".equals(o.getStatus())) return null;
            var s = subscriptions.findFirstByOrgIdOrderByCreatedAtDesc(org).orElse(null);
            if (s != null) {
                String st = s.getStatus();
                if ("SUSPENDED".equals(st) || "EXPIRED".equals(st) || "CANCELLED".equals(st)) return null;
                if ("TRIAL".equals(st) && s.getTrialEndsAt() != null && s.getTrialEndsAt().isBefore(Instant.now())) return null;
            }
        }
        return new Live(u.getRole(), org);
    }

    /** Apply a change to this person immediately (deactivation, deletion, role change). */
    public void evict(String userId) { cache.remove(userId); }
    /** Apply an organization-wide change immediately (suspension, subscription change). */
    public void evictAll() { cache.clear(); }
}
