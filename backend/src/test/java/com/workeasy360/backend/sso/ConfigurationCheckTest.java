package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workeasy360.backend.sso.oidc.NextPath;
import com.workeasy360.backend.sso.support.TestClientKeys;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

@DisplayName("Start-up check of the WORKEASY360_* settings, and the landing route")
class ConfigurationCheckTest {

    private static Workeasy360Properties properties(String issuer, String redirect, String keyFile, boolean ssoOnly) {
        return new Workeasy360Properties(issuer, issuer == null ? null : "client", redirect, keyFile == null ? null : TestClientKeys.RSA_KEY_ID,
                keyFile, null, "workeasy_lms", null, ssoOnly, true, List.of("openid"), "", Duration.ofHours(1), Duration.ofSeconds(5));
    }

    private static void check(Workeasy360Properties properties, String... profiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profiles);
        new Workeasy360ConfigurationCheck(properties, environment).afterPropertiesSet();
    }

    private static final String KEY = TestClientKeys.RSA_FILE.toString();

    @Test
    @DisplayName("nothing set: starts as before; SSO-only with nothing set: refuses")
    void nothingSet() {
        assertThatCode(() -> check(properties(null, null, null, false), "postgres")).doesNotThrowAnyException();
        assertThatThrownBy(() -> check(properties(null, null, null, true), "postgres"))
                .hasMessageContaining("WORKEASY360_SSO_ONLY").hasMessageContaining("WORKEASY360_ISSUER");
    }

    @Test
    @DisplayName("partly set: refuses, naming what is missing (never a value)")
    void partlySet() {
        assertThatThrownBy(() -> check(properties("https://accounts.workeasy360.com", null, null, false), "postgres"))
                .hasMessageContaining("WORKEASY360_REDIRECT_URI").hasMessageContaining("WORKEASY360_PRIVATE_KEY_FILE");
    }

    @Test
    @DisplayName("https everywhere; plain http only for a loopback host under a local profile")
    void schemes() {
        String redirect = "https://learn.workeasy360.com/api/auth/callback/workeasy360";
        assertThatCode(() -> check(properties("https://accounts.workeasy360.com", redirect, KEY, false), "postgres"))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> check(properties("http://127.0.0.1:8031", redirect, KEY, false), "postgres"))
                .hasMessageContaining("https");
        assertThatCode(() -> check(properties("http://127.0.0.1:8031", "http://localhost:8080/api/auth/callback/workeasy360", KEY, false),
                "postgres", "local")).doesNotThrowAnyException();
        assertThatCode(() -> check(properties("http://127.0.0.1:8031", redirect, KEY, false), "dev")).doesNotThrowAnyException();
        assertThatThrownBy(() -> check(properties("http://accounts.workeasy360.com", redirect, KEY, false), "dev"))
                .as("not a loopback host").hasMessageContaining("https");
    }

    @Test
    @DisplayName("loopback is localhost, ::1 and all of 127.0.0.0/8, as the platform defines it; never a look-alike")
    void loopbackRange() {
        assertThatCode(() -> check(properties("http://127.0.0.1:8031", "http://127.0.0.12:8312/api/auth/callback/workeasy360",
                KEY, false), "postgres", "local")).doesNotThrowAnyException();
        assertThatThrownBy(() -> check(properties("http://127.0.0.1:8031", "http://127.0.0.12:8312/api/auth/callback/workeasy360",
                KEY, false), "postgres")).as("not under a local profile").hasMessageContaining("https");
        for (String host : new String[] {"127.0.0.1", "127.0.0.12", "127.255.255.254", "localhost", "LOCALHOST", "[::1]"}) {
            assertThat(Workeasy360ConfigurationCheck.acceptable("http://" + host + ":8312/x", true)).as(host).isTrue();
        }
        for (String host : new String[] {"128.0.0.1", "10.0.0.1", "127.0.0.256", "127.0.0.1.example.com", "127.example.com",
                "localhost.example.com", "[::2]"}) {
            assertThat(Workeasy360ConfigurationCheck.acceptable("http://" + host + ":8312/x", true)).as(host).isFalse();
        }
    }

    @Test
    @DisplayName("an unusable private key refuses to start")
    void badKey() throws Exception {
        java.nio.file.Path bad = java.nio.file.Files.createTempFile("lms-bad-key", ".pem");
        java.nio.file.Files.writeString(bad, "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n");
        assertThatThrownBy(() -> check(properties("https://accounts.workeasy360.com",
                "https://learn.workeasy360.com/api/auth/callback/workeasy360", bad.toString(), false), "postgres"))
                .hasMessageContaining("private key").hasMessageNotContaining("AAAA");
    }

    @Test
    @DisplayName("landing routes are same-site paths of the app")
    void nextPath() {
        assertThat(NextPath.sanitize("/courses")).isEqualTo("/courses");
        assertThat(NextPath.sanitize("/#/learn/c-1/l-2")).isEqualTo("/learn/c-1/l-2");
        assertThat(NextPath.sanitize("/explore?tab=all")).isEqualTo("/explore?tab=all");
        for (String unsafe : new String[] {null, "", "courses", "//evil.example", "/\\evil", "/a#b", "/x y", "/%2f%2fevil",
                "/login", "/login?x=1", "/reset/abc", "/api/courses", "https://evil.example"}) {
            assertThat(NextPath.sanitize(unsafe)).as(String.valueOf(unsafe)).isEqualTo("/");
        }
        Workeasy360Properties withApp = new Workeasy360Properties(null, null, null, null, null, null, "workeasy_lms", null, false,
                true, List.of("openid"), "http://localhost:5173/", Duration.ofHours(1), Duration.ofSeconds(5));
        assertThat(withApp.appLocation("/courses")).isEqualTo("http://localhost:5173/#/courses");
        assertThat(properties(null, null, null, false).appLocation("/")).isEqualTo("/#/");
    }
}
