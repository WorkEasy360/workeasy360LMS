package com.workeasy360.backend.web;

import com.workeasy360.backend.dto.AiDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.AiService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** AI course-outline / quiz generation. Results are drafts: the client applies them through the normal Course Builder. */
@RestController
@RequestMapping("/api/ai")
public class AiController {
    private final AiService service;
    public AiController(AiService service) { this.service = service; }

    @GetMapping("/status")
    public StatusDto status() { return service.status(); }

    @PostMapping("/course/generate")
    public GenerationDto generateCourse(@AuthenticationPrincipal CurrentUser u, @RequestBody GenerateCourseRequest req) { return service.generateCourse(u, req); }

    @PostMapping("/quiz/generate")
    public GenerationDto generateQuiz(@AuthenticationPrincipal CurrentUser u, @RequestBody GenerateQuizRequest req) { return service.generateQuiz(u, req); }

    @GetMapping("/generations")
    public List<GenerationDto> mine(@AuthenticationPrincipal CurrentUser u) { return service.mine(u); }

    @GetMapping("/generations/{id}")
    public GenerationDto get(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return service.get(u, id); }

    @PostMapping("/generations/{id}/apply")
    public GenerationDto apply(@AuthenticationPrincipal CurrentUser u, @PathVariable String id, @RequestBody ApplyRequest req) { return service.markApplied(u, id, req); }
}
