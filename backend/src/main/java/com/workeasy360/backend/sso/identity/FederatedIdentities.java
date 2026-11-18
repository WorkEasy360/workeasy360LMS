package com.workeasy360.backend.sso.identity;

import com.workeasy360.backend.domain.Ids;
import com.workeasy360.backend.sso.SsoDatabase;
import java.time.Instant;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

/**
 * Which WorkEasy360 person (issuer + {@code sub}) is which WorkEasyLMS account ({@code federated_identities}, V12).
 * E-mail and name are profile data as last reported, never used to look anything up here.
 */
@Component
public class FederatedIdentities {

    static final int EMAIL_MAX = 320;
    static final int NAME_MAX = 200;

    public record Identity(String id, String issuer, String subject, String userId) {
    }

    private static final RowMapper<Identity> ROW = (rs, n) -> new Identity(rs.getString("id"),
            rs.getString("issuer"), rs.getString("subject"), rs.getString("user_id"));

    private final JdbcTemplate jdbc;

    public FederatedIdentities(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Identity> find(String issuer, String subject) {
        return jdbc.query("select id, issuer, subject, user_id from federated_identities where issuer = ? and subject = ?",
                ROW, issuer, subject).stream().findFirst();
    }

    public Optional<Identity> forUser(String userId) {
        return jdbc.query("select id, issuer, subject, user_id from federated_identities where user_id = ?",
                ROW, userId).stream().findFirst();
    }

    /** The account signs in with WorkEasy360 (any password it had is kept, but never reset or changed). */
    public boolean isFederated(String userId) {
        Integer count = jdbc.queryForObject("select count(*) from federated_identities where user_id = ?",
                Integer.class, userId);
        return count != null && count > 0;
    }

    /** @throws org.springframework.dao.DataIntegrityViolationException when the identity or the account is linked */
    public void insert(String issuer, String subject, String userId, String email, String name, Instant now) {
        jdbc.update("insert into federated_identities (id, issuer, subject, user_id, email, display_name, created_at,"
                        + " last_sign_in_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
                Ids.next("fid"), issuer, subject, userId, clip(email, EMAIL_MAX), clip(name, NAME_MAX),
                SsoDatabase.utc(now), SsoDatabase.utc(now));
    }

    public void signedIn(String id, String email, String name, Instant now) {
        jdbc.update("update federated_identities set email = ?, display_name = ?, last_sign_in_at = ? where id = ?",
                clip(email, EMAIL_MAX), clip(name, NAME_MAX), SsoDatabase.utc(now), id);
    }

    /** The issuer move (ADR-067): every identity linked under {@code from} now belongs to {@code to}. */
    public int moveIssuer(String from, String to) {
        return jdbc.update("update federated_identities set issuer = ? where issuer = ?", to, from);
    }

    static String clip(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.strip();
        return trimmed.length() > max ? trimmed.substring(0, max) : trimmed;
    }
}
