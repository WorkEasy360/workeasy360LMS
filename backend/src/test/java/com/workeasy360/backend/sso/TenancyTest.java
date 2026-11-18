package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.Organization;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.repo.Repos.OrganizationRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.service.PasswordResetService;
import com.workeasy360.backend.sso.identity.Workeasy360Operator;
import com.workeasy360.backend.sso.support.SsoTestBase;
import com.workeasy360.backend.web.ApiException;
import jakarta.servlet.http.Cookie;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MvcResult;

@DisplayName("Identity and tenancy: linked on (issuer, sub), pinned to one organization, never across organizations")
class TenancyTest extends SsoTestBase {

    @Autowired private OrganizationRepo orgs;
    @Autowired private UserRepo users;
    @Autowired private PasswordEncoder encoder;
    @Autowired private PasswordResetService passwordResets;
    @Autowired private ConfigurableApplicationContext context;

    @Test
    @DisplayName("a person linked in one organization who signs in for another is refused, and nothing is created")
    void crossOrganizationRefused() throws Exception {
        UUID home = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        String person = uuid();
        signedIn(home, person, null);

        MvcResult elsewhere = signInFresh("organization=" + other, spec -> spec.subject = person);
        assertThat(ssoError(elsewhere)).isEqualTo("account_conflict");
        assertThat(signedIn(sessionOf(elsewhere))).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from workeasy360_organizations where workeasy360_org_id = ?",
                Integer.class, other.toString())).as("the other organization's tenant was rolled back").isZero();
    }

    @Test
    @DisplayName("an address that belongs to an account of another organization is refused")
    void addressOfAnotherOrganization() throws Exception {
        String email = "shared-" + uuid().substring(0, 8) + "@example.com";
        signedIn(UUID.randomUUID(), uuid(), email);
        MvcResult someoneElse = signInFresh("organization=" + UUID.randomUUID(), spec -> spec.email = email);
        assertThat(ssoError(someoneElse)).isEqualTo("account_conflict");
    }

    @Test
    @DisplayName("a session cannot read another organization's course")
    void tenantIsolation() throws Exception {
        SignedIn ownerA = signedIn(UUID.randomUUID(), uuid(), null);
        SignedIn ownerB = signedIn(UUID.randomUUID(), uuid(), null);
        String courseId = "c-" + uuid().substring(0, 10);
        Cookie csrf = csrfCookie(ownerA.session());
        mvc.perform(post("/api/courses").session(ownerA.session()).cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                .contentType(MediaType.APPLICATION_JSON).content("{\"id\":\"" + courseId + "\",\"title\":\"Org A only\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/api/courses/" + courseId).session(ownerA.session())).andExpect(status().isOk());
        int status = mvc.perform(get("/api/courses/" + courseId).session(ownerB.session())).andReturn().getResponse().getStatus();
        assertThat(status).as("another organization's administrator").isIn(403, 404);
        String list = mvc.perform(get("/api/courses").session(ownerB.session())).andReturn().getResponse().getContentAsString();
        assertThat(list).doesNotContain(courseId);
    }

    @Test
    @DisplayName("an existing password account is linked by its verified address inside the linked organization; its password and tokens end")
    void linkExistingAccount() throws Exception {
        String suffix = uuid().substring(0, 8);
        Organization org = orgs.saveAndFlush(Organization.builder().name("Legacy " + suffix).slug("legacy-" + suffix).status("ACTIVE").build());
        String email = "legacy-" + suffix + "@example.com";
        User legacy = users.saveAndFlush(User.builder().name("Lee Legacy").email(email).role(Role.INSTRUCTOR).orgId(org.getId())
                .passwordHash(encoder.encode("Legacy-passw0rd")).title("Instructor").dept("Ops").hue(10).status("ACTIVE").streak(0).build());
        String token = login(email, "Legacy-passw0rd");
        mvc.perform(get("/api/courses").header("Authorization", "Bearer " + token)).andExpect(status().isOk());

        UUID workeasy360Org = UUID.randomUUID();
        assertThat(operator("link", "--workeasy360-organization=" + workeasy360Org, "--organization=" + org.getId()))
                .contains("linked " + org.getId());
        Thread.sleep(1100); // iat has whole seconds: the old token is from an earlier second than the link

        SignedIn linked = signedIn(workeasy360Org, uuid(), email.toUpperCase());
        String json = mvc.perform(get("/api/auth/session").session(linked.session())).andReturn().getResponse().getContentAsString();
        assertThat((String) JsonPath.read(json, "$.user.id")).isEqualTo(legacy.getId());
        assertThat((String) JsonPath.read(json, "$.user.role")).as("the role WorkEasyLMS gave them stays").isEqualTo("INSTRUCTOR");

        guard.evictAll();
        mvc.perform(get("/api/courses").header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"Legacy-passw0rd\"}")).andExpect(status().isUnauthorized());
        assertThatThrownBy(() -> passwordResets.issue(legacy.getId(), null)).isInstanceOf(ApiException.class)
                .hasMessageContaining("signs in with WorkEasy360");
    }

    @Test
    @DisplayName("a deactivated account's session ends at its next request, and it cannot sign in again")
    void deactivation() throws Exception {
        UUID organization = UUID.randomUUID();
        SignedIn admin = signedIn(organization, uuid(), null);
        String learnerSubject = uuid();
        SignedIn learner = signedIn(organization, learnerSubject, null);
        String learnerId = JsonPath.read(mvc.perform(get("/api/auth/session").session(learner.session()))
                .andReturn().getResponse().getContentAsString(), "$.user.id");

        Cookie csrf = csrfCookie(admin.session());
        mvc.perform(put("/api/users/" + learnerId).session(admin.session()).cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"INACTIVE\"}")).andExpect(status().isOk());

        mvc.perform(get("/api/courses").session(learner.session())).andExpect(status().isUnauthorized());
        assertThat(learner.session().isInvalid()).isTrue();
        assertThat(ssoError(signInFresh("organization=" + organization, spec -> spec.subject = learnerSubject)))
                .isEqualTo("account_disabled");
    }

    @Test
    @DisplayName("operator commands: list, link refuses a taken side, unlink, move-issuer")
    void operatorCommands() throws Exception {
        UUID organization = UUID.randomUUID();
        signedIn(organization, uuid(), null);
        String orgId = jdbc.queryForObject("select org_id from workeasy360_organizations where workeasy360_org_id = ?",
                String.class, organization.toString());

        assertThat(operator("list")).contains(orgId).contains(organization.toString()).contains("first-sign-in");
        assertThat(operator("link", "--workeasy360-organization=" + organization, "--organization=org-default"))
                .contains("refused");
        assertThat(operator("link", "--workeasy360-organization=" + UUID.randomUUID(), "--organization=" + orgId))
                .contains("refused");
        assertThat(operator("link", "--workeasy360-organization=" + UUID.randomUUID(), "--organization=org-platform"))
                .contains("refused");
        assertThat(operator("link", "--workeasy360-organization=nope", "--organization=" + orgId)).contains("error");

        String movedTo = "https://accounts.example.test/" + uuid().substring(0, 6);
        assertThat(operator("move-issuer", "--from=" + FAKE.issuer(), "--to=" + movedTo)).contains("moved");
        assertThat(jdbc.queryForObject("select count(*) from workeasy360_organizations where issuer = ? and workeasy360_org_id = ?",
                Integer.class, movedTo, organization.toString())).isEqualTo(1);
        assertThat(operator("move-issuer", "--from=" + movedTo, "--to=" + FAKE.issuer())).contains("moved");

        assertThat(operator("unlink", "--workeasy360-organization=" + organization)).contains("unlinked " + orgId);
        assertThat(links.find(FAKE.issuer(), organization)).isEmpty();
        assertThat(jdbc.queryForObject("select count(*) from audit_events where action like 'workeasy360.operator.%' and org_id = ?",
                Integer.class, orgId)).isPositive();
    }

    private String operator(String... args) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        Workeasy360Operator.from(context, new PrintStream(bytes, true, StandardCharsets.UTF_8)).execute(args);
        return bytes.toString(StandardCharsets.UTF_8);
    }

    private String login(String email, String password) throws Exception {
        String json = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.token").exists())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(json, "$.token");
    }
}
