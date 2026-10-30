package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.dto.AuthDtos.*;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.security.JwtService;
import jakarta.validation.Valid;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final UserRepo users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final com.workeasy360.backend.service.NotificationService notifications;
    private final com.workeasy360.backend.service.PasswordResetService passwordResets;
    private final com.workeasy360.backend.service.MailService mail;
    private final com.workeasy360.backend.service.EntitlementService entitlements;

    public AuthController(UserRepo users, PasswordEncoder encoder, JwtService jwt, com.workeasy360.backend.service.NotificationService notifications,
                          com.workeasy360.backend.service.PasswordResetService passwordResets, com.workeasy360.backend.service.MailService mail,
                          com.workeasy360.backend.service.EntitlementService entitlements) {
        this.users = users; this.encoder = encoder; this.jwt = jwt; this.notifications = notifications;
        this.passwordResets = passwordResets; this.mail = mail; this.entitlements = entitlements;
    }

    // Brute-force throttle: after MAX_FAILS wrong passwords for one account the account pauses for LOCK_MS.
    // Keyed by e-mail (not IP — behind the reverse proxy every client shares one address), counted for unknown
    // e-mails too so the lock never reveals whether an account exists. In-memory on purpose: a restart clearing
    // the counters is harmless, and this deployment is a single process.
    private static final int MAX_FAILS = 10;
    private static final long LOCK_MS = 15 * 60_000L;
    private final java.util.concurrent.ConcurrentHashMap<String, long[]> loginFails = new java.util.concurrent.ConcurrentHashMap<>(); // email → {fails, windowStartMillis}

    private void requireNotLocked(String email) {
        long[] f = loginFails.get(email);
        if (f != null && f[0] >= MAX_FAILS && System.currentTimeMillis() - f[1] < LOCK_MS)
            throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "Too many failed sign-in attempts. Try again in 15 minutes.");
    }

    private BadCredentialsException failed(String email) {
        if (loginFails.size() > 10_000) loginFails.entrySet().removeIf(e -> System.currentTimeMillis() - e.getValue()[1] > LOCK_MS); // bound the map
        loginFails.compute(email, (k, f) -> f == null || System.currentTimeMillis() - f[1] > LOCK_MS ? new long[]{1, System.currentTimeMillis()} : new long[]{f[0] + 1, f[1]});
        return new BadCredentialsException("bad credentials");
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest req) {
        String email = req.email().trim().toLowerCase();
        requireNotLocked(email);
        User u = users.findByEmailIgnoreCase(email).orElseThrow(() -> failed(email));
        if (!encoder.matches(req.password(), u.getPasswordHash())) throw failed(email);
        if ("INACTIVE".equalsIgnoreCase(u.getStatus())) throw new BadCredentialsException("bad credentials"); // deactivated accounts cannot sign in
        entitlements.requireSignInAllowed(u.getOrgId()); // suspended organization / lapsed subscription
        loginFails.remove(email);
        String token = jwt.issue(u.getId(), u.getRole().name(), u.getOrgId());
        try { notifications.reminders(u.getId()); } catch (RuntimeException ignored) { /* reminders never block sign-in */ }
        return new LoginResponse(token, UserDto.of(u));
    }

    /** Public self-registration. Always creates a LEARNER: the request carries no role and none is accepted. */
    public record RegisterRequest(String name, String email, String password) {}

    @PostMapping("/register")
    public LoginResponse register(@RequestBody RegisterRequest req) {
        String name = req == null || req.name() == null ? "" : req.name().trim();
        String email = req == null || req.email() == null ? "" : req.email().trim().toLowerCase();
        String password = req == null || req.password() == null ? "" : req.password();
        if (name.length() < 2 || name.length() > 120) throw ApiException.badRequest("Enter your full name.");
        if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$") || email.length() > 160) throw ApiException.badRequest("Enter a valid e-mail address.");
        if (password.length() < 8 || password.length() > 128 || !password.matches(".*[A-Za-z].*") || !password.matches(".*\\d.*"))
            throw ApiException.badRequest("Use a password of at least 8 characters with at least one letter and one number.");
        if (users.findByEmailIgnoreCase(email).isPresent()) throw ApiException.conflict("An account with that e-mail already exists. Sign in instead.");
        User u = User.builder().name(name).email(email).role(com.workeasy360.backend.domain.Enums.Role.LEARNER).passwordHash(encoder.encode(password))
                .title("Learner").dept("Self-registered").hue((int) (Math.abs(email.hashCode()) % 360)).status("ACTIVE").streak(0).build();
        try { u = users.save(u); }
        catch (org.springframework.dao.DataIntegrityViolationException e) { throw ApiException.conflict("An account with that e-mail already exists. Sign in instead."); }
        return new LoginResponse(jwt.issue(u.getId(), u.getRole().name(), u.getOrgId()), UserDto.of(u));
    }

    /** Self-service "forgot password". Always answers 200 so the endpoint never reveals whether an account exists;
     *  `sent` only says whether this server sends e-mail at all. Without SMTP the UI points at the administrator,
     *  who hands over a reset link from People (POST /api/users/{id}/reset-token). */
    public record ForgotRequest(String email) {}
    public record ForgotResponse(boolean sent) {}
    private final java.util.concurrent.ConcurrentHashMap<String, long[]> forgotRequests = new java.util.concurrent.ConcurrentHashMap<>(); // email → {count, windowStartMillis}

    @PostMapping("/forgot")
    public ForgotResponse forgot(@RequestBody ForgotRequest req) {
        String email = req == null || req.email() == null ? "" : req.email().trim().toLowerCase();
        if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,}$")) throw ApiException.badRequest("Enter the e-mail address you sign in with.");
        if (forgotRequests.size() > 10_000) forgotRequests.entrySet().removeIf(e -> System.currentTimeMillis() - e.getValue()[1] > 3_600_000L);
        long[] f = forgotRequests.compute(email, (k, v) -> v == null || System.currentTimeMillis() - v[1] > 3_600_000L ? new long[]{1, System.currentTimeMillis()} : new long[]{v[0] + 1, v[1]});
        if (f[0] > 3) throw new ApiException(org.springframework.http.HttpStatus.TOO_MANY_REQUESTS, "Too many reset requests for this address. Try again later, or ask your administrator.");
        if (!mail.enabled()) return new ForgotResponse(false);
        users.findByEmailIgnoreCase(email).filter(u -> !"INACTIVE".equalsIgnoreCase(u.getStatus())).ifPresent(u -> {
            String token = passwordResets.issue(u.getId(), null);
            String base = mail.publicUrl();
            String link = (base.isBlank() ? "" : base + "/") + "#/reset/" + token;
            mail.send(u.getEmail(), "Reset your WorkEasyLMS password",
                    "Hi " + u.getName() + ",\n\nSomeone (hopefully you) asked to reset your password.\n\n"
                    + "Set a new one here (the link works for " + com.workeasy360.backend.service.PasswordResetService.EXPIRY_MINUTES + " minutes):\n" + link
                    + "\n\nIf you didn't ask for this, you can ignore this e-mail — your password stays as it is.");
        });
        return new ForgotResponse(true); // the same answer whether or not the account exists
    }

    public record ResetRequest(String token, String password) {}

    @PostMapping("/reset")
    public LoginResponse reset(@RequestBody ResetRequest req) {
        User u = passwordResets.reset(req == null ? null : req.token(), req == null ? null : req.password());
        if ("INACTIVE".equalsIgnoreCase(u.getStatus())) throw ApiException.badRequest("That reset link is no longer valid. Request a new one.");
        entitlements.requireSignInAllowed(u.getOrgId());
        loginFails.remove(u.getEmail().toLowerCase()); // a fresh password clears any brute-force lock
        return new LoginResponse(jwt.issue(u.getId(), u.getRole().name(), u.getOrgId()), UserDto.of(u));
    }

    /** Signed-in password change: proves the current password, applies the same strength rules as registration. */
    public record ChangePasswordRequest(String currentPassword, String newPassword) {}

    @PostMapping("/password")
    public void changePassword(@AuthenticationPrincipal CurrentUser principal, @RequestBody ChangePasswordRequest req) {
        if (principal == null) throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "Sign in to continue");
        User u = users.findById(principal.getId()).orElseThrow(() -> ApiException.notFound("User"));
        if (req == null || req.currentPassword() == null || !encoder.matches(req.currentPassword(), u.getPasswordHash()))
            throw ApiException.badRequest("Your current password isn't right.");
        String p = req.newPassword() == null ? "" : req.newPassword();
        if (p.length() < 8 || p.length() > 128 || !p.matches(".*[A-Za-z].*") || !p.matches(".*\\d.*"))
            throw ApiException.badRequest("Use a password of at least 8 characters with at least one letter and one number.");
        u.setPasswordHash(encoder.encode(p));
        u.setUpdatedAt(java.time.Instant.now());
        users.save(u);
    }

    @GetMapping("/me")
    public UserDto me(@AuthenticationPrincipal CurrentUser principal) {
        // /api/auth/** is public so login/register work without a token; this one endpoint needs a signed-in user.
        if (principal == null) throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "Sign in to continue");
        User u = users.findById(principal.getId()).orElseThrow(() -> ApiException.notFound("User"));
        return UserDto.of(u);
    }
}
