package com.workeasy360.backend.sso;

import java.sql.Connection;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Locale;
import java.util.concurrent.locks.ReentrantLock;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * The one place the sign-in tables meet a database dialect.
 *
 * <p>Production is PostgreSQL, where several instances can share the database: a lock on a sign-in is a
 * transaction-scoped advisory lock ({@code pg_advisory_xact_lock}), held until the transaction ends, so two
 * instances serialise on it. The zero-install dev profile is an embedded H2 file database, which only one process
 * can open at a time, so a lock held inside this process for the same span is exactly as strong there.
 */
@Component
public class SsoDatabase {

    /**
     * The first key of every advisory lock taken here. The two-key form of {@code pg_advisory_xact_lock} has a key
     * space of its own, so these locks never meet the one-key locks Flyway takes.
     */
    static final int LOCK_NAMESPACE = 0x4c4d5353;

    private final boolean postgres;
    private final ReentrantLock[] stripes = new ReentrantLock[64];

    public SsoDatabase(DataSource dataSource) {
        boolean detected;
        try (Connection connection = dataSource.getConnection()) {
            detected = connection.getMetaData().getDatabaseProductName().toLowerCase(Locale.ROOT).contains("postgres");
        } catch (Exception unreadable) {
            detected = true; // the production database; a wrong guess only changes how locks are taken
        }
        this.postgres = detected;
        for (int i = 0; i < stripes.length; i++) {
            stripes[i] = new ReentrantLock();
        }
    }

    public boolean isPostgres() {
        return postgres;
    }

    /**
     * Takes the lock on {@code key} until the surrounding transaction ends. Must be called inside one.
     */
    public void lock(JdbcTemplate jdbc, String key) {
        if (postgres) {
            jdbc.query("SELECT pg_advisory_xact_lock(?, hashtext(?))", resultSet -> { }, LOCK_NAMESPACE, key);
            return;
        }
        ReentrantLock stripe = stripes[Math.floorMod(key.hashCode(), stripes.length)];
        stripe.lock();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                stripe.unlock();
            }
        });
    }

    public static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
