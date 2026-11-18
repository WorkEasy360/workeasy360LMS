package com.workeasy360.backend.sso;

import com.workeasy360.backend.domain.Enums;
import com.workeasy360.backend.security.CurrentUser;

/**
 * The request's principal for a WorkEasy360 session: an ordinary {@link CurrentUser} (so every controller and
 * permission rule works unchanged) with the account's current role and organization, plus the sign-in it came
 * from. Built per request by {@code Workeasy360SessionFilter}; never stored.
 */
public class Workeasy360User extends CurrentUser {

    private static final long serialVersionUID = 1L;

    private final Workeasy360Principal signIn;

    public Workeasy360User(Workeasy360Principal signIn, Enums.Role role) {
        super(signIn.userId(), role, signIn.orgId());
        this.signIn = signIn;
    }

    public Workeasy360Principal signIn() {
        return signIn;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Workeasy360User user && super.equals(user) && signIn.equals(user.signIn);
    }

    @Override
    public int hashCode() {
        return super.hashCode() * 31 + signIn.hashCode();
    }
}
