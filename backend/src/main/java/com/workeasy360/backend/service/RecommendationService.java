package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.domain.CoachEntities.*;
import com.workeasy360.backend.domain.Enums.LessonType;
import com.workeasy360.backend.dto.CoachDtos.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.LearnerContextService.*;
import com.workeasy360.backend.util.Json;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Deterministic recommendation engine. Candidates are derived from the learner context (progress, next lessons,
 * due dates, skill gaps, journeys, failed quizzes, pending assignments, certificates, catalogue) and ranked with
 * transparent signals; every recommendation carries a human-readable reason built from the learner's real numbers.
 * Learner feedback is applied deterministically: dismissed / not-relevant targets are hidden for a cool-off period,
 * "helpful" nudges a target up. No AI is involved — this keeps working with AI_ENABLED=false.
 */
@Service
@Transactional
public class RecommendationService {
    public static final int MAX_ACTIVE = 5;
    static final long COOL_OFF_DAYS = 14;

    private final LearnerContextService contextService;
    private final RecommendationRepo recs;
    private final RecommendationFeedbackRepo feedback;

    public RecommendationService(LearnerContextService contextService, RecommendationRepo recs, RecommendationFeedbackRepo feedback) {
        this.contextService = contextService; this.recs = recs; this.feedback = feedback;
    }

    private record Candidate(String type, String refKey, String courseId, String lessonId, String skillId, String pathId, String title, String reason, List<String> facts, Map<String, Integer> signals, Integer minutes, Integer progressPct, String skillName) {
        int priority() { return signals.values().stream().mapToInt(Integer::intValue).sum(); }
    }

    /** Recomputes and persists the learner's recommendations, returning the top ones (ACTIVE) in ranked order. */
    public List<RecommendationDto> refresh(CurrentUser u) {
        Context ctx = contextService.build(u);
        return refresh(u.getId(), ctx);
    }

    public List<RecommendationDto> refresh(String userId, Context ctx) {
        List<Candidate> candidates = candidates(ctx);
        Map<String, Recommendation> existing = new HashMap<>();
        recs.findByUserId(userId).forEach(r -> existing.put(r.getRefKey(), r));
        Map<String, Integer> helpful = new HashMap<>();
        Map<String, Instant> hidden = new HashMap<>();
        Instant cutoff = Instant.now().minus(COOL_OFF_DAYS, ChronoUnit.DAYS);
        for (RecommendationFeedback f : feedback.findByUserId(userId)) {
            if ("HELPFUL".equals(f.getValue())) helpful.merge(f.getRefKey(), 15, Integer::sum);
            else if (f.getAt().isAfter(cutoff)) hidden.merge(f.getRefKey(), f.getAt(), (a, b) -> a.isAfter(b) ? a : b);
        }
        Set<String> live = new HashSet<>();
        List<Recommendation> out = new ArrayList<>();
        for (Candidate c : candidates) {
            live.add(c.refKey());
            Recommendation r = existing.getOrDefault(c.refKey(), Recommendation.builder().userId(userId).refKey(c.refKey()).build());
            Map<String, Integer> signals = new LinkedHashMap<>(c.signals());
            if (helpful.containsKey(c.refKey())) signals.put("learnerFeedback", helpful.get(c.refKey()));
            r.setType(c.type()); r.setCourseId(c.courseId()); r.setLessonId(c.lessonId()); r.setSkillId(c.skillId()); r.setPathId(c.pathId());
            r.setTitle(c.title()); r.setReason(c.reason()); r.setMinutes(c.minutes());
            ArrayNode facts = Json.MAPPER.createArrayNode(); c.facts().forEach(facts::add); r.setFactsJson(facts.toString());
            ObjectNode sig = Json.MAPPER.createObjectNode(); signals.forEach(sig::put); r.setSignalsJson(sig.toString());
            r.setPriority(signals.values().stream().mapToInt(Integer::intValue).sum());
            boolean cooling = hidden.containsKey(c.refKey()) || ("DISMISSED".equals(r.getStatus()) && r.getDismissedAt() != null && r.getDismissedAt().isAfter(cutoff));
            if (!cooling) { r.setStatus("ACTIVE"); }
            if (r.getCreatedAt() == null) r.setCreatedAt(Instant.now());
            out.add(recs.save(r));
        }
        // targets that are no longer candidates (e.g. the course got completed) are closed, never re-surfaced silently
        for (Recommendation r : existing.values()) if (!live.contains(r.getRefKey()) && "ACTIVE".equals(r.getStatus())) { r.setStatus("COMPLETED"); recs.save(r); }
        return out.stream().filter(r -> "ACTIVE".equals(r.getStatus())).sorted(Comparator.comparingInt(Recommendation::getPriority).reversed().thenComparing(Recommendation::getCreatedAt)).limit(MAX_ACTIVE).map(r -> dto(r, ctx)).toList();
    }

    public List<Recommendation> activeRows(String userId) {
        return recs.findByUserId(userId).stream().filter(r -> "ACTIVE".equals(r.getStatus())).sorted(Comparator.comparingInt(Recommendation::getPriority).reversed()).limit(MAX_ACTIVE).toList();
    }

    public RecommendationDto feedback(CurrentUser u, String id, String value) {
        Recommendation r = own(u, id);
        String v = value == null ? "" : value.trim().toUpperCase();
        if (!Set.of("HELPFUL", "NOT_RELEVANT", "DISMISSED").contains(v)) throw ApiException.badRequest("Feedback must be HELPFUL, NOT_RELEVANT or DISMISSED");
        feedback.save(RecommendationFeedback.builder().userId(u.getId()).recommendationId(r.getId()).refKey(r.getRefKey()).value(v).build());
        if (v.equals("HELPFUL")) { r.setFeedback("HELPFUL"); r.setPriority(r.getPriority() + 15); }
        else { r.setFeedback(v.equals("NOT_RELEVANT") ? "NOT_RELEVANT" : r.getFeedback()); r.setStatus("DISMISSED"); r.setDismissedAt(Instant.now()); }
        return dto(recs.save(r), null);
    }

    private Recommendation own(CurrentUser u, String id) {
        Recommendation r = recs.findById(id).orElseThrow(() -> ApiException.notFound("Recommendation"));
        if (!r.getUserId().equals(u.getId())) throw ApiException.forbidden("Not your recommendation");
        return r;
    }

    // ---------------------------------------------------------------- candidates (all reasons cite real data)
    private List<Candidate> candidates(Context ctx) {
        List<Candidate> out = new ArrayList<>();
        Instant now = Instant.now();
        Set<String> coveredSkills = new HashSet<>();
        for (CourseState s : ctx.courses()) {
            if (s.status().equals("completed") || s.nextLesson() == null) continue;
            Map<String, Integer> sig = new LinkedHashMap<>();
            sig.put("activeCourse", s.done() > 0 ? 60 : 40);
            sig.put("progress", Math.round(s.pct() * 0.3f));
            List<String> facts = new ArrayList<>();
            facts.add(s.done() + " of " + s.total() + " lessons complete");
            if (s.lastActiveAt() != null) { long days = Duration.between(s.lastActiveAt(), now).toDays(); if (days <= 7) sig.put("recentActivity", 12); facts.add(days == 0 ? "Active today" : "Last active " + days + " day" + (days == 1 ? "" : "s") + " ago"); }
            if (s.dueAt() != null) { long days = Duration.between(now, s.dueAt()).toDays(); if (days < 0) { sig.put("overdue", 40); facts.add("Overdue by " + (-days) + " day" + (days == -1 ? "" : "s")); } else if (days <= 7) { sig.put("dueSoon", 25); facts.add("Due in " + days + " day" + (days == 1 ? "" : "s")); } }
            int next = s.nextLesson().getDurationMin() == null ? 5 : s.nextLesson().getDurationMin();
            String type; String title; String reason;
            LessonType lt = s.nextLesson().getLessonType();
            if (s.remaining().size() == 1) { type = "COMPLETE_LESSON"; title = "Finish " + s.title(); reason = "One lesson left — “" + s.nextLesson().getTitle() + "” (~" + next + " min) completes the course" + (ctx.certificates().stream().noneMatch(c -> c.courseId().equals(s.courseId())) ? " and earns your certificate." : "."); sig.put("nearCompletion", 20); }
            else if (lt == LessonType.QUIZ) { type = "ASSESSMENT"; title = "Take the quiz: " + s.nextLesson().getTitle(); reason = "Your next step in " + s.title() + " is the quiz “" + s.nextLesson().getTitle() + "” — you've completed " + s.done() + " of " + s.total() + " lessons, so you're ready for it."; }
            else if (lt == LessonType.ASSIGNMENT) { type = "PRACTICE"; title = "Submit: " + s.nextLesson().getTitle(); reason = "Your next step in " + s.title() + " is the assignment “" + s.nextLesson().getTitle() + "” — practising is how the skill sticks."; }
            else if (s.done() == 0) { type = "CONTINUE_COURSE"; title = "Start " + s.title(); reason = "You're enrolled but haven't started — the first lesson “" + s.nextLesson().getTitle() + "” takes about " + next + " minutes."; }
            else { type = "CONTINUE_COURSE"; title = "Continue " + s.title(); reason = "You're " + s.pct() + "% through " + s.title() + " (" + s.done() + " of " + s.total() + " lessons) and your next lesson “" + s.nextLesson().getTitle() + "” is available."; }
            facts.add("Next: " + s.nextLesson().getTitle() + " · ~" + next + " min");
            out.add(new Candidate(type, type + ":" + s.courseId(), s.courseId(), s.nextLesson().getId(), null, null, title, reason, facts, sig, next, s.pct(), null));
            ctx.skills().stream().filter(k -> k.courseIds().contains(s.courseId())).forEach(k -> coveredSkills.add(k.skillId()));
        }
        for (QuizWeakness q : ctx.quizzes()) {
            Map<String, Integer> sig = new LinkedHashMap<>(); sig.put("assessmentWeakness", 55);
            out.add(new Candidate("REVIEW", "REVIEW:" + q.lessonId(), q.courseId(), q.lessonId(), null, null, "Review and retake: " + q.lessonTitle(), "You scored " + q.score() + "% on “" + q.lessonTitle() + "” in " + q.courseTitle() + ". Review the lesson, then retake the quiz to pass it.", List.of("Last score " + q.score() + "%", "Quiz not yet passed"), sig, 10, null, null));
        }
        Map<String, AvailableCourse> availableById = new HashMap<>();
        ctx.available().forEach(a -> availableById.put(a.courseId(), a));
        Set<String> suggestedCourses = new HashSet<>();
        for (SkillState k : ctx.skills()) {
            if (k.gapPct() <= 0 || coveredSkills.contains(k.skillId())) continue;
            AvailableCourse best = ctx.available().stream().filter(a -> a.skillIds().contains(k.skillId()) && !suggestedCourses.contains(a.courseId())).findFirst().orElse(null);
            if (best == null) continue;
            suggestedCourses.add(best.courseId());
            Map<String, Integer> sig = new LinkedHashMap<>(); sig.put("skillGap", 35 + Math.round(k.gapPct() * 0.4f));
            JourneyState onPath = ctx.journeys().stream().filter(j -> j.courseIds().contains(best.courseId())).findFirst().orElse(null);
            if (onPath != null) sig.put("onJourney", 10);
            List<String> facts = new ArrayList<>(List.of(k.name() + " is " + k.levelLabel() + " (" + k.pct() + "%)", "Target: " + k.targetLabel(), best.title() + " builds " + k.name()));
            if (best.minutes() > 0) facts.add("~" + best.minutes() + " min");
            String reason = "Improve " + k.name() + " through " + best.title() + ": your proficiency is " + k.levelLabel() + " (" + k.pct() + "%) against a " + k.targetLabel() + " target" + (onPath != null ? ", and the course is part of your " + onPath.title() + " journey." : ".");
            out.add(new Candidate("SKILL_GAP", "SKILL_GAP:" + k.skillId() + ":" + best.courseId(), best.courseId(), null, k.skillId(), onPath == null ? null : onPath.id(), "Improve " + k.name() + " with " + best.title(), reason, facts, sig, best.minutes() > 0 ? best.minutes() : null, null, k.name()));
        }
        for (JourneyState j : ctx.journeys()) {
            if (j.nextCourseId() == null || ctx.courses().stream().anyMatch(s -> s.courseId().equals(j.nextCourseId())) || suggestedCourses.contains(j.nextCourseId())) continue;
            if (!availableById.containsKey(j.nextCourseId())) continue;
            suggestedCourses.add(j.nextCourseId());
            Map<String, Integer> sig = new LinkedHashMap<>(); sig.put("journeyNext", 50); sig.put("journeyProgress", Math.round(j.pct() * 0.2f));
            AvailableCourse a = availableById.get(j.nextCourseId());
            out.add(new Candidate("LEARNING_PATH", "LEARNING_PATH:" + j.id() + ":" + j.nextCourseId(), j.nextCourseId(), null, null, j.id(), "Next on " + j.title() + ": " + j.nextTitle(), j.nextTitle() + " is the next step of your " + j.title() + " journey, which is " + j.pct() + "% complete.", List.of(j.title() + " · " + j.pct() + "% complete", "Next course: " + j.nextTitle(), a.minutes() > 0 ? "~" + a.minutes() + " min" : "Published course"), sig, a.minutes() > 0 ? a.minutes() : null, j.pct(), null));
        }
        for (CertState c : ctx.certificates()) {
            if (!c.status().equals("EXPIRING") && !c.status().equals("EXPIRED")) continue;
            Map<String, Integer> sig = new LinkedHashMap<>(); sig.put("certification", c.status().equals("EXPIRED") ? 45 : 35);
            out.add(new Candidate("CERTIFICATION", "CERTIFICATION:" + c.courseId(), c.courseId(), null, null, null, (c.status().equals("EXPIRED") ? "Renew your " : "Your ") + c.courseTitle() + " certificate" + (c.status().equals("EXPIRED") ? "" : " expires soon"), "Your " + c.courseTitle() + " certificate is " + c.status().toLowerCase() + (c.expiresAt() != null ? " (" + c.expiresAt().toString().substring(0, 10) + ")" : "") + " — review the course and renew it from Certificates.", List.of("Certificate " + c.status().toLowerCase()), sig, null, null, null));
        }
        for (AvailableCourse a : ctx.available()) {
            if (suggestedCourses.contains(a.courseId())) continue;
            List<String> matched = ctx.skills().stream().filter(k -> a.skillIds().contains(k.skillId()) && k.gapPct() > 0).map(SkillState::name).toList();
            Map<String, Integer> sig = new LinkedHashMap<>(); sig.put("catalogue", 20); if (!matched.isEmpty()) sig.put("skillRelevance", 10);
            String reason = matched.isEmpty() ? a.title() + " is a published " + a.level().toLowerCase() + " course you haven't started" + (a.minutes() > 0 ? " (~" + a.minutes() + " min)." : ".") : a.title() + " builds " + String.join(" and ", matched) + ", where you still have room to grow.";
            out.add(new Candidate("NEW_COURSE", "NEW_COURSE:" + a.courseId(), a.courseId(), null, null, null, "Explore " + a.title(), reason, List.of(a.level() + " · " + a.category(), a.minutes() > 0 ? "~" + a.minutes() + " min" : "Published"), sig, a.minutes() > 0 ? a.minutes() : null, null, matched.isEmpty() ? null : matched.get(0)));
            suggestedCourses.add(a.courseId());
        }
        out.sort(Comparator.comparingInt(Candidate::priority).reversed());
        return out.size() > 12 ? out.subList(0, 12) : out;
    }

    public RecommendationDto dto(Recommendation r, Context ctx) {
        List<String> facts = new ArrayList<>();
        if (r.getFactsJson() != null) Json.read(r.getFactsJson()).forEach(f -> facts.add(f.asText()));
        String href = r.getLessonId() != null && (r.getType().equals("CONTINUE_COURSE") || r.getType().equals("COMPLETE_LESSON") || r.getType().equals("ASSESSMENT") || r.getType().equals("PRACTICE") || r.getType().equals("REVIEW")) ? "/learn/" + r.getCourseId() + "/" + r.getLessonId()
                : r.getType().equals("CERTIFICATION") ? "/certificates" : r.getCourseId() != null ? "/explore/" + r.getCourseId() : r.getSkillId() != null ? "/skills" : r.getPathId() != null ? "/journeys" : "/explore";
        Integer pct = null; String skillName = null;
        if (ctx != null) {
            pct = ctx.courses().stream().filter(s -> s.courseId().equals(r.getCourseId())).map(CourseState::pct).findFirst().orElse(null);
            skillName = r.getSkillId() == null ? null : ctx.skills().stream().filter(k -> k.skillId().equals(r.getSkillId())).map(SkillState::name).findFirst().orElse(null);
        }
        return new RecommendationDto(r.getId(), r.getType(), r.getTitle(), r.getReason(), facts, r.getMinutes(), r.getCourseId(), r.getLessonId(), r.getSkillId(), r.getPathId(), r.getStatus(), r.getFeedback(), href, pct, skillName, r.getCreatedAt());
    }
}
