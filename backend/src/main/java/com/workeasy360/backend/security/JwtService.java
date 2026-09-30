package com.workeasy360.backend.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Date;

/**
 * Issues and validates HS256 tokens. The signing secret comes only from the environment (JWT_SECRET); there is no
 * built-in default. Outside the zero-install `dev` profile the application refuses to start without a real secret.
 * In `dev` an ephemeral random key is generated per start when none is given (tokens end with the process).
 */
@Component
public class JwtService {
    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    static final int MIN_SECRET_BYTES = 32; // HS256 needs >= 256 bits

    private final SecretKey key;
    private final long expiryMinutes;

    public JwtService(@Value("${app.jwt.secret:}") String secret, @Value("${app.jwt.expiry-minutes}") long expiryMinutes, Environment env) {
        String s = secret == null ? "" : secret.trim();
        boolean dev = env.acceptsProfiles(Profiles.of("dev"));
        byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
        boolean placeholder = s.toLowerCase().startsWith("change-me") || s.toLowerCase().startsWith("dev-only");
        if (s.isEmpty() && dev) {
            bytes = new byte[48];
            new SecureRandom().nextBytes(bytes);
            log.warn("JWT_SECRET is not set: using a random signing key for this development run (sessions end when the server stops).");
        } else if (s.isEmpty()) {
            throw new IllegalStateException("JWT_SECRET is required. Set it to a random value of at least " + MIN_SECRET_BYTES + " characters (see backend/.env.example).");
        } else if (bytes.length < MIN_SECRET_BYTES || placeholder) {
            throw new IllegalStateException("JWT_SECRET is " + (placeholder ? "still the placeholder value" : "too short") + ". Use a random value of at least " + MIN_SECRET_BYTES + " characters.");
        }
        this.key = Keys.hmacShaKeyFor(bytes);
        this.expiryMinutes = expiryMinutes;
    }

    public String issue(String userId, String role) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId)
                .claim("role", role)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(expiryMinutes * 60)))
                .signWith(key)
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }
}
