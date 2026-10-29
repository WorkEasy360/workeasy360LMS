package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Lesson;
import com.workeasy360.backend.domain.QuizAttempt;
import com.workeasy360.backend.repo.Repos.LessonRepo;
import com.workeasy360.backend.repo.Repos.QuizAttemptRepo;
import com.workeasy360.backend.util.Json;
import com.workeasy360.backend.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Persists quiz attempts. The attempt's score is computed HERE from the submitted answers against the lesson's
 *  stored quiz (the mirror of src/quiz/engine.js) — a client-reported score is never trusted, because scores feed
 *  skill levels, analytics and course completion. The question bank is still visible to the browser as lesson
 *  content (by design of this local-first app), so a determined learner can look answers up; they just can't
 *  record a result they didn't submit answers for. */
@Service
@Transactional
public class QuizService {
    private final QuizAttemptRepo attempts;
    private final LessonRepo lessons;
    private final CourseService courseService;

    private final SkillService skillService;
    private final AccessService access;
    public QuizService(QuizAttemptRepo attempts, LessonRepo lessons, CourseService courseService, SkillService skillService, AccessService access) {
        this.attempts = attempts; this.lessons = lessons; this.courseService = courseService; this.skillService = skillService; this.access = access;
    }

    public QuizAttempt submit(com.workeasy360.backend.security.CurrentUser user, String lessonId, JsonNode responses, Integer score, boolean passed) {
        String userId = user.getId();
        Lesson lesson = lessons.findById(lessonId).orElseThrow(() -> ApiException.notFound("Lesson"));
        String courseId = courseService.courseIdOfLesson(lessonId);
        access.requireContentAccess(user, courseId);

        JsonNode quiz = lesson.getQuizJson() == null || lesson.getQuizJson().isBlank() ? null : Json.read(lesson.getQuizJson());
        if (quiz != null && quiz.path("questions").isArray() && !quiz.path("questions").isEmpty()) {
            int total = 0, correct = 0;
            for (JsonNode q : quiz.path("questions")) {
                total++;
                JsonNode a = responses == null ? com.fasterxml.jackson.databind.node.MissingNode.getInstance() : responses.path(q.path("id").asText());
                if (isCorrect(q, a)) correct++;
            }
            score = Math.round(100f * correct / total);
            passed = score >= quiz.path("passScore").asInt(70);
        } else { // lesson without a stored quiz (offline-demo content): keep the claim, but inside sane bounds
            score = score == null ? null : Math.max(0, Math.min(100, score));
        }

        List<QuizAttempt> mine = attempts.findByUserIdAndLessonIdOrderBySubmittedAtDesc(userId, lessonId);
        QuizAttempt a = QuizAttempt.builder().userId(userId).lessonId(lessonId).courseId(courseId)
                .responsesJson(Json.write(responses)).score(score).passed(passed)
                .attemptNumber(mine.size() + 1).startedAt(Instant.now()).submittedAt(Instant.now()).build();
        QuizAttempt saved = attempts.save(a);
        skillService.recordAssessment(userId, lessonId, "QUIZ", score, passed); // assessed evidence → skill progress
        return saved;
    }

    public List<QuizAttempt> forLesson(String userId, String lessonId) {
        return attempts.findByUserIdAndLessonIdOrderBySubmittedAtDesc(userId, lessonId);
    }

    /** One question against one submitted answer — the exact rules of src/quiz/engine.js. */
    private boolean isCorrect(JsonNode q, JsonNode a) {
        JsonNode answer = q.path("answer");
        switch (q.path("type").asText("mc")) {
            case "multi": {
                if (!a.isArray() || !answer.isArray() || a.size() != answer.size()) return false;
                Set<String> chosen = new HashSet<>();
                a.forEach(x -> chosen.add(x.asText()));
                for (JsonNode want : answer) if (!chosen.contains(want.asText())) return false;
                return true;
            }
            case "tf":
                return a.isBoolean() && answer.isBoolean() && a.asBoolean() == answer.asBoolean();
            case "short": {
                if (!a.isTextual() || a.asText().trim().isEmpty()) return false;
                if (!answer.isArray() || answer.isEmpty()) return true; // no keywords: any thoughtful answer counts
                String given = a.asText().toLowerCase();
                for (JsonNode k : answer) if (given.contains(k.asText().toLowerCase().trim())) return true;
                return false;
            }
            default: // mc
                return a.isTextual() && a.asText().equals(answer.asText(null));
        }
    }
}
