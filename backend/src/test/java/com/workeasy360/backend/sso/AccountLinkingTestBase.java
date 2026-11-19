package com.workeasy360.backend.sso;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.sso.identity.Workeasy360Operator;
import com.workeasy360.backend.sso.support.SsoTestBase;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;

/** Existing customers (an operator-linked organization with password accounts) and the operator command. */
abstract class AccountLinkingTestBase extends SsoTestBase {

    static final String PASSWORD = "Legacy-passw0rd";

    @Autowired protected OrganizationRepo orgs;
    @Autowired protected UserRepo users;
    @Autowired private PasswordEncoder encoder;
    @Autowired private ConfigurableApplicationContext context;

    /** An existing customer: a WorkEasyLMS organization an operator linked, with one password account. */
    record Legacy(UUID workeasy360Org, String orgId, User user) {
        String email() {
            return user.getEmail();
        }
    }

    Legacy legacyCustomer(Role role) {
        String suffix = uuid().substring(0, 8);
        Organization org = orgs.saveAndFlush(Organization.builder().name("Legacy " + suffix).slug("legacy-" + suffix)
                .status("ACTIVE").build());
        UUID workeasy360Org = UUID.randomUUID();
        links.insert(FAKE.issuer(), workeasy360Org, org.getId(), "operator", Instant.now());
        return new Legacy(workeasy360Org, org.getId(), account(org.getId(), role));
    }

    /** Another password account in the same organization as {@code of}. */
    Legacy legacyIn(Legacy of, Role role) {
        return new Legacy(of.workeasy360Org(), of.orgId(), account(of.orgId(), role));
    }

    User account(String orgId, Role role) {
        String email = "legacy-" + uuid().substring(0, 8) + "@example.com";
        return users.saveAndFlush(User.builder().name("Lee Legacy").email(email).role(role).orgId(orgId)
                .passwordHash(encoder.encode(PASSWORD)).title("Staff").dept("Ops").hue(10).status("ACTIVE").streak(0).build());
    }

    record Run(int status, String output) {
    }

    Run operator(String... args) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int status = Workeasy360Operator.from(context, new PrintStream(bytes, true, StandardCharsets.UTF_8)).execute(args);
        return new Run(status, bytes.toString(StandardCharsets.UTF_8));
    }

    String login(String email) throws Exception {
        String json = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.token").exists())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.token");
    }

    int identityCount(String userId) {
        return jdbc.queryForObject("select count(*) from federated_identities where user_id = ?", Integer.class, userId);
    }

    int auditCount(String action, String orgId) {
        return jdbc.queryForObject("select count(*) from audit_events where action = ? and org_id = ?", Integer.class, action, orgId);
    }
}
