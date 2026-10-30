package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Settings;
import com.workeasy360.backend.repo.SettingsRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.PermissionService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/settings")
public class SettingsController {
    private final SettingsRepo repo;
    private final PermissionService perm;
    public SettingsController(SettingsRepo repo, PermissionService perm) { this.repo = repo; this.perm = perm; }

    public record UpdateSettingsRequest(String orgName, String supportEmail, Integer certExpiryDefault,
                                         Boolean guidesEnabled, Boolean communityEnabled, Integer maxVideoMb, Boolean instructorPublish,
                                         com.fasterxml.jackson.databind.JsonNode automation, String orgLogo) {}

    @GetMapping
    public Settings get() { return repo.findById("singleton").orElseThrow(() -> ApiException.notFound("Settings")); }

    @PutMapping
    public Settings update(@AuthenticationPrincipal CurrentUser user, @RequestBody UpdateSettingsRequest req) {
        if (!perm.isAdmin(user)) throw ApiException.forbidden("Only an admin can change settings");
        Settings s = get();
        if (req.orgName() != null) s.setOrgName(req.orgName());
        if (req.supportEmail() != null) s.setSupportEmail(req.supportEmail());
        if (req.certExpiryDefault() != null) s.setCertExpiryDefault(req.certExpiryDefault());
        if (req.guidesEnabled() != null) s.setGuidesEnabled(req.guidesEnabled());
        if (req.communityEnabled() != null) s.setCommunityEnabled(req.communityEnabled());
        if (req.maxVideoMb() != null) s.setMaxVideoMb(req.maxVideoMb());
        if (req.instructorPublish() != null) s.setInstructorPublish(req.instructorPublish());
        if (req.orgLogo() != null) { // the organisation's logo for certificates: a small raster data: image, or "" to remove it
            String logo = req.orgLogo().trim();
            if (logo.isEmpty()) s.setOrgLogo(null);
            else if (logo.length() <= 400_000 && logo.matches("^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")) s.setOrgLogo(logo);
            else throw ApiException.badRequest("The logo must be a PNG, JPEG or WebP image up to ~300 KB.");
        }
        if (req.automation() != null && req.automation().isObject()) { // only known boolean rules are stored
            com.fasterxml.jackson.databind.node.ObjectNode rules = com.workeasy360.backend.util.Json.MAPPER.createObjectNode();
            com.fasterxml.jackson.databind.JsonNode current = s.getAutomationJson() == null ? com.workeasy360.backend.util.Json.MAPPER.createObjectNode() : com.workeasy360.backend.util.Json.read(s.getAutomationJson());
            for (String rule : java.util.List.of("enrolmentNotifications", "dueReminders", "certificateExpiry", "reviewNotifications", "discussionReplies"))
                rules.put(rule, req.automation().has(rule) ? req.automation().path(rule).asBoolean(true) : current.path(rule).asBoolean(true));
            s.setAutomationJson(rules.toString());
        }
        return repo.save(s);
    }
}
