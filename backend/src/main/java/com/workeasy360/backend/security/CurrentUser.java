package com.workeasy360.backend.security;

import com.workeasy360.backend.domain.Enums;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

import java.util.List;

/** The authenticated principal placed in the SecurityContext by JwtAuthFilter. */
public class CurrentUser extends User {
    private final String id;
    private final Enums.Role role;

    public CurrentUser(String id, Enums.Role role) {
        super(id, "", authorities(role));
        this.id = id;
        this.role = role;
    }

    private static List<GrantedAuthority> authorities(Enums.Role role) {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    public String getId() { return id; }
    public Enums.Role getRole() { return role; }
}
