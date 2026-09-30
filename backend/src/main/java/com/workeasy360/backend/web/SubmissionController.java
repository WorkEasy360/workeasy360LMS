package com.workeasy360.backend.web;

import com.workeasy360.backend.dto.SubmissionDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.SubmissionService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
public class SubmissionController {
    private final SubmissionService service;
    public SubmissionController(SubmissionService service) { this.service = service; }

    @PostMapping("/api/lessons/{lessonId}/submissions")
    public SubmissionDto submit(@AuthenticationPrincipal CurrentUser user, @PathVariable String lessonId, @RequestBody SubmitRequest req) {
        return SubmissionDto.of(service.submit(user, lessonId, req.body()));
    }

    @GetMapping("/api/lessons/{lessonId}/submissions/me")
    public SubmissionDto mine(@AuthenticationPrincipal CurrentUser user, @PathVariable String lessonId) {
        return service.mine(user.getId(), lessonId).map(SubmissionDto::of).orElse(null);
    }

    @GetMapping("/api/courses/{courseId}/submissions")
    public List<SubmissionDto> pending(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId) {
        return service.pendingForCourse(user, courseId).stream().map(SubmissionDto::of).toList();
    }

    @PostMapping("/api/submissions/{id}/review")
    public SubmissionDto review(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody ReviewRequest req) {
        return SubmissionDto.of(service.review(user, id, req.feedback()));
    }
}
