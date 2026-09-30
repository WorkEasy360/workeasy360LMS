package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.CoachEntities.*;
import com.workeasy360.backend.domain.Enums.LessonType;
import com.workeasy360.backend.domain.Enums.ProgressStatus;
import com.workeasy360.backend.domain.Lesson;
import com.workeasy360.backend.dto.CoachDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.LearnerContextService.*;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Lightweight time-boxed learning plans built from the learner's real remaining lessons. Lesson-backed items are
 * marked done from the existing lesson_progress rows (no second progress system); REVIEW items are ticked by the
 * learner. A plan is DRAFT → ACTIVE (start) → COMPLETED (all items done, or explicit) / DISMISSED.
 */
@Service
@Transactional
public class LearningPlanService {
    private final LearnerContextService contextService;
    private final LearningPlanRepo plans;
    private final LearningPlanItemRepo items;
    private final LessonProgressRepo progress;

    public LearningPlanService(LearnerContextService contextService, LearningPlanRepo plans, LearningPlanItemRepo items, LessonProgressRepo progress) {
        this.contextService = contextService; this.plans = plans; this.items = items; this.progress = progress;
    }

    public record ItemSpec(String kind, String courseId, String lessonId, String title, int minutes) {}

    /** Deterministic plan: the primary course's remaining lessons in order, then a short review, within the budget. */
    public List<ItemSpec> proposeItems(Context ctx, int minutes, String courseId) {
        CourseState primary = ctx.courses().stream().filter(s -> courseId == null ? !s.status().equals("completed") && s.nextLesson() != null : s.courseId().equals(courseId)).findFirst().orElse(null);
        List<ItemSpec> out = new ArrayList<>();
        if (primary == null) return out;
        int budget = minutes;
        for (Lesson l : primary.remaining()) {
            int m = l.getDurationMin() == null ? 5 : l.getDurationMin();
            if (out.isEmpty() || m <= budget) {
                String kind = l.getLessonType() == LessonType.QUIZ ? "QUIZ" : l.getLessonType() == LessonType.ASSIGNMENT ? "PRACTICE" : "LESSON";
                out.add(new ItemSpec(kind, primary.courseId(), l.getId(), l.getTitle(), Math.min(m, Math.max(1, budget))));
                budget -= m;
            }
            if (budget <= 0 || out.size() >= 6) break;
        }
        if (budget >= 3 && !out.isEmpty()) out.add(new ItemSpec("REVIEW", primary.courseId(), null, "Review your notes from " + primary.title(), Math.min(budget, 5)));
        return out;
    }

    public LearningPlanDto create(CurrentUser u, int minutes, String courseId, String source) {
        int m = Math.max(5, Math.min(240, minutes));
        Context ctx = contextService.build(u);
        List<ItemSpec> specs = proposeItems(ctx, m, courseId);
        if (specs.isEmpty()) throw ApiException.badRequest("There's nothing to plan yet — enrol in a course first");
        return createFromSpecs(u, m, specs, source, ctx);
    }

    public LearningPlanDto createFromSpecs(CurrentUser u, int minutes, List<ItemSpec> specs, String source, Context ctx) {
        String courseId = specs.get(0).courseId();
        String title = minutes + "-minute plan: " + ctx.courseTitles().getOrDefault(courseId, "your course");
        plans.findByUserIdOrderByCreatedAtDesc(u.getId()).stream().filter(p -> p.getStatus().equals("DRAFT")).forEach(p -> { p.setStatus("DISMISSED"); plans.save(p); }); // one draft at a time
        LearningPlan p = plans.save(LearningPlan.builder().userId(u.getId()).title(title).minutes(minutes).status("DRAFT").source(source).courseId(courseId).build());
        int pos = 0;
        for (ItemSpec s : specs) items.save(LearningPlanItem.builder().planId(p.getId()).position(pos++).kind(s.kind()).courseId(s.courseId()).lessonId(s.lessonId()).title(s.title()).minutes(s.minutes()).done(false).build());
        return dto(p);
    }

    public List<LearningPlanDto> mine(CurrentUser u) { return plans.findByUserIdOrderByCreatedAtDesc(u.getId()).stream().limit(10).map(this::dto).toList(); }
    public LearningPlanDto get(CurrentUser u, String id) { return dto(own(u, id)); }
    public LearningPlanDto start(CurrentUser u, String id) { LearningPlan p = own(u, id); if (!p.getStatus().equals("COMPLETED")) { p.setStatus("ACTIVE"); if (p.getStartedAt() == null) p.setStartedAt(Instant.now()); } return dto(plans.save(p)); }
    public LearningPlanDto complete(CurrentUser u, String id) { LearningPlan p = own(u, id); p.setStatus("COMPLETED"); p.setCompletedAt(Instant.now()); items.findByPlanIdOrderByPositionAsc(id).forEach(i -> { if (i.getKind().equals("REVIEW")) { i.setDone(true); items.save(i); } }); return dto(plans.save(p)); }
    public LearningPlanDto dismiss(CurrentUser u, String id) { LearningPlan p = own(u, id); p.setStatus("DISMISSED"); return dto(plans.save(p)); }
    public LearningPlanDto markItem(CurrentUser u, String id, String itemId) { own(u, id); LearningPlanItem i = items.findById(itemId).orElseThrow(() -> ApiException.notFound("Plan item")); if (!i.getPlanId().equals(id)) throw ApiException.forbidden("Not your plan item"); i.setDone(true); items.save(i); return dto(own(u, id)); }

    private LearningPlan own(CurrentUser u, String id) {
        LearningPlan p = plans.findById(id).orElseThrow(() -> ApiException.notFound("Learning plan"));
        if (!p.getUserId().equals(u.getId())) throw ApiException.forbidden("Not your learning plan");
        return p;
    }

    /** Lesson-backed items reflect lesson_progress; a plan whose items are all done auto-completes. */
    public LearningPlanDto dto(LearningPlan p) {
        List<LearningPlanItem> its = items.findByPlanIdOrderByPositionAsc(p.getId());
        Set<String> lessonIds = its.stream().map(LearningPlanItem::getLessonId).filter(Objects::nonNull).collect(Collectors.toSet());
        Set<String> done = lessonIds.isEmpty() ? Set.of() : progress.findByUserId(p.getUserId()).stream().filter(x -> x.getStatus() == ProgressStatus.COMPLETED && lessonIds.contains(x.getLessonId())).map(x -> x.getLessonId()).collect(Collectors.toSet());
        List<PlanItemDto> dtos = its.stream().map(i -> {
            boolean d = i.getLessonId() != null ? done.contains(i.getLessonId()) || Boolean.TRUE.equals(i.getDone()) : Boolean.TRUE.equals(i.getDone());
            return new PlanItemDto(i.getId(), i.getPosition(), i.getKind(), i.getCourseId(), i.getLessonId(), i.getTitle(), i.getMinutes(), d, i.getLessonId() != null ? "/learn/" + i.getCourseId() + "/" + i.getLessonId() : "/explore/" + i.getCourseId());
        }).toList();
        int doneCount = (int) dtos.stream().filter(PlanItemDto::done).count();
        if (p.getStatus().equals("ACTIVE") && !dtos.isEmpty() && doneCount == dtos.size()) { p.setStatus("COMPLETED"); p.setCompletedAt(Instant.now()); plans.save(p); }
        return new LearningPlanDto(p.getId(), p.getTitle(), p.getMinutes(), p.getStatus(), p.getSource(), p.getCourseId(), p.getCreatedAt(), p.getStartedAt(), p.getCompletedAt(), dtos, doneCount);
    }
}
