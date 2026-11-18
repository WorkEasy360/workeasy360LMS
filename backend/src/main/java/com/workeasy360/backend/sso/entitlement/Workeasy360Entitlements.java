package com.workeasy360.backend.sso.entitlement;

import java.time.Clock;
import java.time.Duration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * May this person (or this organization) still use WorkEasyLMS? Asked of WorkEasy360 on a cadence, never assumed
 * (universal-SSO completion design section 4; the behaviour of Easy Project's {@code EntitlementService}, which this
 * is ported from).
 *
 * <ul>
 *   <li>One answer per (organization, person): the {@code sub} the person signed in with, so WorkEasy360 can also
 *       end access for a disabled account, a removed member or an unassigned seat. People of a linked tenant who
 *       signed in with a WorkEasyLMS password have no {@code sub}: their tenant is asked about as an organization.
 *       An {@code allow} is trusted for {@code min(revalidate_after, 900 s)} (at least 30 s). A denial is asked
 *       again after 60 s, so a renewal takes effect quickly.
 *   <li>An outage is never a denial: the last answer stands, with none access continues, and the next attempt waits
 *       60 s.
 *   <li><strong>A refusal of this product's own client (400/401/403) is client-wide and fails closed.</strong> For
 *       60 s every question is answered {@code refused} without asking; then one question is asked again while the
 *       rest still fail closed; a 429 within 5 minutes of a refusal counts as that refusal.
 *   <li>A known denial does not lapse into access while it is in use: only a fresh answer replaces it. A denial
 *       nobody has used for longer than the session idle timeout is dropped.
 *   <li>One request asks while the others use the last answer; a first check is never waved through because another
 *       request happens to be asking.
 * </ul>
 */
public class Workeasy360Entitlements {

    static final int DEFAULT_REVALIDATE_SECONDS = 900;
    static final int MIN_REVALIDATE_SECONDS = 30;
    static final int DENIAL_RECHECK_SECONDS = 60;
    static final int FAILURE_BACKOFF_SECONDS = 60;
    static final int CLIENT_REFUSAL_SECONDS = 60;
    static final int REFUSAL_AFTERMATH_SECONDS = 300;
    static final int MAX_ENTRIES = 10_000;

    /** The reason recorded when WorkEasy360 refused this product's own client. */
    public static final String REFUSED = "refused";
    /** The reason reported when no answer was ever available (an outage before the first check). */
    public static final String UNCHECKED = "unchecked";

    private static final Logger log = LoggerFactory.getLogger(Workeasy360Entitlements.class);

    /** What the request may do. */
    public record Access(boolean allowed, boolean writeAllowed, String reason) {

        public boolean refused() {
            return !allowed && REFUSED.equals(reason);
        }
    }

    private static final Access NOT_CHECKED = new Access(true, true, UNCHECKED);
    private static final Access CLIENT_REFUSED = new Access(false, false, REFUSED);

    private record Entry(Access access, long checkedAtMillis, long freshForMillis, long lastUsedMillis) {

        Entry used(long now) {
            return new Entry(access, checkedAtMillis, freshForMillis, now);
        }
    }

    private final EntitlementClient client;
    private final Clock clock;
    private final long denialIdleMillis;
    private final Object lock = new Object();
    private final Map<String, Entry> allowances = new LinkedHashMap<>(16, 0.75f, true);
    private final Map<String, Entry> denials = new LinkedHashMap<>(16, 0.75f, true);
    private final Map<String, Long> backoffUntil = new HashMap<>();
    private final Set<String> asking = ConcurrentHashMap.newKeySet();

    private volatile boolean clientRefused;
    private volatile long clientRefusedUntilMillis;
    private volatile long lastRefusalMillis = Long.MIN_VALUE / 2;
    private final AtomicBoolean probing = new AtomicBoolean();

    public Workeasy360Entitlements(EntitlementClient client, Clock clock, Duration denialIdleLimit) {
        this.client = client;
        this.clock = clock;
        this.denialIdleMillis = denialIdleLimit.toMillis();
    }

    /** @param subject the person's {@code sub}, or {@code null} for an organization-level question */
    public Access accessFor(UUID organization, String subject) {
        long now = clock.millis();
        boolean probe = false;
        if (clientRefused) {
            if (now < clientRefusedUntilMillis) {
                return CLIENT_REFUSED;
            }
            probe = probing.compareAndSet(false, true);
            if (!probe) {
                return CLIENT_REFUSED;
            }
        }
        try {
            return decide(organization, subject, now, probe);
        } finally {
            if (probe) {
                probing.set(false);
            }
        }
    }

    private Access decide(UUID organization, String subject, long now, boolean probe) {
        String key = organization + ":" + (subject == null ? "*" : subject);
        Entry known = known(key, now);
        if (probe) {
            return ask(organization, subject, key, known, now);
        }
        if (known != null && now - known.checkedAtMillis() < known.freshForMillis()) {
            return known.access();
        }
        if (backingOff(key, now)) {
            return known != null ? known.access() : NOT_CHECKED;
        }
        boolean mine = asking.add(key);
        if (!mine && known != null) {
            return known.access();
        }
        try {
            return ask(organization, subject, key, known, now);
        } finally {
            if (mine) {
                asking.remove(key);
            }
        }
    }

    private Access ask(UUID organization, String subject, String key, Entry known, long now) {
        try {
            EntitlementClient.Answer answer = client.ask(organization, subject);
            clientRefused = false;
            Access access = new Access(answer.allowed(), answer.writeAllowed(), answer.reason());
            remember(key, new Entry(access, now, freshFor(answer), now), known);
            return access;
        } catch (EntitlementClient.Refused refused) {
            return refuse(organization, now, refused.getMessage());
        } catch (EntitlementClient.RateLimited limited) {
            if (clientRefused || now - lastRefusalMillis < REFUSAL_AFTERMATH_SECONDS * 1000L) {
                return refuse(organization, now, limited.getMessage() + " (after a refusal)");
            }
            return outage(organization, key, known, now, limited);
        } catch (EntitlementClient.Unavailable unavailable) {
            return outage(organization, key, known, now, unavailable);
        }
    }

    private Access refuse(UUID organization, long now, String detail) {
        log.error("workeasy360.entitlement_refused organization={} detail={}", organization, detail);
        clientRefusedUntilMillis = now + CLIENT_REFUSAL_SECONDS * 1000L;
        lastRefusalMillis = now;
        clientRefused = true;
        return CLIENT_REFUSED;
    }

    private Access outage(UUID organization, String key, Entry known, long now, EntitlementClient.Unavailable outage) {
        log.warn("workeasy360.entitlement_unavailable organization={} detail={} lastKnown={}", organization,
                outage.getMessage(), known == null ? "none" : known.access().allowed() ? "allow" : "deny");
        if (clientRefused) {
            clientRefusedUntilMillis = now + CLIENT_REFUSAL_SECONDS * 1000L;
            return CLIENT_REFUSED;
        }
        synchronized (lock) {
            backoffUntil.put(key, now + FAILURE_BACKOFF_SECONDS * 1000L);
            trimBackoffs(now);
        }
        return known != null ? known.access() : NOT_CHECKED;
    }

    private static long freshFor(EntitlementClient.Answer answer) {
        if (!answer.allowed()) {
            return DENIAL_RECHECK_SECONDS * 1000L;
        }
        int seconds = answer.revalidateAfter() == null ? DEFAULT_REVALIDATE_SECONDS : answer.revalidateAfter();
        return Math.max(MIN_REVALIDATE_SECONDS, Math.min(seconds, DEFAULT_REVALIDATE_SECONDS)) * 1000L;
    }

    private Entry known(String key, long now) {
        synchronized (lock) {
            Entry denial = denials.get(key);
            if (denial != null) {
                if (now - denial.lastUsedMillis() > denialIdleMillis) {
                    denials.remove(key);
                    return null;
                }
                Entry used = denial.used(now);
                denials.put(key, used);
                return used;
            }
            return allowances.get(key);
        }
    }

    private boolean backingOff(String key, long now) {
        synchronized (lock) {
            Long until = backoffUntil.get(key);
            return until != null && until > now;
        }
    }

    private void remember(String key, Entry entry, Entry previous) {
        long now = entry.checkedAtMillis();
        synchronized (lock) {
            backoffUntil.remove(key);
            if (entry.access().allowed()) {
                denials.remove(key);
                allowances.put(key, entry);
                while (allowances.size() > MAX_ENTRIES) {
                    allowances.remove(allowances.keySet().iterator().next());
                }
            } else {
                allowances.remove(key);
                denials.put(key, entry);
                dropIdleDenials(now);
                while (denials.size() > MAX_ENTRIES) {
                    denials.remove(denials.keySet().iterator().next());
                }
            }
        }
        if (previous == null || previous.access().allowed() != entry.access().allowed()
                || !previous.access().reason().equals(entry.access().reason())) {
            log.info("workeasy360.entitlement_changed allowed={} reason={}",
                    entry.access().allowed(), entry.access().reason());
        }
    }

    private void dropIdleDenials(long now) {
        Iterator<Entry> iterator = denials.values().iterator();
        while (iterator.hasNext()) {
            if (now - iterator.next().lastUsedMillis() > denialIdleMillis) {
                iterator.remove();
            } else {
                break;
            }
        }
    }

    private void trimBackoffs(long now) {
        if (backoffUntil.size() > MAX_ENTRIES) {
            backoffUntil.values().removeIf(until -> until <= now);
            if (backoffUntil.size() > MAX_ENTRIES) {
                backoffUntil.clear();
            }
        }
    }

    /** Forget everything (tests). */
    public void clear() {
        synchronized (lock) {
            allowances.clear();
            denials.clear();
            backoffUntil.clear();
        }
        asking.clear();
        clientRefused = false;
        clientRefusedUntilMillis = 0;
        lastRefusalMillis = Long.MIN_VALUE / 2;
        probing.set(false);
    }
}
