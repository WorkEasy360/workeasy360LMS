package com.workeasy360.backend.web;

import com.workeasy360.backend.dto.LearningDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.ProgressService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
public class ProgressController {
    private final ProgressService service;
    public ProgressController(ProgressService service) { this.service = service; }

    @PostMapping("/api/lessons/{lessonId}/progress")
    public CompletionResult update(@AuthenticationPrincipal CurrentUser user, @PathVariable String lessonId, @RequestBody ProgressUpdateRequest req) {
        // Two saves for the same lesson can race (a periodic save and the page-unload save): the loser hits the
        // (user, lesson) unique key. Retrying once re-reads the row the winner created; nothing is lost.
        try { return service.update(user, lessonId, req); }
        catch (org.springframework.dao.DataIntegrityViolationException e) { return service.update(user, lessonId, req); }
    }

    @GetMapping("/api/courses/{courseId}/progress/detail")
    public List<LessonProgressDto> detail(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId) {
        return service.forCourse(user.getId(), courseId);
    }
}
