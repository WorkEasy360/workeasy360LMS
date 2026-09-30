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
import java.util.List;

/** Persists quiz attempts. Scoring itself happens client-side (the question bank, including answers, is already
 *  visible to the browser as part of the lesson content — same trust model as the rest of this local-first,
 *  now-backend-persisted app); this just makes the result durable and available across devices/sessions. */
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
        if (lessons.findById(lessonId).isEmpty()) throw ApiException.notFound("Lesson");
        String courseId = courseService.courseIdOfLesson(lessonId);
        access.requireContentAccess(user, courseId);
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
}
