package com.workeasy360.backend.sso.backchannel;

import com.workeasy360.backend.sso.SsoDatabase;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The database-backed {@link ReceivedLogoutTokens} ({@code received_logout_tokens}, V12). Shared by every instance
 * and kept across restarts, so a captured token cannot be replayed against sessions opened after a deploy.
 *
 * <p>One transaction per token: rows that can no longer matter are deleted, the {@code jti} is inserted once (no row
 * inserted: a replay), and the sessions are ended. If ending them throws, the transaction rolls back and the
 * {@code jti} is not recorded. On PostgreSQL two deliveries of the same {@code jti} at once are serialised by the
 * primary key ({@code ON CONFLICT DO NOTHING}: the second waits for the first to commit, then finds the row); on the
 * single-process H2 dev database by a lock on the {@code jti} ({@link SsoDatabase#lock}).
 */
@Service
public class JdbcReceivedLogoutTokens implements ReceivedLogoutTokens {

    private static final String FORGET_EXPIRED = "DELETE FROM received_logout_tokens WHERE keep_until < ?";
    private static final String RECORD_POSTGRES = """
            INSERT INTO received_logout_tokens (issuer, jti, received_at, keep_until)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (issuer, jti) DO NOTHING""";
    private static final String SEEN = "SELECT count(*) FROM received_logout_tokens WHERE issuer = ? AND jti = ?";
    private static final String RECORD = """
            INSERT INTO received_logout_tokens (issuer, jti, received_at, keep_until) VALUES (?, ?, ?, ?)""";

    private final JdbcTemplate jdbc;
    private final SsoDatabase database;
    private final TransactionTemplate transactions;
    private final Clock clock;

    public JdbcReceivedLogoutTokens(JdbcTemplate jdbc, SsoDatabase database,
                                    PlatformTransactionManager transactionManager, Clock clock) {
        this.jdbc = jdbc;
        this.database = database;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    @Override
    public boolean acceptOnce(String issuer, String jti, Instant keepUntil, Runnable endSessions) {
        Boolean accepted = transactions.execute(status -> {
            OffsetDateTime now = SsoDatabase.utc(clock.instant());
            OffsetDateTime keep = SsoDatabase.utc(keepUntil);
            jdbc.update(FORGET_EXPIRED, now);
            if (!record(issuer, jti, now, keep)) {
                return false;
            }
            endSessions.run();
            return true;
        });
        return Boolean.TRUE.equals(accepted);
    }

    private boolean record(String issuer, String jti, OffsetDateTime now, OffsetDateTime keep) {
        if (database.isPostgres()) {
            return jdbc.update(RECORD_POSTGRES, issuer, jti, now, keep) > 0;
        }
        database.lock(jdbc, "jti\n" + issuer + '\n' + jti);
        Integer seen = jdbc.queryForObject(SEEN, Integer.class, issuer, jti);
        if (seen != null && seen > 0) {
            return false;
        }
        jdbc.update(RECORD, issuer, jti, now, keep);
        return true;
    }
}
