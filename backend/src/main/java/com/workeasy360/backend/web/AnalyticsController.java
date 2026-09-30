package com.workeasy360.backend.web;

import com.workeasy360.backend.dto.AnalyticsDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.AnalyticsService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.*;
import java.util.List;

/** Read-only learning analytics. Authorisation (org / own courses / self) lives in AnalyticsService. */
@RestController
@RequestMapping("/api/analytics")
public class AnalyticsController {
    private final AnalyticsService service;
    public AnalyticsController(AnalyticsService service) { this.service = service; }

    /** `from`/`to` accept a date (2026-09-01 → whole day, UTC) or an instant. */
    static Filters filters(String from, String to, String courseId, String userId, String skillId, String status) {
        return new Filters(parse(from, false), parse(to, true), blank(courseId), blank(userId), blank(skillId), blank(status));
    }
    private static String blank(String s) { return s == null || s.isBlank() ? null : s; }
    private static Instant parse(String s, boolean endOfDay) {
        if (s == null || s.isBlank()) return null;
        try { return Instant.parse(s); } catch (DateTimeException ignored) {}
        try { LocalDate d = LocalDate.parse(s); return endOfDay ? d.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().minusMillis(1) : d.atStartOfDay(ZoneOffset.UTC).toInstant(); }
        catch (DateTimeException e) { throw ApiException.badRequest("Invalid date: " + s); }
    }

    @GetMapping("/overview")
    public Overview overview(@AuthenticationPrincipal CurrentUser u, @RequestParam(required = false) String from, @RequestParam(required = false) String to, @RequestParam(required = false) String courseId, @RequestParam(required = false) String status) {
        return service.overview(u, filters(from, to, courseId, null, null, status));
    }
    @GetMapping("/courses")
    public List<CourseAnalytics> courses(@AuthenticationPrincipal CurrentUser u, @RequestParam(required = false) String from, @RequestParam(required = false) String to, @RequestParam(required = false) String status) {
        return service.courses(u, filters(from, to, null, null, null, status));
    }
    @GetMapping("/courses/{courseId}")
    public CourseAnalytics course(@AuthenticationPrincipal CurrentUser u, @PathVariable String courseId, @RequestParam(required = false) String from, @RequestParam(required = false) String to) {
        return service.course(u, courseId, filters(from, to, courseId, null, null, null));
    }
    @GetMapping("/learners")
    public List<LearnerAnalytics> learners(@AuthenticationPrincipal CurrentUser u, @RequestParam(required = false) String from, @RequestParam(required = false) String to, @RequestParam(required = false) String courseId) {
        return service.learners(u, filters(from, to, courseId, null, null, null));
    }
    @GetMapping("/learners/{userId}")
    public LearnerAnalytics learner(@AuthenticationPrincipal CurrentUser u, @PathVariable String userId, @RequestParam(required = false) String from, @RequestParam(required = false) String to, @RequestParam(required = false) String skillId) {
        return service.learner(u, userId, filters(from, to, null, userId, skillId, null));
    }
    @GetMapping("/skills")
    public List<SkillAnalytics> skills(@AuthenticationPrincipal CurrentUser u, @RequestParam(required = false) String courseId, @RequestParam(required = false) String skillId) {
        return service.skills(u, filters(null, null, courseId, null, skillId, null));
    }
    @GetMapping("/activity")
    public List<DayPoint> activity(@AuthenticationPrincipal CurrentUser u, @RequestParam(required = false) String from, @RequestParam(required = false) String to, @RequestParam(required = false) String courseId, @RequestParam(required = false) String userId) {
        return service.activity(u, filters(from, to, courseId, userId, null, null));
    }
    @GetMapping("/me")
    public MyProgress me(@AuthenticationPrincipal CurrentUser u) { return service.me(u); }
    @GetMapping("/guides")
    public List<GuideAnalytics> guides(@AuthenticationPrincipal CurrentUser u) { return service.guides(u); }
    @GetMapping("/coach")
    public AnalyticsService.CoachAnalytics coach(@AuthenticationPrincipal CurrentUser u) { return service.coach(u); }
    @GetMapping("/health")
    public List<HealthSignal> health(@AuthenticationPrincipal CurrentUser u, @RequestParam(required = false) String courseId) {
        return service.health(u, filters(null, null, courseId, null, null, null));
    }
}
