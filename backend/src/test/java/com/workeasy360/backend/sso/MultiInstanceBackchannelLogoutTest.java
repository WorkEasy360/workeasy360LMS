package com.workeasy360.backend.sso;

import static org.assertj.core.api.Assertions.assertThat;

import com.workeasy360.backend.BackendApplication;
import com.workeasy360.backend.sso.support.FakeWorkeasy360;
import com.workeasy360.backend.sso.support.FakeWorkeasy360.LogoutTokenSpec;
import com.workeasy360.backend.sso.support.TestClientKeys;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.TypeExcludeFilter;
import org.springframework.boot.web.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.type.classreading.MetadataReader;
import org.springframework.core.type.classreading.MetadataReaderFactory;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Back-channel logout with more than one instance: two copies of the whole application (two embedded Tomcats, each
 * with its own in-memory sessions) sharing one database, as behind a load balancer. People sign in on one instance;
 * WorkEasy360's logout token is delivered to the other; the session cookie must stop working where the session lives.
 * Instance A persists its sessions across a restart (Tomcat's session store), so the restart test brings a revoked
 * session back from disk and proves it is still refused. Every request is real HTTP with the browser's cookie; nothing
 * is mocked except WorkEasy360 ({@link FakeWorkeasy360}).
 *
 * <p>Run against PostgreSQL ({@code LMS_TEST_DB_URL}) this is the production arrangement. Against the in-memory H2
 * fallback both instances share the JVM's database, which proves the same sharing.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DisplayName("Back-channel logout across instances: two servers, one database")
class MultiInstanceBackchannelLogoutTest {

    private static final FakeWorkeasy360 FAKE = FakeWorkeasy360.shared();
    private static final String SESSION_COOKIE = "__Host-lms_session";

    private record Instance(String name, ConfigurableApplicationContext context, int port) {
        URI uri(String path) {
            return URI.create("http://127.0.0.1:" + port + path);
        }

        JdbcTemplate jdbc() {
            return context.getBean(JdbcTemplate.class);
        }
    }

    /** The application's own component scan, without the test classes that share its packages. */
    static final class ApplicationClassesOnly extends TypeExcludeFilter {
        @Override
        public boolean match(MetadataReader reader, MetadataReaderFactory factory) throws IOException {
            return reader.getResource().getURL().toString().contains("/test-classes/");
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof ApplicationClassesOnly;
        }

        @Override
        public int hashCode() {
            return ApplicationClassesOnly.class.hashCode();
        }
    }

    private Path sessionStoreOfA;
    private Instance a;
    private Instance b;
    private final HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

    @BeforeAll
    void startTwoInstances() throws IOException {
        FAKE.reset();
        sessionStoreOfA = Files.createTempDirectory("lms-sessions-a");
        a = start("instance-a", sessionStoreOfA);
        b = start("instance-b", null);
        assertThat(a.port()).isNotEqualTo(b.port());
    }

    @AfterAll
    void stop() {
        if (a != null) a.context().close();
        if (b != null) b.context().close();
        if (sessionStoreOfA != null) {
            try (var files = Files.walk(sessionStoreOfA)) {
                files.sorted(java.util.Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
            } catch (IOException ignored) {
                // a temporary directory
            }
        }
    }

    private static Instance start(String name, Path sessionStore) {
        List<String> arguments = new ArrayList<>(List.of(
                "--server.port=0",
                "--spring.profiles.active=test",
                "--workeasy360.issuer=" + FAKE.issuer(),
                "--workeasy360.client-id=" + FakeWorkeasy360.CLIENT_ID,
                "--workeasy360.redirect-uri=" + FakeWorkeasy360.REDIRECT_URI,
                "--workeasy360.key-id=" + TestClientKeys.RSA_KEY_ID,
                "--workeasy360.private-key-file=" + TestClientKeys.RSA_FILE,
                "--workeasy360.http-timeout=3s"));
        if (sessionStore != null) {
            arguments.add("--server.servlet.session.persistent=true");
            arguments.add("--server.servlet.session.store-dir=" + sessionStore);
        }
        ConfigurableApplicationContext context = new SpringApplicationBuilder(BackendApplication.class)
                .initializers(applicationContext -> applicationContext.getBeanFactory()
                        .registerSingleton(ApplicationClassesOnly.class.getName(), new ApplicationClassesOnly()))
                .run(arguments.toArray(String[]::new));
        int port = ((WebServerApplicationContext) context).getWebServer().getPort();
        return new Instance(name, context, port);
    }

    @Test
    @Order(1)
    @DisplayName("the session cookie is httpOnly, Secure, SameSite=Lax and host-only (__Host-), and the callback hands out no token")
    void cookieAttributes() throws Exception {
        HttpResponse<String> started = get(a, "/api/auth/workeasy360/start", null);
        String flowCookie = cookieValue(started);
        FakeWorkeasy360.Authorization authorization = FAKE.parse(started.headers().firstValue("Location").orElseThrow());
        String code = FAKE.issueCode(authorization, spec -> spec.subject = uuid());
        HttpResponse<String> callback = get(a, "/api/auth/callback/workeasy360?code=" + encode(code) + "&state="
                + encode(authorization.state()), flowCookie);

        String setCookie = callback.headers().allValues("Set-Cookie").stream()
                .filter(v -> v.startsWith(SESSION_COOKIE + "=")).findFirst().orElseThrow();
        assertThat(setCookie).contains("HttpOnly").contains("Secure").contains("SameSite=Lax").contains("Path=/")
                .doesNotContainIgnoringCase("Domain=");
        assertThat(callback.headers().firstValue("Location")).contains("/#/");
        assertThat(callback.body()).isEmpty();
        assertThat(callback.headers().firstValue("Location").orElseThrow()).doesNotContain("token").doesNotContain(code);
    }

    @Test
    @Order(2)
    @DisplayName("a sid logout delivered to B ends that sign-in's sessions on A (and on B), and nothing else")
    void sidLogoutDeliveredToTheOtherInstance() throws Exception {
        String person = uuid();
        String sid = uuid();
        UUID organization = UUID.randomUUID();
        String onA = signIn(a, organization, person, sid);
        String sameSignInOnB = signIn(b, organization, person, sid);
        String otherSignInOnA = signIn(a, organization, person, uuid());
        String colleagueOnA = signIn(a, organization, uuid(), uuid());
        assertThat(status(a, "/api/courses", onA)).isEqualTo(200);
        assertThat(status(b, "/api/auth/session", sameSignInOnB)).isEqualTo(200);

        HttpResponse<String> delivered = deliver(b, token(spec -> {
            spec.subject = person;
            spec.sid = sid;
        }));

        assertThat(delivered.statusCode()).isEqualTo(200);
        assertThat(delivered.body()).isEmpty();
        assertThat(status(a, "/api/courses", onA)).as("A's session, ended by B's delivery").isEqualTo(401);
        assertThat(status(a, "/api/auth/session", onA)).isEqualTo(401);
        assertThat(status(b, "/api/auth/session", sameSignInOnB)).as("B's own session of that sign-in").isEqualTo(401);
        assertThat(status(a, "/api/auth/session", otherSignInOnA)).as("the person's other sign-in").isEqualTo(200);
        assertThat(status(a, "/api/auth/session", colleagueOnA)).isEqualTo(200);
        assertThat(a.jdbc().queryForObject("select count(*) from signed_in_sessions where issuer = ? and sid = ?",
                Integer.class, FAKE.issuer(), sid)).isZero();
    }

    @Test
    @Order(3)
    @DisplayName("a sub-only logout delivered to A ends every session of that person on B")
    void subjectLogoutDeliveredToTheOtherInstance() throws Exception {
        String person = uuid();
        UUID organization = UUID.randomUUID();
        String onB = signIn(b, organization, person, uuid());
        String onBWithoutSid = signIn(b, organization, person, null);
        String colleagueOnB = signIn(b, organization, uuid(), uuid());

        assertThat(deliver(a, token(spec -> spec.subject = person)).statusCode()).isEqualTo(200);

        assertThat(status(b, "/api/auth/session", onB)).isEqualTo(401);
        assertThat(status(b, "/api/courses", onBWithoutSid)).isEqualTo(401);
        assertThat(status(b, "/api/auth/session", colleagueOnB)).isEqualTo(200);
    }

    @Test
    @Order(4)
    @DisplayName("the same token to either instance, or to both at once, gets 200 and is acted on once")
    void duplicateDeliveries() throws Exception {
        String person = uuid();
        UUID organization = UUID.randomUUID();
        String first = signIn(a, organization, person, uuid());
        String logoutToken = token(spec -> spec.subject = person);
        assertThat(deliver(b, logoutToken).statusCode()).isEqualTo(200);
        assertThat(status(a, "/api/auth/session", first)).isEqualTo(401);

        String later = signIn(a, organization, person, uuid());
        assertThat(deliver(b, logoutToken).statusCode()).isEqualTo(200);
        assertThat(deliver(a, logoutToken).statusCode()).isEqualTo(200);
        assertThat(status(a, "/api/auth/session", later)).as("acted on once: the new session survives").isEqualTo(200);

        String concurrentJti = "concurrent-" + uuid();
        String concurrent = token(spec -> {
            spec.subject = person;
            spec.jti = concurrentJti;
        });
        CompletableFuture<HttpResponse<String>> toA = deliverAsync(a, concurrent);
        CompletableFuture<HttpResponse<String>> toB = deliverAsync(b, concurrent);
        assertThat(toA.join().statusCode()).isEqualTo(200);
        assertThat(toB.join().statusCode()).isEqualTo(200);
        assertThat(status(a, "/api/auth/session", later)).isEqualTo(401);
        assertThat(a.jdbc().queryForObject("select count(*) from received_logout_tokens where issuer = ? and jti = ?",
                Integer.class, FAKE.issuer(), concurrentJti)).isEqualTo(1);
    }

    @Test
    @Order(5)
    @DisplayName("a logout delivered to B that overtakes a sign-in returning to A: the callback on A is refused")
    void overtakesAcrossInstances() throws Exception {
        String person = uuid();
        String sid = uuid();
        HttpResponse<String> started = get(a, "/api/auth/workeasy360/start", null);
        String flowCookie = cookieValue(started);
        FakeWorkeasy360.Authorization authorization = FAKE.parse(started.headers().firstValue("Location").orElseThrow());
        String code = FAKE.issueCode(authorization, spec -> {
            spec.subject = person;
            spec.extra.put("sid", sid);
        });
        assertThat(deliver(b, token(spec -> {
            spec.subject = person;
            spec.sid = sid;
        })).statusCode()).isEqualTo(200);

        HttpResponse<String> callback = get(a, "/api/auth/callback/workeasy360?code=" + encode(code) + "&state="
                + encode(authorization.state()), flowCookie);
        assertThat(callback.headers().firstValue("Location")).contains("/#/login?sso_error=expired");
        String left = sessionCookieOrNull(callback);
        if (left != null) {
            assertThat(status(a, "/api/auth/session", left)).isEqualTo(401);
        }
    }

    @Test
    @Order(6)
    @DisplayName("a restarted instance brings its sessions back from disk, but not one whose sign-in was ended meanwhile")
    void restartDoesNotResurrect() throws Exception {
        UUID organization = UUID.randomUUID();
        String control = signIn(a, organization, uuid(), uuid());
        String person = uuid();
        String sid = uuid();
        String ended = signIn(a, organization, person, sid);
        assertThat(status(a, "/api/auth/session", ended)).isEqualTo(200);

        assertThat(deliver(b, token(spec -> {
            spec.subject = person;
            spec.sid = sid;
        })).statusCode()).isEqualTo(200);

        a.context().close();
        assertThat(Files.exists(sessionStoreOfA.resolve("SESSIONS.ser")))
                .as("A wrote its sessions to disk on the way down, the ended one included").isTrue();
        a = start("instance-a-restarted", sessionStoreOfA);

        assertThat(status(a, "/api/auth/session", control)).as("control: sessions really came back").isEqualTo(200);
        assertThat(status(a, "/api/courses", ended)).as("the ended one does not").isEqualTo(401);
        assertThat(status(a, "/api/auth/session", ended)).isEqualTo(401);
        assertThat(deliver(a, token(spec -> spec.subject = person)).statusCode()).isEqualTo(200);
    }

    // --- helpers -------------------------------------------------------------------------------------------

    private String signIn(Instance at, UUID organization, String subject, String sid) throws Exception {
        HttpResponse<String> started = get(at, "/api/auth/workeasy360/start?organization=" + organization, null);
        assertThat(started.statusCode()).isEqualTo(302);
        String flowCookie = cookieValue(started);
        FakeWorkeasy360.Authorization authorization = FAKE.parse(started.headers().firstValue("Location").orElseThrow());
        String code = FAKE.issueCode(authorization, spec -> {
            spec.subject = subject;
            if (sid != null) {
                spec.extra.put("sid", sid);
            }
        });
        HttpResponse<String> callback = get(at, "/api/auth/callback/workeasy360?code=" + encode(code) + "&state="
                + encode(authorization.state()), flowCookie);
        assertThat(callback.statusCode()).isEqualTo(302);
        assertThat(callback.headers().firstValue("Location").orElseThrow()).doesNotContain("sso_error");
        return cookieValue(callback);
    }

    private static String token(Consumer<LogoutTokenSpec> customizer) throws Exception {
        LogoutTokenSpec spec = new LogoutTokenSpec();
        customizer.accept(spec);
        return FAKE.mintLogoutToken(spec);
    }

    private HttpResponse<String> deliver(Instance to, String logoutToken) throws Exception {
        return client.send(logoutRequest(to, logoutToken), HttpResponse.BodyHandlers.ofString());
    }

    private CompletableFuture<HttpResponse<String>> deliverAsync(Instance to, String logoutToken) {
        return client.sendAsync(logoutRequest(to, logoutToken), HttpResponse.BodyHandlers.ofString());
    }

    private static HttpRequest logoutRequest(Instance to, String logoutToken) {
        return HttpRequest.newBuilder(to.uri("/api/auth/workeasy360/backchannel-logout"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString("logout_token=" + encode(logoutToken)))
                .build();
    }

    private int status(Instance at, String path, String cookie) throws Exception {
        return get(at, path, cookie).statusCode();
    }

    private HttpResponse<String> get(Instance at, String path, String cookie) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(at.uri(path)).GET();
        if (cookie != null) {
            request.header("Cookie", cookie);
        }
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static String cookieValue(HttpResponse<String> response) {
        String cookie = sessionCookieOrNull(response);
        if (cookie == null) {
            throw new AssertionError("no " + SESSION_COOKIE + " cookie in " + response.headers().allValues("Set-Cookie"));
        }
        return cookie;
    }

    private static String sessionCookieOrNull(HttpResponse<String> response) {
        return response.headers().allValues("Set-Cookie").stream()
                .filter(value -> value.startsWith(SESSION_COOKIE + "="))
                .findFirst()
                .map(value -> {
                    Matcher matcher = Pattern.compile("^([^=]+=[^;]*)").matcher(value);
                    return matcher.find() ? matcher.group(1) : null;
                })
                .orElse(null);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private static String uuid() {
        return UUID.randomUUID().toString();
    }
}
