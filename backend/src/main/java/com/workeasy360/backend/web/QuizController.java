package com.workeasy360.backend.web;

import com.workeasy360.backend.dto.QuizDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.QuizService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/lessons/{lessonId}/quiz-attempts")
public class QuizController {
    private final QuizService service;
    public QuizController(QuizService service) { this.service = service; }

    @PostMapping
    public AttemptDto submit(@AuthenticationPrincipal CurrentUser user, @PathVariable String lessonId, @RequestBody SubmitAttemptRequest req) {
        return AttemptDto.of(service.submit(user, lessonId, req.responses(), req.score(), Boolean.TRUE.equals(req.passed())));
    }

    @GetMapping
    public List<AttemptDto> mine(@AuthenticationPrincipal CurrentUser user, @PathVariable String lessonId) {
        return service.forLesson(user.getId(), lessonId).stream().map(AttemptDto::of).toList();
    }
}
