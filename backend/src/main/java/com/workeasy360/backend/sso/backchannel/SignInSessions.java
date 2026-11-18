package com.workeasy360.backend.sso.backchannel;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionIdListener;
import jakarta.servlet.http.HttpSessionListener;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Which of this instance's WorkEasyLMS sessions each Workeasy360 sign-in opened, so that a logout token
 * delivered here ends them at once.
 *
 * <p>WorkEasyLMS's sessions are the servlet container's own {@code HttpSession}s, held in memory by the
 * instance that created them (there is no Spring Session). This index is therefore in memory too, and lives
 * exactly as long as the sessions it points at: the container reports every session that ends (an idle
 * timeout, a sign-out, an account switch, a session ended here) through {@link HttpSessionListener}, and every
 * change of id through {@link HttpSessionIdListener}. Spring Boot registers this bean with the embedded
 * container as both listeners.
 *
 * <p>This is the local half. Sessions held by the other instances (and sessions a restart brought back) are
 * reached through the shared {@link SignInRecords}: a logout token deletes their rows, and
 * {@link SignInRevocationFilter} ends each of them at its next request, wherever it is held.
 *
 * <p>Each session is recorded with the issuer and {@code sub} of the person and the {@code sid} of the
 * Workeasy360 sign-in that opened it (absent when the ID token carried none). A logout token naming a
 * {@code sid} ends the sessions of that sign-in only; one naming only {@code sub} ends every session of that
 * person.
 *
 * <p>A logout token can overtake the sign-in it ends: the person's browser may still be on its way back to
 * the callback with an ID token for that {@code sid}. Ended {@code sid}s are therefore remembered for
 * {@link #ENDED_SIGN_IN_MEMORY} (longer than an ID token lives), and {@link #opened} refuses to record a
 * session for one; checking and recording happen under the same lock as ending, so no session slips between.
 */
public class SignInSessions implements HttpSessionListener, HttpSessionIdListener {

    /** Longer than an ID token can be accepted (300 s plus 30 s of leeway). */
    static final Duration ENDED_SIGN_IN_MEMORY = Duration.ofMinutes(10);
    static final int MAX_ENDED_SIGN_INS = 10_000;

    private record Tracked(HttpSession session, String issuer, String subject, String sid) {
    }

    private final Clock clock;
    private final Map<String, Tracked> bySessionId = new ConcurrentHashMap<>();
    /** Ended sign-ins in the order they ended (so also by expiry). Guarded by {@code this}. */
    private final LinkedHashMap<String, Instant> endedSignIns = new LinkedHashMap<>();

    public SignInSessions(Clock clock) {
        this.clock = clock;
    }

    /**
     * Records the session a sign-in has just opened.
     *
     * @param sid the ID token's {@code sid}, or {@code null} when it carried none
     * @return {@code false} when Workeasy360 has already ended that sign-in: the session must not be used
     */
    public synchronized boolean opened(HttpSession session, String issuer, String subject, String sid) {
        if (sid != null && endedRecently(issuer, sid, clock.instant())) {
            return false;
        }
        bySessionId.put(session.getId(), new Tracked(session, issuer, subject, sid));
        return true;
    }

    /**
     * Ends the sessions a logout token names (Back-Channel Logout 1.0 section 2.7): with a {@code sid}, the
     * sessions that sign-in opened, and of {@code subject} only when that is given too; with only a
     * {@code subject}, every session of that person. A session that has already ended is skipped: delivery is
     * at least once, so ending an ended session is not an error.
     *
     * @return how many sessions this call ended
     * @throws RuntimeException when a session could not be ended; the sessions not yet ended stay recorded, so
     *         the same request delivered again ends them
     */
    public int end(String issuer, String subject, String sid) {
        List<Map.Entry<String, Tracked>> named = new ArrayList<>();
        synchronized (this) {
            if (sid != null) {
                remember(issuer, sid, clock.instant());
            }
            for (Map.Entry<String, Tracked> entry : bySessionId.entrySet()) {
                if (names(entry.getValue(), issuer, subject, sid)) {
                    named.add(Map.entry(entry.getKey(), entry.getValue()));
                }
            }
        }
        // Outside the lock: invalidating runs the container's session listeners, and a container may hold the
        // session's own monitor while it runs them.
        int ended = 0;
        for (Map.Entry<String, Tracked> entry : named) {
            if (invalidate(entry.getValue().session())) {
                ended++;
            }
            bySessionId.remove(entry.getKey(), entry.getValue());
        }
        return ended;
    }

    /** How many sessions are recorded (diagnostics and tests). */
    public int size() {
        return bySessionId.size();
    }

    // --- the container's notifications. Never take the lock here (see end). ----------------------------

    @Override
    public void sessionDestroyed(HttpSessionEvent event) {
        bySessionId.remove(event.getSession().getId());
    }

    @Override
    public void sessionIdChanged(HttpSessionEvent event, String oldSessionId) {
        Tracked tracked = bySessionId.remove(oldSessionId);
        if (tracked != null) {
            bySessionId.put(event.getSession().getId(), tracked);
        }
    }

    // --- internals ---------------------------------------------------------------------------------------

    private static boolean names(Tracked tracked, String issuer, String subject, String sid) {
        if (!issuer.equals(tracked.issuer())) {
            return false;
        }
        if (sid != null) {
            return sid.equals(tracked.sid()) && (subject == null || subject.equals(tracked.subject()));
        }
        return subject != null && subject.equals(tracked.subject());
    }

    /** {@code true} when this call ended the session; {@code false} when it had already ended. */
    private static boolean invalidate(HttpSession session) {
        try {
            session.invalidate();
            return true;
        } catch (IllegalStateException alreadyInvalidated) {
            return false;
        }
    }

    private void remember(String issuer, String sid, Instant now) {
        forgetExpired(now);
        String key = key(issuer, sid);
        endedSignIns.remove(key);
        endedSignIns.put(key, now.plus(ENDED_SIGN_IN_MEMORY));
        Iterator<String> oldest = endedSignIns.keySet().iterator();
        while (endedSignIns.size() > MAX_ENDED_SIGN_INS && oldest.hasNext()) {
            oldest.next();
            oldest.remove();
        }
    }

    private boolean endedRecently(String issuer, String sid, Instant now) {
        forgetExpired(now);
        return endedSignIns.containsKey(key(issuer, sid));
    }

    private void forgetExpired(Instant now) {
        Iterator<Instant> expiries = endedSignIns.values().iterator();
        while (expiries.hasNext() && !expiries.next().isAfter(now)) {
            expiries.remove();
        }
    }

    private static String key(String issuer, String sid) {
        return issuer + '\n' + sid;
    }
}
