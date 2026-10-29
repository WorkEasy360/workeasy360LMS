package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.PasswordReset;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.repo.Repos.PasswordResetRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.web.ApiException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

/**
 * Password reset tokens: 32 random bytes in the link, only their SHA-256 in the database, 60 minutes to use,
 * single-use, and issuing a new token retires the previous unused ones. Used by the public "forgot password"
 * flow (token travels by e-mail) and by admins (token handed over as a link when no mail server is configured).
 */
@Service
@Transactional
public class PasswordResetService {
    public static final int EXPIRY_MINUTES = 60;
    private static final SecureRandom RNG = new SecureRandom();

    private final PasswordResetRepo resets;
    private final UserRepo users;
    private final PasswordEncoder encoder;

    public PasswordResetService(PasswordResetRepo resets, UserRepo users, PasswordEncoder encoder) {
        this.resets = resets; this.users = users; this.encoder = encoder;
    }

    /** Issues a fresh token for the user and returns the RAW token (never stored). Previous unused tokens stop working. */
    public String issue(String userId, String createdByAdminId) {
        Instant now = Instant.now();
        for (PasswordReset old : resets.findByUserIdAndUsedAtIsNull(userId)) { old.setUsedAt(now); resets.save(old); }
        byte[] raw = new byte[32];
        RNG.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        resets.save(PasswordReset.builder().id("pr-" + UUID.randomUUID().toString().replace("-", "").substring(0, 14))
                .userId(userId).tokenHash(sha256(token)).expiresAt(now.plus(EXPIRY_MINUTES, ChronoUnit.MINUTES))
                .createdBy(createdByAdminId).createdAt(now).build());
        return token;
    }

    /** Sets a new password for a valid, unexpired, unused token and returns the user. The token is spent either way. */
    public User reset(String token, String password) {
        PasswordReset pr = token == null || token.isBlank() ? null : resets.findByTokenHash(sha256(token)).orElse(null);
        if (pr == null || pr.getUsedAt() != null || pr.getExpiresAt().isBefore(Instant.now()))
            throw ApiException.badRequest("That reset link is no longer valid. Request a new one.");
        if (password == null || password.length() < 8 || password.length() > 128 || !password.matches(".*[A-Za-z].*") || !password.matches(".*\\d.*"))
            throw ApiException.badRequest("Use a password of at least 8 characters with at least one letter and one number.");
        User u = users.findById(pr.getUserId()).orElseThrow(() -> ApiException.badRequest("That reset link is no longer valid. Request a new one."));
        pr.setUsedAt(Instant.now());
        resets.save(pr);
        u.setPasswordHash(encoder.encode(password));
        return users.save(u);
    }

    private static String sha256(String s) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
