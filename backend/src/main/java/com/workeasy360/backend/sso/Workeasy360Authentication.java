package com.workeasy360.backend.sso;

import java.util.List;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

/**
 * What a WorkEasy360 sign-in saves into the server-side session: a {@link Workeasy360Principal}, no credentials.
 *
 * <p>It is never what a controller sees. On every request {@code Workeasy360SessionFilter} turns it into a
 * {@link Workeasy360User} with the account's <em>current</em> role and organization, or refuses the request.
 */
public class Workeasy360Authentication extends AbstractAuthenticationToken {

    private static final long serialVersionUID = 1L;

    private final Workeasy360Principal principal;

    public Workeasy360Authentication(Workeasy360Principal principal) {
        super(List.of(new SimpleGrantedAuthority("ROLE_WORKEASY360_SESSION")));
        this.principal = principal;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return "";
    }

    @Override
    public Workeasy360Principal getPrincipal() {
        return principal;
    }

    @Override
    public String getName() {
        return principal.userId();
    }
}
