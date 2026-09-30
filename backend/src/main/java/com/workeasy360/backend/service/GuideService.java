package com.workeasy360.backend.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.workeasy360.backend.domain.Enums.GuideStatus;
import com.workeasy360.backend.domain.GuideAnalyticsEvent;
import com.workeasy360.backend.domain.GuideProgress;
import com.workeasy360.backend.repo.Repos.GuideAnalyticsRepo;
import com.workeasy360.backend.repo.Repos.GuideProgressRepo;
import com.workeasy360.backend.util.Json;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

// Guide *definitions* (steps, targets, copy) stay in the frontend (src/guide/guides.js) — this only persists a
// user's progress through a guide so "Guide me" resumes correctly after a refresh/login, per the Guide Engine's contract.
@Service
@Transactional
public class GuideService {
    private final GuideProgressRepo progress;
    private final GuideAnalyticsRepo analytics;

    public GuideService(GuideProgressRepo progress, GuideAnalyticsRepo analytics) { this.progress = progress; this.analytics = analytics; }

    public List<GuideProgress> forUser(String userId) { return progress.findByUserId(userId); }

    public GuideProgress update(String userId, String guideId, String status, Integer stepIndex, JsonNode completedSteps) {
        GuideProgress p = progress.findByUserIdAndGuideId(userId, guideId).orElseGet(() ->
                GuideProgress.builder().userId(userId).guideId(guideId).status(GuideStatus.IN_PROGRESS).stepIndex(0).build());
        if (status != null) { p.setStatus(GuideStatus.valueOf(status)); if (p.getStatus() == GuideStatus.COMPLETED) p.setCompletedAt(Instant.now()); }
        if (stepIndex != null) p.setStepIndex(stepIndex);
        if (completedSteps != null) p.setCompletedStepsJson(Json.write(completedSteps));
        return progress.save(p);
    }

    /** Records a guide event. A retried / double-fired identical event (same user, guide, event and step) within a
     *  few seconds is treated as the same event so adoption metrics don't count it twice. */
    public void logEvent(String userId, String guideId, String event, Integer step, Long durationMs) {
        if (event == null || event.isBlank()) return;
        Instant since = Instant.now().minusSeconds(5);
        boolean duplicate = analytics.findByUserIdAndGuideIdAndEventAndAtAfter(userId, guideId, event, since).stream()
                .anyMatch(e -> java.util.Objects.equals(e.getStep(), step));
        if (duplicate) return;
        analytics.save(GuideAnalyticsEvent.builder().userId(userId).guideId(guideId).event(event).step(step).durationMs(durationMs).build());
    }

    public List<GuideAnalyticsEvent> eventsFor(String userId) { return analytics.findByUserId(userId); }
}
