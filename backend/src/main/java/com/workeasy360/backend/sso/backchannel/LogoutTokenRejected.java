package com.workeasy360.backend.sso.backchannel;

/**
 * A logout token that must not be acted on. {@link #reason()} is a fixed, loggable code; the token itself
 * is never logged.
 */
public final class LogoutTokenRejected extends Exception {

    private static final long serialVersionUID = 1L;

    private final String reason;

    LogoutTokenRejected(String reason) {
        super(reason, null, false, false);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
