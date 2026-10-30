package com.workeasy360.backend.security;

import com.workeasy360.backend.domain.Enums;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;

import java.util.List;

/** The authenticated principal placed in the SecurityContext by JwtAuthFilter. */
public class CurrentUser extends User {
    /** The organization every pre-tenancy row (and token) belongs to. */
    public static final String DEFAULT_ORG = "org-default";

    private final String id;
    private final Enums.Role role;
    private final String orgId;

    public CurrentUser(String id, Enums.Role role, String orgId) {
        super(id, "", authorities(role));
        this.id = id;
        this.role = role;
        this.orgId = orgId == null || orgId.isBlank() ? DEFAULT_ORG : orgId;
    }

    private static List<GrantedAuthority> authorities(Enums.Role role) {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role.name()));
    }

    public String getId() { return id; }
    public Enums.Role getRole() { return role; }
    public String getOrgId() { return orgId; }
}
