package com.workeasy360.backend.web;

import com.workeasy360.backend.ai.AiProperties;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.PermissionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;

/** Admin-only platform status: what this deployment is actually connected to (no secrets). */
@RestController
@RequestMapping("/api/system")
public class SystemController {
    private final DataSource dataSource; private final PermissionService perm; private final AiProperties ai;
    private final UserRepo users; private final CourseRepo courses; private final VideoRepo videos; private final NotificationRepo notifications;
    @Value("${app.storage.root}") private String storageRoot;
    @Value("${app.cors.allowed-origins}") private String corsOrigins;
    @Value("${spring.profiles.active:dev}") private String profile;

    public SystemController(DataSource dataSource, PermissionService perm, AiProperties ai, UserRepo users, CourseRepo courses, VideoRepo videos, NotificationRepo notifications) {
        this.dataSource = dataSource; this.perm = perm; this.ai = ai; this.users = users; this.courses = courses; this.videos = videos; this.notifications = notifications;
    }

    @GetMapping("/status")
    public Map<String, Object> status(@AuthenticationPrincipal CurrentUser u) {
        if (!perm.isAdmin(u)) throw ApiException.forbidden("Platform status is available to administrators");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("profile", profile);
        Map<String, Object> db = new LinkedHashMap<>();
        try (Connection c = dataSource.getConnection()) {
            db.put("product", c.getMetaData().getDatabaseProductName());
            db.put("version", c.getMetaData().getDatabaseProductVersion().split("\\s")[0].split("\\(")[0]);
            db.put("url", c.getMetaData().getURL().replaceAll("(?i)(password|user)=[^;&]*", "$1=***"));
            try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery("select version, description from flyway_schema_history where success = true order by installed_rank desc")) {
                if (rs.next()) { db.put("schemaVersion", rs.getString(1)); db.put("lastMigration", rs.getString(2)); }
            }
            db.put("connected", true);
        } catch (Exception e) { db.put("connected", false); db.put("error", e.getClass().getSimpleName()); }
        out.put("database", db);
        Map<String, Object> storage = new LinkedHashMap<>();
        storage.put("kind", "local-filesystem"); storage.put("root", storageRoot); storage.put("videos", videos.count());
        out.put("storage", storage);
        Map<String, Object> aiMap = new LinkedHashMap<>();
        aiMap.put("enabled", ai.isEnabled()); aiMap.put("provider", ai.getProvider()); aiMap.put("mock", ai.usesMock()); aiMap.put("model", ai.getModel().isBlank() ? null : ai.getModel()); aiMap.put("configured", ai.usesMock() || (!ai.getApiKey().isBlank() && !ai.getModel().isBlank()));
        out.put("ai", aiMap);
        out.put("cors", corsOrigins);
        Map<String, Object> counts = new LinkedHashMap<>();
        counts.put("users", users.count()); counts.put("courses", courses.count()); counts.put("notifications", notifications.count());
        out.put("counts", counts);
        return out;
    }
}
