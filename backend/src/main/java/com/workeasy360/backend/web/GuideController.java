package com.workeasy360.backend.web;

import com.workeasy360.backend.dto.GuideDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.GuideService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/guides")
public class GuideController {
    private final GuideService service;
    public GuideController(GuideService service) { this.service = service; }

    @GetMapping("/progress")
    public List<ProgressDto> progress(@AuthenticationPrincipal CurrentUser user) {
        return service.forUser(user.getId()).stream().map(ProgressDto::of).toList();
    }

    @PutMapping("/{guideId}/progress")
    public ProgressDto update(@AuthenticationPrincipal CurrentUser user, @PathVariable String guideId, @RequestBody UpdateProgressRequest req) {
        return ProgressDto.of(service.update(user.getId(), guideId, req.status(), req.stepIndex(), req.completedSteps()));
    }

    @PostMapping("/{guideId}/analytics")
    public void analytics(@AuthenticationPrincipal CurrentUser user, @PathVariable String guideId, @RequestBody AnalyticsEventRequest req) {
        service.logEvent(user.getId(), guideId, req.event(), req.step(), req.durationMs());
    }
}
