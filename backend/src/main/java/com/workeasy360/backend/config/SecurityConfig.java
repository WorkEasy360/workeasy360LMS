package com.workeasy360.backend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWK;
import com.workeasy360.backend.security.JwtAuthFilter;
import com.workeasy360.backend.security.SessionGuard;
import com.workeasy360.backend.service.AuditService;
import com.workeasy360.backend.sso.SsoResponses;
import com.workeasy360.backend.sso.Workeasy360ConfigurationCheck;
import com.workeasy360.backend.sso.Workeasy360Properties;
import com.workeasy360.backend.sso.backchannel.BackchannelLogoutController;
import com.workeasy360.backend.sso.backchannel.LogoutTokenVerifier;
import com.workeasy360.backend.sso.backchannel.SignInRecordCleanup;
import com.workeasy360.backend.sso.backchannel.SignInRecords;
import com.workeasy360.backend.sso.backchannel.SignInRevocationFilter;
import com.workeasy360.backend.sso.backchannel.SignInSessions;
import com.workeasy360.backend.sso.entitlement.EntitlementClient;
import com.workeasy360.backend.sso.entitlement.Workeasy360EntitlementFilter;
import com.workeasy360.backend.sso.entitlement.Workeasy360Entitlements;
import com.workeasy360.backend.sso.identity.OrganizationLinks;
import com.workeasy360.backend.sso.identity.Workeasy360Accounts;
import com.workeasy360.backend.sso.oidc.AuthorizationRequestResolver;
import com.workeasy360.backend.sso.oidc.IdTokenDecoderFactory;
import com.workeasy360.backend.sso.oidc.PendingFlowRepository;
import com.workeasy360.backend.sso.oidc.ProviderHttp;
import com.workeasy360.backend.sso.oidc.ProviderKeySet;
import com.workeasy360.backend.sso.oidc.Workeasy360OidcUserService;
import com.workeasy360.backend.sso.oidc.Workeasy360Provider;
import com.workeasy360.backend.sso.web.CsrfSupport;
import com.workeasy360.backend.sso.web.SameOriginWritesFilter;
import com.workeasy360.backend.sso.web.SignInEntryFilter;
import com.workeasy360.backend.sso.web.SignInHandlers;
import com.workeasy360.backend.sso.web.SignedOutMarker;
import com.workeasy360.backend.sso.web.Workeasy360SessionFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.FormHttpMessageConverter;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.endpoint.DefaultAuthorizationCodeTokenResponseClient;
import org.springframework.security.oauth2.client.endpoint.NimbusJwtClientAuthenticationParametersConverter;
import org.springframework.security.oauth2.client.endpoint.OAuth2AccessTokenResponseClient;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequest;
import org.springframework.security.oauth2.client.endpoint.OAuth2AuthorizationCodeGrantRequestEntityConverter;
import org.springframework.security.oauth2.client.http.OAuth2ErrorResponseErrorHandler;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizedClientRepository;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthorizationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.http.converter.OAuth2AccessTokenResponseHttpMessageConverter;
import org.springframework.security.oauth2.jwt.JwtDecoderFactory;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.savedrequest.NullRequestCache;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Who may reach what, and how people sign in.
 *
 * <ul>
 *   <li><strong>Password sign-in</strong> (unchanged): {@code POST /api/auth/login} returns an HS256 JWT the app
 *       sends as {@code Authorization: Bearer}; {@link JwtAuthFilter} validates it on every request. Off when
 *       {@code WORKEASY360_SSO_ONLY=true}.
 *   <li><strong>WorkEasy360 sign-in</strong> (docs/workeasy360-sso.md): Spring's OAuth2/OIDC login customised to
 *       the WorkEasy360 contract (authorization code + PKCE S256, state and nonce kept server-side and used once,
 *       {@code private_key_jwt}, strict ID-token checks). It ends in a server-side session whose only trace in the
 *       browser is an httpOnly, SameSite=Lax, Secure (outside local profiles), host-only cookie; no token is ever
 *       handed to script. Every request with such a session is checked against the shared sign-in record
 *       ({@link SignInRevocationFilter}, so a back-channel logout delivered to any instance ends it), turned into the
 *       account's current role and organization ({@link Workeasy360SessionFilter}), and checked against WorkEasy360's
 *       entitlement ({@link Workeasy360EntitlementFilter}).
 *   <li>CSRF is enforced (cookie-and-header, for the single-page app) on every write that relies on a session; a
 *       request carrying a bearer token does not use the cookie and is exempt, as it always was.
 *   <li>The back-channel logout endpoint, which WorkEasy360's server calls, has a chain of its own ahead of this
 *       one: no session, no cookie, no CSRF token.
 * </ul>
 */
@Configuration
@EnableWebSecurity
@EnableConfigurationProperties(Workeasy360Properties.class)
public class SecurityConfig {

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    @Bean
    public PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }

    @Bean
    public Clock clock() { return Clock.systemUTC(); }

    @Bean
    public static Workeasy360ConfigurationCheck workeasy360ConfigurationCheck(Workeasy360Properties properties, Environment environment) {
        return new Workeasy360ConfigurationCheck(properties, environment);
    }

    @Bean
    public ProviderHttp providerHttp(Workeasy360Properties properties, ObjectMapper objectMapper) {
        return new ProviderHttp(properties.httpTimeout(), objectMapper);
    }

    /** Also the {@code ClientRegistrationRepository}: the registration is discovered lazily. */
    @Bean
    public Workeasy360Provider workeasy360Provider(Workeasy360Properties properties, ProviderHttp http, Clock clock) {
        return new Workeasy360Provider(properties, http, clock);
    }

    @Bean
    public SsoResponses ssoResponses(ObjectMapper objectMapper) { return new SsoResponses(objectMapper); }

    /** Spring's OIDC provider finds this bean by type. */
    @Bean
    public JwtDecoderFactory<ClientRegistration> idTokenDecoderFactory(Workeasy360Properties properties, ProviderHttp http) {
        return new IdTokenDecoderFactory(properties.productCode(), http);
    }

    /** WorkEasy360's signing keys, for logout tokens. */
    @Bean
    public ProviderKeySet providerKeySet(Workeasy360Provider provider, Clock clock) { return new ProviderKeySet(provider, clock); }

    @Bean
    public LogoutTokenVerifier logoutTokenVerifier(Workeasy360Properties properties, ProviderKeySet keys, Clock clock) {
        return new LogoutTokenVerifier(properties, keys, clock);
    }

    /** This instance's sessions per WorkEasy360 sign-in; an HttpSessionListener Spring Boot registers. */
    @Bean
    public SignInSessions signInSessions(Clock clock) { return new SignInSessions(clock); }

    /** Forgets the shared record of a session that ends by itself; an HttpSessionListener Spring Boot registers. */
    @Bean
    public SignInRecordCleanup signInRecordCleanup(SignInRecords records) { return new SignInRecordCleanup(records); }

    @Bean
    public Workeasy360Entitlements workeasy360Entitlements(Workeasy360Provider provider, Clock clock,
            @Value("${server.servlet.session.timeout:8h}") Duration sessionIdleTimeout) {
        return new Workeasy360Entitlements(new EntitlementClient(provider), clock, sessionIdleTimeout);
    }

    @Bean
    public SignedOutMarker signedOutMarker(@Value("${server.servlet.session.cookie.secure:true}") boolean secureCookies) {
        return new SignedOutMarker(secureCookies);
    }

    /**
     * The back-channel logout endpoint ({@link BackchannelLogoutController}): WorkEasy360's server calls it, never a
     * browser. Its own chain, ahead of the browser chain: no session is read or created, no cookie is read or set,
     * no CSRF token, no CORS. The logout token's signature is the authentication, and the controller verifies it.
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public SecurityFilterChain backchannelLogoutFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher(BackchannelLogoutController.PATH)
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .securityContext(context -> context.securityContextRepository(new RequestAttributeSecurityContextRepository()))
            .requestCache(cache -> cache.disable())
            .csrf(csrf -> csrf.disable())
            .cors(cors -> cors.disable())
            .logout(logout -> logout.disable())
            .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll());
        return http.build();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtAuthFilter, SessionGuard sessionGuard,
                                           Workeasy360Properties properties, Workeasy360Provider provider,
                                           Workeasy360Accounts accounts, Workeasy360Entitlements entitlements,
                                           OrganizationLinks links, SsoResponses responses, Clock clock,
                                           ProviderHttp providerHttp, SignInSessions signIns, SignInRecords signInRecords,
                                           SignedOutMarker signedOut, AuditService audit,
                                           @Value("${server.servlet.session.cookie.secure:true}") boolean secureCookies,
                                           @Value("${server.servlet.session.cookie.name:JSESSIONID}") String sessionCookieName,
                                           @Value("${app.public-url:}") String publicUrl) throws Exception {
        SecurityContextRepository contexts = new HttpSessionSecurityContextRepository();

        CookieCsrfTokenRepository csrfTokens = CookieCsrfTokenRepository.withHttpOnlyFalse();
        // Over https the __Host- prefix: the browser then refuses one planted by a sibling subdomain.
        csrfTokens.setCookieName(secureCookies ? "__Host-XSRF-TOKEN" : "XSRF-TOKEN");
        csrfTokens.setCookieCustomizer(cookie -> cookie.secure(secureCookies).sameSite("Lax").path("/"));

        Set<String> appOrigins = new LinkedHashSet<>();
        for (String origin : allowedOrigins.split(",")) {
            String normalised = SameOriginWritesFilter.originOf(origin);
            if (normalised != null) appOrigins.add(normalised);
        }
        String publicOrigin = SameOriginWritesFilter.originOf(publicUrl);
        if (publicOrigin != null) appOrigins.add(publicOrigin);
        String appOrigin = SameOriginWritesFilter.originOf(properties.appUrl());
        if (appOrigin != null) appOrigins.add(appOrigin);

        http
            .securityContext(context -> context.securityContextRepository(contexts))
            .sessionManagement(session -> session
                // A new session at sign-in, nothing carried over from the one that held the pending flow (or from a
                // previous person's): this also ends the previous person's session in this browser.
                .sessionFixation(fixation -> fixation.newSession()))
            .csrf(csrf -> csrf
                .csrfTokenRepository(csrfTokens)
                .csrfTokenRequestHandler(new CsrfSupport.SpaCsrfTokenRequestHandler())
                .requireCsrfProtectionMatcher(SecurityConfig::reliesOnSessionCookie))
            // The default cache would create a session for every anonymous request to a protected path.
            .requestCache(cache -> cache.requestCache(new NullRequestCache()))
            .cors(c -> c.configurationSource(corsConfigurationSource()))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/session").authenticated()
                .requestMatchers("/api/auth/**", "/docs/**", "/v3/api-docs/**", "/swagger-ui/**", "/actuator/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/certificates/verify/**").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/sync/stream").permitAll() // authenticated by its one-time ticket
                .requestMatchers("/api/public/**").permitAll() // plan catalogue + self-serve company registration
                .anyRequest().authenticated()
            )
            // Missing/expired/invalid token or session → 401 (the frontend treats it as "session expired"); wrong role → 403.
            .exceptionHandling(e -> e
                .authenticationEntryPoint((req, res, ex) -> unauthenticated(req, res))
                .accessDeniedHandler((req, res, ex) -> {
                    if (ex instanceof CsrfException) {
                        responses.write(req, res, HttpStatus.FORBIDDEN, "csrf_invalid",
                                "The security token for this request was missing or out of date. Reload the page and try again.", null);
                    } else {
                        responses.write(req, res, HttpStatus.FORBIDDEN, "forbidden", "You don't have permission to do that", null);
                    }
                }))
            .oauth2Login(login -> login
                .clientRegistrationRepository(provider)
                .authorizedClientRepository(new DiscardingAuthorizedClientRepository())
                .loginPage(AuthorizationRequestResolver.START_PATH)
                .authorizationEndpoint(endpoint -> endpoint
                    .authorizationRequestResolver(new AuthorizationRequestResolver(provider))
                    .authorizationRequestRepository(new PendingFlowRepository(clock)))
                .redirectionEndpoint(redirect -> redirect.baseUri("/api/auth/callback/*"))
                .tokenEndpoint(token -> token.accessTokenResponseClient(tokenClient(providerHttp, provider)))
                .userInfoEndpoint(userInfo -> userInfo
                    // The ID token carries everything; the userinfo endpoint is never called.
                    .oidcUserService(new Workeasy360OidcUserService(accounts, entitlements))
                    // A non-OIDC registration cannot sign anyone in here.
                    .userService(request -> { throw new OAuth2AuthenticationException(new OAuth2Error("refused")); }))
                .successHandler(SignInHandlers.success(properties, contexts, signedOut, signIns, signInRecords, audit))
                .failureHandler(SignInHandlers.failure(properties)))
            .logout(logout -> logout
                .logoutUrl("/api/auth/logout")
                .invalidateHttpSession(true)
                .clearAuthentication(true)
                .deleteCookies(sessionCookieName)
                .addLogoutHandler(signedOut.onLogout())
                .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler(HttpStatus.NO_CONTENT)))
            .addFilterAfter(new CsrfSupport.CsrfCookieFilter(), BasicAuthenticationFilter.class)
            // Before anything reads who the request is for: a session whose sign-in a logout token ended (on any
            // instance) is ended here, and the request goes on as anonymous.
            .addFilterBefore(new SignInRevocationFilter(signInRecords, responses), CsrfFilter.class)
            .addFilterBefore(new SameOriginWritesFilter(Set.copyOf(appOrigins), responses), CsrfFilter.class)
            .addFilterBefore(new SignInEntryFilter(provider, properties), OAuth2AuthorizationRequestRedirectFilter.class)
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(new Workeasy360SessionFilter(sessionGuard), JwtAuthFilter.class)
            .addFilterAfter(new Workeasy360EntitlementFilter(entitlements, links, responses), AuthorizationFilter.class);
        return http.build();
    }

    /** A write that a browser could make with the session cookie alone: CSRF applies. */
    static boolean reliesOnSessionCookie(HttpServletRequest request) {
        String method = request.getMethod();
        if ("GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method) || "TRACE".equals(method)) {
            return false;
        }
        String authorization = request.getHeader("Authorization");
        if (authorization != null && !authorization.isBlank()) {
            return false; // a bearer request: the token, not the cookie, authenticates it
        }
        return request.getSession(false) != null;
    }

    private static void unauthenticated(HttpServletRequest req, HttpServletResponse res) throws java.io.IOException {
        Object code = req.getAttribute(JwtAuthFilter.REFUSAL_CODE);
        res.setStatus(401);
        res.setContentType("application/json");
        res.setHeader("Cache-Control", "no-store");
        res.getWriter().write("{\"status\":401,\"error\":\"Unauthorized\",\"message\":\"Sign in to continue\",\"path\":\""
                + req.getRequestURI().replace("\"", "").replace("\\", "") + "\""
                + (code instanceof String c ? ",\"code\":\"" + c + "\"" : "") + "}");
    }

    /**
     * The token request: authorization code + PKCE, authenticated with a {@code private_key_jwt} signed by this
     * product's key (issuer = subject = client id, audience = the token endpoint, a unique {@code jti}, 60 seconds).
     * Bounded by the provider client's deadline; anything unexpected becomes the sign-in error {@code unavailable}.
     */
    static OAuth2AccessTokenResponseClient<OAuth2AuthorizationCodeGrantRequest> tokenClient(ProviderHttp http, Workeasy360Provider provider) {
        RestTemplate rest = new RestTemplate(List.of(new FormHttpMessageConverter(), new OAuth2AccessTokenResponseHttpMessageConverter()));
        rest.setRequestFactory(http.asRequestFactory()); // a deadline over the whole exchange, no redirects
        rest.setErrorHandler(new OAuth2ErrorResponseErrorHandler());
        OAuth2AuthorizationCodeGrantRequestEntityConverter requests = new OAuth2AuthorizationCodeGrantRequestEntityConverter();
        requests.addParametersConverter(new NimbusJwtClientAuthenticationParametersConverter<>(
                (ClientRegistration registration) -> clientKey(provider)));
        DefaultAuthorizationCodeTokenResponseClient client = new DefaultAuthorizationCodeTokenResponseClient();
        client.setRequestEntityConverter(requests);
        client.setRestOperations(rest);
        return request -> {
            try {
                return client.getTokenResponse(request);
            } catch (OAuth2AuthorizationException exception) {
                throw exception;
            } catch (RuntimeException exception) {
                throw new OAuth2AuthorizationException(
                        new OAuth2Error(Workeasy360Provider.UNAVAILABLE, exception.getClass().getSimpleName(), null), exception);
            }
        };
    }

    private static JWK clientKey(Workeasy360Provider provider) {
        try {
            return provider.clientKey();
        } catch (RuntimeException exception) {
            // Misconfigured credential: sign-in is unavailable, and the cause (never the key) is logged.
            throw new OAuth2AuthorizationException(new OAuth2Error(Workeasy360Provider.UNAVAILABLE, "the client key cannot be used", null));
        }
    }

    /** No access token is kept: the ID token was spent at sign-in and nothing calls WorkEasy360 on a person's behalf. */
    private static final class DiscardingAuthorizedClientRepository implements OAuth2AuthorizedClientRepository {
        @Override
        public <T extends OAuth2AuthorizedClient> T loadAuthorizedClient(String clientRegistrationId, Authentication principal, HttpServletRequest request) {
            return null;
        }

        @Override
        public void saveAuthorizedClient(OAuth2AuthorizedClient authorizedClient, Authentication principal, HttpServletRequest request, HttpServletResponse response) {
            // Deliberately nothing.
        }

        @Override
        public void removeAuthorizedClient(String clientRegistrationId, Authentication principal, HttpServletRequest request, HttpServletResponse response) {
            // Nothing was kept.
        }
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of(allowedOrigins.split(",")));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setExposedHeaders(List.of("Content-Range", "Accept-Ranges", "Content-Length"));
        config.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
