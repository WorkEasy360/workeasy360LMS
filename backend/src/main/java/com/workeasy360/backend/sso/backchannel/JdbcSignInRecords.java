package com.workeasy360.backend.sso.backchannel;

import com.workeasy360.backend.sso.SsoDatabase;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The database-backed {@link SignInRecords} ({@code signed_in_sessions} and {@code ended_sign_ins}, V12): one row per
 * WorkEasy360-signed-in session, and the recently ended {@code sid}s. Shared by every instance and kept across
 * restarts. Ported from Easy Project's {@code JdbcSignInRecords}, in SQL both PostgreSQL and H2 accept.
 *
 * <p><strong>A logout overtaking its sign-in.</strong> A sign-in for a {@code sid} ({@link #open}) and a logout
 * token for the same {@code sid} ({@link #end}) can run at the same moment on two instances. Each takes the same
 * transaction-scoped lock on (issuer, {@code sid}) ({@link SsoDatabase#lock}: a PostgreSQL advisory lock) before it
 * reads or writes anything about that sign-in, so one finishes before the other starts: either the session's row
 * exists before the logout deletes rows (and is deleted), or the logout's {@code ended_sign_ins} row exists before
 * the sign-in looks (and the sign-in is refused). Ended {@code sid}s are kept for
 * {@link SignInSessions#ENDED_SIGN_IN_MEMORY}, longer than an ID token for them can be accepted.
 *
 * <p><strong>Keeping the table small.</strong> A session that ends by itself deletes its row ({@link #closed}, from
 * {@link SignInRecordCleanup}). A row left behind by an instance that stopped is deleted once it has not been seen
 * for longer than the session idle timeout plus {@link #ABANDONED_MARGIN}: {@link #isOpen} refreshes {@code seen_at}
 * at most every {@link #SEEN_REFRESH} while the session is used. Both clean-ups run inside a sign-in's own
 * transaction; nothing runs in the background. Deleting a row can only ever sign someone out.
 */
@Service
public class JdbcSignInRecords implements SignInRecords {

    static final Duration SEEN_REFRESH = Duration.ofMinutes(5);
    static final Duration ABANDONED_MARGIN = Duration.ofHours(1);

    private static final String FORGET_ABANDONED = "DELETE FROM signed_in_sessions WHERE seen_at < ?";
    private static final String FORGET_EXPIRED_ENDINGS = "DELETE FROM ended_sign_ins WHERE keep_until <= ?";
    private static final String IS_ENDED =
            "SELECT count(*) FROM ended_sign_ins WHERE issuer = ? AND sid = ? AND keep_until > ?";
    private static final String OPEN = """
            INSERT INTO signed_in_sessions (id, issuer, subject, sid, created_at, seen_at)
            VALUES (?, ?, ?, ?, ?, ?)""";
    private static final String SEEN_AT = "SELECT seen_at FROM signed_in_sessions WHERE id = ?";
    private static final String TOUCH = "UPDATE signed_in_sessions SET seen_at = ? WHERE id = ? AND seen_at < ?";
    private static final String ENDED_UNTIL = "SELECT keep_until FROM ended_sign_ins WHERE issuer = ? AND sid = ?";
    private static final String REMEMBER_ENDED =
            "INSERT INTO ended_sign_ins (issuer, sid, ended_at, keep_until) VALUES (?, ?, ?, ?)";
    private static final String RE_REMEMBER_ENDED =
            "UPDATE ended_sign_ins SET ended_at = ?, keep_until = ? WHERE issuer = ? AND sid = ?";
    private static final String END_SIGN_IN = "DELETE FROM signed_in_sessions WHERE issuer = ? AND sid = ?";
    private static final String END_SIGN_IN_OF_SUBJECT =
            "DELETE FROM signed_in_sessions WHERE issuer = ? AND sid = ? AND subject = ?";
    private static final String END_SUBJECT = "DELETE FROM signed_in_sessions WHERE issuer = ? AND subject = ?";
    private static final String CLOSE = "DELETE FROM signed_in_sessions WHERE id = ?";

    private final JdbcTemplate jdbc;
    private final SsoDatabase database;
    private final TransactionTemplate transactions;
    private final Clock clock;
    private final Duration abandonedAfter;

    public JdbcSignInRecords(JdbcTemplate jdbc, SsoDatabase database, PlatformTransactionManager transactionManager,
                             Clock clock, @Value("${server.servlet.session.timeout:8h}") Duration sessionIdleTimeout) {
        this.jdbc = jdbc;
        this.database = database;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
        this.abandonedAfter = sessionIdleTimeout.plus(SEEN_REFRESH).plus(ABANDONED_MARGIN);
    }

    @Override
    public String open(String issuer, String subject, String sid) {
        return transactions.execute(status -> {
            // The lock first, as end() takes it: the clean-up below may touch rows a logout for this sid deletes.
            if (sid != null) {
                lock(issuer, sid);
            }
            Instant now = clock.instant();
            jdbc.update(FORGET_ABANDONED, SsoDatabase.utc(now.minus(abandonedAfter)));
            jdbc.update(FORGET_EXPIRED_ENDINGS, SsoDatabase.utc(now));
            if (sid != null) {
                Integer ended = jdbc.queryForObject(IS_ENDED, Integer.class, issuer, sid, SsoDatabase.utc(now));
                if (ended != null && ended > 0) {
                    return null;
                }
            }
            String id = UUID.randomUUID().toString();
            jdbc.update(OPEN, id, issuer, subject, sid, SsoDatabase.utc(now), SsoDatabase.utc(now));
            return id;
        });
    }

    @Override
    public boolean isOpen(String recordId) {
        String id = parse(recordId);
        if (id == null) {
            return false;
        }
        List<OffsetDateTime> seen = jdbc.queryForList(SEEN_AT, OffsetDateTime.class, id);
        if (seen.isEmpty()) {
            return false;
        }
        Instant now = clock.instant();
        Instant refreshBefore = now.minus(SEEN_REFRESH);
        if (seen.get(0).toInstant().isBefore(refreshBefore)) {
            jdbc.update(TOUCH, SsoDatabase.utc(now), id, SsoDatabase.utc(refreshBefore));
        }
        return true;
    }

    @Override
    public int end(String issuer, String subject, String sid) {
        Integer ended = transactions.execute(status -> {
            if (sid == null) {
                return jdbc.update(END_SUBJECT, issuer, subject);
            }
            Instant now = clock.instant();
            lock(issuer, sid);
            Instant keepUntil = now.plus(SignInSessions.ENDED_SIGN_IN_MEMORY);
            List<OffsetDateTime> known = jdbc.queryForList(ENDED_UNTIL, OffsetDateTime.class, issuer, sid);
            if (known.isEmpty()) {
                jdbc.update(REMEMBER_ENDED, issuer, sid, SsoDatabase.utc(now), SsoDatabase.utc(keepUntil));
            } else {
                Instant kept = known.get(0).toInstant();
                jdbc.update(RE_REMEMBER_ENDED, SsoDatabase.utc(now),
                        SsoDatabase.utc(kept.isAfter(keepUntil) ? kept : keepUntil), issuer, sid);
            }
            return subject == null
                    ? jdbc.update(END_SIGN_IN, issuer, sid)
                    : jdbc.update(END_SIGN_IN_OF_SUBJECT, issuer, sid, subject);
        });
        return ended == null ? 0 : ended;
    }

    @Override
    public void closed(String recordId) {
        String id = parse(recordId);
        if (id != null) {
            jdbc.update(CLOSE, id);
        }
    }

    /** Held until the surrounding transaction ends. */
    private void lock(String issuer, String sid) {
        database.lock(jdbc, "sid\n" + issuer + '\n' + sid);
    }

    /** A record id is a canonical UUID; anything else names no record. */
    private static String parse(String recordId) {
        if (recordId == null || recordId.length() != 36) {
            return null;
        }
        try {
            return UUID.fromString(recordId).toString();
        } catch (IllegalArgumentException notARecordId) {
            return null;
        }
    }
}
