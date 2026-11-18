package com.workeasy360.backend.sso.backchannel;

/**
 * The shared record of which Workeasy360 sign-in each signed-in WorkEasyLMS session belongs to, and of the
 * sign-ins Workeasy360 has ended. Every instance reads and writes the same record (PostgreSQL,
 * {@link JdbcSignInRecords}), so a logout token delivered to any instance ends the sessions held by all of them.
 *
 * <p>WorkEasyLMS's sessions stay the servlet container's own, in the memory of the instance that created them.
 * What is shared is one row per signed-in session: the person (issuer and {@code sub}), the {@code sid} of the
 * Workeasy360 sign-in that opened it, and a random record id that the session carries as
 * {@link #SESSION_ATTRIBUTE}. The session id itself is never stored: it is a bearer credential.
 *
 * <ul>
 *   <li>At sign-in, {@link #open} creates the row (or refuses, when Workeasy360 has already ended that
 *       {@code sid}).
 *   <li>On every request made with a signed-in session, {@link SignInRevocationFilter} asks {@link #isOpen}.
 *       A session whose row is gone is ended on the spot, on whichever instance holds it.
 *   <li>A logout token deletes the rows it names ({@link #end}), in the same transaction that records its
 *       {@code jti}.
 * </ul>
 *
 * A missing row therefore means "ended": deleting a row can only ever sign someone out, never in.
 */
public interface SignInRecords {

    /** The session attribute holding the record id (a {@code String}) of a signed-in session. */
    String SESSION_ATTRIBUTE = SignInRecords.class.getName() + ".RECORD";

    /**
     * Records a session that a sign-in has just opened.
     *
     * @param sid the ID token's {@code sid}, or {@code null} when it carried none
     * @return the record id to keep in the session, or {@code null} when Workeasy360 has already ended that
     *         sign-in (its logout token overtook the browser): then the session must not be used
     * @throws RuntimeException when the record cannot be written
     */
    String open(String issuer, String subject, String sid);

    /**
     * Whether the session holding this record id is still signed in: {@code false} once a logout token ended it
     * (on any instance), or when there is no such record.
     *
     * @throws RuntimeException when the record cannot be read; the caller must not treat that as "open"
     */
    boolean isOpen(String recordId);

    /**
     * Ends the sign-ins a logout token names (Back-Channel Logout 1.0 section 2.7): with a {@code sid}, the
     * sessions that sign-in opened, and of {@code subject} only when that is given too, and the {@code sid} is
     * remembered so that a sign-in for it still on its way back is refused; with only a {@code subject}, every
     * session of that person under this issuer. Joins the caller's transaction when there is one.
     *
     * @return how many session records this call ended (on every instance); 0 when they had already ended
     */
    int end(String issuer, String subject, String sid);

    /** The session holding this record id has ended by itself (a sign-out, an idle timeout): forget it. */
    void closed(String recordId);
}
