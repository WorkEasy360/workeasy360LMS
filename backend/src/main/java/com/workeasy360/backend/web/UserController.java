package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.dto.AuthDtos.UserDto;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.PermissionService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * People directory + admin user management. E-mail addresses are only disclosed to admins and to the user themself;
 * everyone else sees name, role, title and team (what a directory needs).
 */
@RestController
@RequestMapping("/api/users")
public class UserController {
    public record CreateUserRequest(String name, String email, String role, String title, String dept, String password) {}
    public record UpdateUserRequest(String name, String role, String title, String dept, String status) {}
    public record CreatedUser(UserDto user, String temporaryPassword) {}

    private final UserRepo users; private final PermissionService perm; private final PasswordEncoder encoder;
    private final com.workeasy360.backend.service.PasswordResetService passwordResets;
    private final com.workeasy360.backend.service.MailService mail;
    private final com.workeasy360.backend.service.UserDeleteService deleter;
    public UserController(UserRepo users, PermissionService perm, PasswordEncoder encoder,
                          com.workeasy360.backend.service.PasswordResetService passwordResets, com.workeasy360.backend.service.MailService mail,
                          com.workeasy360.backend.service.UserDeleteService deleter) {
        this.users = users; this.perm = perm; this.encoder = encoder; this.passwordResets = passwordResets; this.mail = mail; this.deleter = deleter;
    }

    private UserDto view(CurrentUser me, User u) {
        UserDto d = UserDto.of(u);
        boolean full = perm.isAdmin(me) || me.getId().equals(u.getId());
        return full ? d : new UserDto(d.id(), d.name(), null, d.role(), d.title(), d.dept(), d.hue(), d.streak(), d.status());
    }

    @GetMapping
    public List<UserDto> list(@AuthenticationPrincipal CurrentUser me, @RequestParam(required = false) String role) {
        List<User> all = role == null ? users.findAll() : users.findByRole(Role.valueOf(role.toUpperCase()));
        return all.stream().map(u -> view(me, u)).toList();
    }

    @GetMapping("/{id}")
    public UserDto get(@AuthenticationPrincipal CurrentUser me, @PathVariable String id) {
        return view(me, users.findById(id).orElseThrow(() -> ApiException.notFound("User")));
    }

    @PostMapping
    public CreatedUser create(@AuthenticationPrincipal CurrentUser me, @RequestBody CreateUserRequest req) {
        if (!perm.isAdmin(me)) throw ApiException.forbidden("Only an admin can add people");
        String name = req.name() == null ? "" : req.name().trim(), email = req.email() == null ? "" : req.email().trim().toLowerCase();
        if (name.length() < 2 || name.length() > 120) throw ApiException.badRequest("Enter the person's name");
        if (!email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) throw ApiException.badRequest("Enter a valid e-mail address");
        if (users.findByEmailIgnoreCase(email).isPresent()) throw ApiException.conflict("Someone with that e-mail already exists");
        Role role = parseRole(req.role());
        String password = req.password() != null && req.password().length() >= 8 ? req.password() : temporaryPassword();
        User u = User.builder().name(name).email(email).role(role).passwordHash(encoder.encode(password))
                .title(cut(req.title(), 160, "Team member")).dept(cut(req.dept(), 120, "Unassigned")).hue((int) (Math.abs(email.hashCode()) % 360)).status("ACTIVE").streak(0)
                .createdAt(Instant.now()).updatedAt(Instant.now()).build();
        users.save(u);
        return new CreatedUser(UserDto.of(u), req.password() != null && req.password().length() >= 8 ? null : password); // shown once, never stored in clear
    }

    @PutMapping("/{id}")
    public UserDto update(@AuthenticationPrincipal CurrentUser me, @PathVariable String id, @RequestBody UpdateUserRequest req) {
        if (!perm.isAdmin(me)) throw ApiException.forbidden("Only an admin can change people");
        User u = users.findById(id).orElseThrow(() -> ApiException.notFound("User"));
        if (req.role() != null) {
            Role r = parseRole(req.role());
            if (u.getId().equals(me.getId()) && r != Role.ADMIN) throw ApiException.badRequest("You can't remove your own admin role");
            u.setRole(r);
        }
        if (req.name() != null && req.name().trim().length() >= 2) u.setName(req.name().trim());
        if (req.title() != null) u.setTitle(cut(req.title(), 160, u.getTitle()));
        if (req.dept() != null) u.setDept(cut(req.dept(), 120, u.getDept()));
        if (req.status() != null && List.of("ACTIVE", "INACTIVE").contains(req.status().toUpperCase())) u.setStatus(req.status().toUpperCase());
        u.setUpdatedAt(Instant.now());
        return UserDto.of(users.save(u));
    }

    /** Permanently removes a person and their personal data (progress, certificates, posts, coach history). Refused
     *  for yourself and for instructors who still own courses — those must be reassigned or deleted first. */
    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@AuthenticationPrincipal CurrentUser me, @PathVariable String id) {
        if (!perm.isAdmin(me)) throw ApiException.forbidden("Only an admin can delete people");
        deleter.delete(me.getId(), id);
        return Map.of("ok", true);
    }

    /** Admin-issued password reset: returns the reset path once, for the admin to hand over (and e-mails it to the
     *  person when this server sends e-mail). The link behaves exactly like a self-service one: 60 minutes, single use. */
    public record ResetToken(String resetPath, int expiresMinutes, boolean emailed) {}

    @PostMapping("/{id}/reset-token")
    public ResetToken resetToken(@AuthenticationPrincipal CurrentUser me, @PathVariable String id) {
        if (!perm.isAdmin(me)) throw ApiException.forbidden("Only an admin can issue a password reset");
        User u = users.findById(id).orElseThrow(() -> ApiException.notFound("User"));
        String token = passwordResets.issue(u.getId(), me.getId());
        String path = "#/reset/" + token;
        boolean emailed = mail.enabled();
        if (emailed) {
            String base = mail.publicUrl();
            mail.send(u.getEmail(), "Reset your WorkEasyLMS password",
                    "Hi " + u.getName() + ",\n\nYour administrator issued a password reset for your account.\n\n"
                    + "Set a new password here (the link works for " + com.workeasy360.backend.service.PasswordResetService.EXPIRY_MINUTES + " minutes):\n"
                    + (base.isBlank() ? "" : base + "/") + path
                    + "\n\nIf you didn't expect this, contact your administrator.");
        }
        return new ResetToken(path, com.workeasy360.backend.service.PasswordResetService.EXPIRY_MINUTES, emailed);
    }

    private static Role parseRole(String r) { try { return Role.valueOf((r == null ? "LEARNER" : r).trim().toUpperCase()); } catch (IllegalArgumentException e) { throw ApiException.badRequest("Role must be learner, instructor or admin"); } }
    private static String cut(String s, int max, String dflt) { if (s == null || s.isBlank()) return dflt; String t = s.trim(); return t.length() > max ? t.substring(0, max) : t; }
    private static String temporaryPassword() { SecureRandom r = new SecureRandom(); String alpha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"; StringBuilder sb = new StringBuilder(); for (int i = 0; i < 12; i++) sb.append(alpha.charAt(r.nextInt(alpha.length()))); return sb.toString(); }
}
