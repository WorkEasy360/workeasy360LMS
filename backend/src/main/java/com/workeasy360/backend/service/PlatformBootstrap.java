package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.repo.Repos.UserRepo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Creates the WorkEasy360 platform-owner account from the environment (PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD)
 * when none exists. The credentials live only in the deployment's environment file — never in source or logs. With no
 * environment values set, nothing is created (development uses the seeded platform fixture instead).
 */
@Component
@Order(90)
public class PlatformBootstrap implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(PlatformBootstrap.class);
    private final UserRepo users; private final PasswordEncoder encoder;
    private final String email; private final String password;

    public PlatformBootstrap(UserRepo users, PasswordEncoder encoder,
                             @Value("${PLATFORM_ADMIN_EMAIL:}") String email, @Value("${PLATFORM_ADMIN_PASSWORD:}") String password) {
        this.users = users; this.encoder = encoder; this.email = email; this.password = password;
    }

    @Override
    public void run(String... args) {
        if (email == null || email.isBlank() || password == null || password.isBlank()) return;
        if (password.length() < 12) { log.warn("PLATFORM_ADMIN_PASSWORD is too short (min 12 characters); platform owner account not created."); return; }
        if (!users.findByOrgIdAndRole(Organization.PLATFORM, Role.PLATFORM).isEmpty()) return;
        if (users.findByEmailIgnoreCase(email).isPresent()) { log.warn("PLATFORM_ADMIN_EMAIL already belongs to an existing account; platform owner account not created."); return; }
        users.save(User.builder().name("WorkEasy360 Platform").email(email.trim().toLowerCase()).role(Role.PLATFORM)
                .orgId(Organization.PLATFORM).passwordHash(encoder.encode(password))
                .title("Platform Owner").dept("WorkEasy360").hue(160).status("ACTIVE").streak(0).build());
        log.info("Platform owner account created for the configured PLATFORM_ADMIN_EMAIL.");
    }
}
