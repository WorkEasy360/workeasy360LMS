package com.workeasy360.backend.web;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.dto.CoachDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.CoachService;
import com.workeasy360.backend.service.LearningPlanService;
import com.workeasy360.backend.service.RecommendationService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Learner-private Coach, recommendations and learning plans. Every record is scoped to the authenticated user. */
@RestController
public class CoachController {
    private final CoachService coach; private final RecommendationService recommendations; private final LearningPlanService plans;
    public CoachController(CoachService coach, RecommendationService recommendations, LearningPlanService plans) { this.coach = coach; this.recommendations = recommendations; this.plans = plans; }

    @GetMapping("/api/coach/context")
    public ObjectNode context(@AuthenticationPrincipal CurrentUser u, @RequestParam(required = false) String lessonId) { return coach.context(u, lessonId); }
    @PostMapping("/api/coach/message")
    public CoachReply message(@AuthenticationPrincipal CurrentUser u, @RequestBody SendMessageRequest req) { return coach.message(u, req); }
    @GetMapping("/api/coach/conversations")
    public List<ConversationDto> conversations(@AuthenticationPrincipal CurrentUser u) { return coach.conversations(u); }
    @GetMapping("/api/coach/conversations/{id}")
    public ConversationDto conversation(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return coach.conversation(u, id); }

    @GetMapping("/api/recommendations")
    public List<RecommendationDto> recommendations(@AuthenticationPrincipal CurrentUser u) { return recommendations.refresh(u); }
    @PostMapping("/api/recommendations/{id}/feedback")
    public RecommendationDto feedback(@AuthenticationPrincipal CurrentUser u, @PathVariable String id, @RequestBody FeedbackRequest req) { return recommendations.feedback(u, id, req.value()); }
    @PostMapping("/api/recommendations/{id}/dismiss")
    public RecommendationDto dismiss(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return recommendations.feedback(u, id, "DISMISSED"); }

    @GetMapping("/api/learning-plans")
    public List<LearningPlanDto> plans(@AuthenticationPrincipal CurrentUser u) { return plans.mine(u); }
    @PostMapping("/api/learning-plans")
    public LearningPlanDto create(@AuthenticationPrincipal CurrentUser u, @RequestBody CreatePlanRequest req) { return plans.create(u, req.minutes() == null ? 20 : req.minutes(), req.courseId(), "MANUAL"); }
    @GetMapping("/api/learning-plans/{id}")
    public LearningPlanDto plan(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return plans.get(u, id); }
    @PostMapping("/api/learning-plans/{id}/start")
    public LearningPlanDto start(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return plans.start(u, id); }
    @PostMapping("/api/learning-plans/{id}/complete")
    public LearningPlanDto complete(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return plans.complete(u, id); }
    @PostMapping("/api/learning-plans/{id}/dismiss")
    public LearningPlanDto dismissPlan(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return plans.dismiss(u, id); }
    @PostMapping("/api/learning-plans/{id}/items/{itemId}/done")
    public LearningPlanDto itemDone(@AuthenticationPrincipal CurrentUser u, @PathVariable String id, @PathVariable String itemId) { return plans.markItem(u, id, itemId); }
}
