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

    public AuthController(UserRepo users, PasswordEncoder encoder, JwtService jwt, com.workeasy360.backend.service.NotificationService notifications) {
        this.users = users; this.encoder = encoder; this.jwt = jwt; this.notifications = notifications;
    }

    @PostMapping("/login")
    public LoginResponse login(@Valid @RequestBody LoginRequest req) {
        User u = users.findByEmailIgnoreCase(req.email().trim()).orElseThrow(() -> new BadCredentialsException("bad credentials"));
        if (!encoder.matches(req.password(), u.getPasswordHash())) throw new BadCredentialsException("bad credentials");
        if ("INACTIVE".equalsIgnoreCase(u.getStatus())) throw new BadCredentialsException("bad credentials"); // deactivated accounts cannot sign in
        String token = jwt.issue(u.getId(), u.getRole().name());
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
        return new LoginResponse(jwt.issue(u.getId(), u.getRole().name()), UserDto.of(u));
    }

    @GetMapping("/me")
    public UserDto me(@AuthenticationPrincipal CurrentUser principal) {
        // /api/auth/** is public so login/register work without a token; this one endpoint needs a signed-in user.
        if (principal == null) throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "Sign in to continue");
        User u = users.findById(principal.getId()).orElseThrow(() -> ApiException.notFound("User"));
        return UserDto.of(u);
    }
}
