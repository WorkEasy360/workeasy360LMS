package com.workeasy360.backend.sso.identity;

import com.workeasy360.backend.sso.SsoDatabase;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Component;

/**
 * Which WorkEasy360 organization is which WorkEasyLMS organization ({@code workeasy360_organizations}, V12): one to
 * one, keyed by (issuer, the token's {@code organization_id}).
 *
 * <p>{@link #workeasy360OrganizationOf} is asked on requests (is this tenant's access decided by WorkEasy360?), so
 * its answer is cached per instance for {@link #CACHE_MILLIS}; a link or unlink made on this instance applies at
 * once, one made elsewhere within that time.
 */
@Component
public class OrganizationLinks {

    public static final String BY_FIRST_SIGN_IN = "first-sign-in";
    public static final String BY_OPERATOR = "operator";
    static final long CACHE_MILLIS = 60_000;

    public record Link(String issuer, String workeasy360OrgId, String orgId, String linkedBy, Instant linkedAt) {
    }

    private record Cached(Optional<UUID> organization, long at) {
    }

    private static final RowMapper<Link> ROW = (rs, n) -> new Link(rs.getString("issuer"),
            rs.getString("workeasy360_org_id"), rs.getString("org_id"), rs.getString("linked_by"),
            rs.getObject("linked_at", OffsetDateTime.class).toInstant());

    private final JdbcTemplate jdbc;
    private final ConcurrentHashMap<String, Cached> byOrg = new ConcurrentHashMap<>();

    public OrganizationLinks(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Link> find(String issuer, UUID workeasy360OrgId) {
        return jdbc.query("select * from workeasy360_organizations where issuer = ? and workeasy360_org_id = ?",
                ROW, issuer, workeasy360OrgId.toString()).stream().findFirst();
    }

    public Optional<Link> forOrganization(String orgId) {
        return jdbc.query("select * from workeasy360_organizations where org_id = ?", ROW, orgId).stream().findFirst();
    }

    public List<Link> list() {
        return jdbc.query("select * from workeasy360_organizations order by linked_at", ROW);
    }

    /** @throws org.springframework.dao.DataIntegrityViolationException when either side is already linked */
    public void insert(String issuer, UUID workeasy360OrgId, String orgId, String linkedBy, Instant now) {
        jdbc.update("insert into workeasy360_organizations (issuer, workeasy360_org_id, org_id, linked_by, linked_at)"
                + " values (?, ?, ?, ?, ?)", issuer, workeasy360OrgId.toString(), orgId, linkedBy, SsoDatabase.utc(now));
        byOrg.remove(orgId);
    }

    public int unlink(String issuer, UUID workeasy360OrgId) {
        Optional<Link> link = find(issuer, workeasy360OrgId);
        int removed = jdbc.update("delete from workeasy360_organizations where issuer = ? and workeasy360_org_id = ?",
                issuer, workeasy360OrgId.toString());
        link.ifPresent(l -> byOrg.remove(l.orgId()));
        return removed;
    }

    /** The issuer move (ADR-067): every link made under {@code from} now belongs to {@code to}. */
    public int moveIssuer(String from, String to) {
        int moved = jdbc.update("update workeasy360_organizations set issuer = ? where issuer = ?", to, from);
        byOrg.clear();
        return moved;
    }

    /**
     * The WorkEasy360 organization this tenant is linked to, if any: what the entitlement API is asked about for
     * people of this tenant who did not sign in with WorkEasy360. Cached briefly.
     */
    public Optional<UUID> workeasy360OrganizationOf(String orgId) {
        if (orgId == null) {
            return Optional.empty();
        }
        long now = System.currentTimeMillis();
        Cached cached = byOrg.get(orgId);
        if (cached != null && now - cached.at() < CACHE_MILLIS) {
            return cached.organization();
        }
        Optional<UUID> organization = forOrganization(orgId).map(link -> UUID.fromString(link.workeasy360OrgId()));
        if (byOrg.size() > 10_000) {
            byOrg.clear();
        }
        byOrg.put(orgId, new Cached(organization, now));
        return organization;
    }

    /** Forget cached answers (tests, and after an operator change). */
    public void forgetCache() {
        byOrg.clear();
    }
}
