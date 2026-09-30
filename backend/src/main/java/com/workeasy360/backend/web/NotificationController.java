package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Notification;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.NotificationService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** A user's own notifications (ownership enforced in the service). */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    public record NotificationDto(String id, String kind, String title, String body, String href, boolean read, Instant at) {
        static NotificationDto of(Notification n) { return new NotificationDto(n.getId(), n.getKind(), n.getTitle(), n.getBody(), n.getHref(), Boolean.TRUE.equals(n.getRead()), n.getAt()); }
    }
    private final NotificationService service;
    public NotificationController(NotificationService service) { this.service = service; }

    @GetMapping
    public List<NotificationDto> mine(@AuthenticationPrincipal CurrentUser u) { return service.mine(u.getId()).stream().map(NotificationDto::of).toList(); }
    @PostMapping("/{id}/read")
    public NotificationDto read(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return NotificationDto.of(service.markRead(u.getId(), id)); }
    @PostMapping("/read-all")
    public Map<String, Integer> readAll(@AuthenticationPrincipal CurrentUser u) { return Map.of("marked", service.markAllRead(u.getId())); }
}
