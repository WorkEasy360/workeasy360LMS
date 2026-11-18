package com.workeasy360.backend.sso.backchannel;

import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;

/**
 * Deletes a session's {@link SignInRecords} row when the servlet container reports that the session ended by
 * itself (a sign-out, an idle timeout, an account switch, a session ended here). Spring Boot registers this bean
 * with the embedded container as an {@link HttpSessionListener}.
 *
 * <p>Best effort: a row that cannot be deleted now is harmless (its session is gone, so nothing can present it)
 * and is deleted later as abandoned ({@link JdbcSignInRecords}). Once the application is shutting down this does
 * nothing, because the container ends its sessions after the database pool has closed; those rows are left for
 * the same clean-up, or for the restart that brings the sessions back when sessions are persisted.
 */
public class SignInRecordCleanup implements HttpSessionListener, DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(SignInRecordCleanup.class);

    private final SignInRecords records;
    private volatile boolean closing;

    public SignInRecordCleanup(SignInRecords records) {
        this.records = records;
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent event) {
        if (closing) {
            return;
        }
        Object recordId;
        try {
            recordId = event.getSession().getAttribute(SignInRecords.SESSION_ATTRIBUTE);
        } catch (IllegalStateException alreadyInvalidated) {
            return;
        }
        if (!(recordId instanceof String id)) {
            return;
        }
        try {
            records.closed(id);
        } catch (RuntimeException failure) {
            log.warn("workeasy360.sign_in_record_not_forgotten type={}", failure.getClass().getSimpleName());
        }
    }

    @Override
    public void destroy() {
        closing = true;
    }
}
