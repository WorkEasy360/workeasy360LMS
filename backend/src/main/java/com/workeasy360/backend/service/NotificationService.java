package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.EnrollmentStatus;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.repo.SettingsRepo;
import com.workeasy360.backend.util.Json;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Backend-authoritative notifications. Events (certificate earned, assignment reviewed, discussion reply, enrolment
 * by an instructor) create rows as they happen; login-time reminders (due dates, expiring certificates) are
 * evaluated deterministically and de-duplicated so the same reminder is not repeated within its window.
 * Which of these are sent is governed by the admin's automation rules (settings.automation_json).
 */
@Service
@Transactional
public class NotificationService {
    private final NotificationRepo notifications; private final SettingsRepo settingsRepo;
    private final EnrollmentRepo enrollments; private final CertificateRepo certificates; private final CourseRepo courses;

    public NotificationService(NotificationRepo notifications, SettingsRepo settingsRepo, EnrollmentRepo enrollments, CertificateRepo certificates, CourseRepo courses) {
        this.notifications = notifications; this.settingsRepo = settingsRepo; this.enrollments = enrollments; this.certificates = certificates; this.courses = courses;
    }

    public boolean ruleEnabled(String rule) {
        Settings s = settingsRepo.findById("singleton").orElse(null);
        if (s == null || s.getAutomationJson() == null) return true;
        JsonNode n = Json.read(s.getAutomationJson());
        return !n.has(rule) || n.path(rule).asBoolean(true);
    }

    /** Creates a notification unless an equivalent one (same user, kind, title and link) was created within `dedupe`. */
    public Notification notify(String userId, String kind, String title, String body, String href, Duration dedupe) {
        Instant since = Instant.now().minus(dedupe);
        String t = cut(title, 300);
        for (Notification n : notifications.findByUserIdOrderByAtDesc(userId)) {
            if (n.getAt().isBefore(since)) break;
            if (n.getKind().equals(kind) && java.util.Objects.equals(n.getHref(), href) && java.util.Objects.equals(n.getTitle(), t)) return n;
        }
        return notifications.save(Notification.builder().userId(userId).kind(kind).title(cut(title, 300)).body(cut(body, 1000)).href(cut(href, 300)).read(false).at(Instant.now()).build());
    }
    public Notification notify(String userId, String kind, String title, String body, String href) { return notify(userId, kind, title, body, href, Duration.ofHours(24)); }

    public List<Notification> mine(String userId) { return notifications.findByUserIdOrderByAtDesc(userId).stream().limit(60).toList(); }

    public Notification markRead(String userId, String id) {
        Notification n = notifications.findById(id).orElseThrow(() -> ApiException.notFound("Notification"));
        if (!n.getUserId().equals(userId)) throw ApiException.forbidden("Not your notification");
        n.setRead(true); return notifications.save(n);
    }
    public int markAllRead(String userId) {
        int c = 0;
        for (Notification n : notifications.findByUserIdOrderByAtDesc(userId)) if (!Boolean.TRUE.equals(n.getRead())) { n.setRead(true); notifications.save(n); c++; }
        return c;
    }

    /** Login-time reminders: due / overdue courses (once a day) and expiring certificates (once a week). */
    public void reminders(String userId) {
        Instant now = Instant.now();
        if (ruleEnabled("dueReminders")) for (Enrollment e : enrollments.findByUserId(userId)) {
            if (e.getDueAt() == null || e.getStatus() == EnrollmentStatus.COMPLETED || e.getCompletedAt() != null) continue;
            Course c = courses.findById(e.getCourseId()).orElse(null); if (c == null) continue;
            long days = Duration.between(now, e.getDueAt()).toDays();
            String href = "/learn/" + c.getId();
            if (e.getDueAt().isBefore(now)) notify(userId, "due", c.getTitle() + " is overdue", "It was due on " + e.getDueAt().toString().substring(0, 10) + " — pick up where you left off.", href, Duration.ofHours(24));
            else if (days <= 3) notify(userId, "due", c.getTitle() + " is due " + (days == 0 ? "today" : "in " + days + " day" + (days == 1 ? "" : "s")), "Finish the remaining lessons to stay on track.", href, Duration.ofHours(24));
        }
        if (ruleEnabled("certificateExpiry")) for (Certificate cert : certificates.findByUserId(userId)) {
            if (Boolean.TRUE.equals(cert.getRevoked()) || cert.getExpiresAt() == null) continue;
            Course c = courses.findById(cert.getCourseId()).orElse(null); if (c == null) continue;
            if (cert.getExpiresAt().isBefore(now)) notify(userId, "expiry", "Your " + c.getTitle() + " certificate has expired", "Review the course and renew it from Certificates.", "/certificates", Duration.ofDays(7));
            else if (cert.getExpiresAt().isBefore(now.plus(Duration.ofDays(60)))) notify(userId, "expiry", "Your " + c.getTitle() + " certificate expires soon", "Expires on " + cert.getExpiresAt().toString().substring(0, 10) + ".", "/certificates", Duration.ofDays(7));
        }
    }

    private static String cut(String s, int max) { return s == null ? null : s.length() <= max ? s : s.substring(0, max - 1) + "…"; }
}
