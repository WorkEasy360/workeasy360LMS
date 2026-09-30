package com.workeasy360.backend.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Read models for /api/analytics/*. Every number is derived from persisted rows at request time (see AnalyticsService). */
public class AnalyticsDtos {
    public record Filters(Instant from, Instant to, String courseId, String userId, String skillId, String status) {}

    public record DayPoint(String date, int lessonsCompleted, int quizAttempts, int submissions, int enrollments, int activeLearners) {}
    public record Bucket(String label, int count) {}
    public record FunnelStage(String stage, int count, int pct) {}

    public record Overview(
            String scope, int coursesPublished, int coursesTotal,
            int totalLearners, int activeLearners, int enrolledLearners,
            int enrollments, int completions, int completionRate, int lessonCompletionRate, int avgProgress,
            int quizAttempts, int quizPassRate, int avgQuizScore,
            int assignmentSubmissions, int assignmentsReviewed, int assignmentReviewRate,
            int certificatesIssued, int certificatesExpiring, int certificatesExpired,
            int skillsTracked, int avgSkillProgress,
            List<DayPoint> activity, List<Bucket> completionDistribution, List<FunnelStage> funnel
    ) {}

    public record LessonStat(String lessonId, String title, String type, int position, int completed, int completionPct, int dropOffPct) {}
    public record LearnerRow(String userId, String name, String dept, int progress, String status, Instant lastActiveAt) {}

    public record CourseAnalytics(
            String courseId, String title, String status, String instructorId, Instant updatedAt,
            int enrolled, int started, int inProgress, int completed, int certified,
            int completionRate, int avgProgress,
            int quizAttempts, int quizPassRate, int avgQuizScore,
            int assignmentsSubmitted, int assignmentsReviewed, int assignmentCompletionRate,
            int activeLearners, Instant lastActivityAt,
            List<FunnelStage> funnel, List<LessonStat> lessons, List<DayPoint> activity, List<LearnerRow> learners
    ) {}

    public record LearnerCourse(String courseId, String title, int progress, String status, Instant lastActiveAt, Instant completedAt, String nextLessonId, String nextLessonTitle) {}
    public record LearnerSkill(String skillId, String name, String category, int progress, int level, String levelLabel, boolean improving) {}
    public record CertificateRow(String certificateNumber, String courseId, String courseTitle, String status, Instant issuedAt, Instant expiresAt) {}
    public record ActivityItem(Instant at, String type, String label, String courseId) {}

    public record LearnerAnalytics(
            String userId, String name, String dept, String title,
            int coursesEnrolled, int coursesCompleted, int coursesInProgress, int avgProgress, Instant lastActiveAt,
            int lessonsCompleted, int quizAttempts, int quizPassRate, int avgQuizScore,
            int assignmentsSubmitted, int assignmentsReviewed, int certificates,
            List<LearnerCourse> courses, List<LearnerSkill> skills, List<CertificateRow> certificateList, List<ActivityItem> recentActivity
    ) {}

    public record SkillAnalytics(String skillId, String name, String category, int learners, int avgProgress, int improving, int courses, Map<String, Integer> levelDistribution) {}

    public record NextAction(String label, String href, String reason) {}
    public record MyProgress(
            int streakDays, int activeDays30, int lessonsCompleted, int minutesLearned, int overallProgress,
            int coursesInProgress, int coursesCompleted, int certificates, int skillsImproving,
            List<LearnerCourse> inProgress, List<LearnerCourse> completed, List<LearnerSkill> skills,
            List<CertificateRow> certificateList, List<ActivityItem> recentActivity, List<DayPoint> activity, NextAction nextAction
    ) {}

    public record HealthSignal(String courseId, String courseTitle, String signal, String metric, String value, String detail) {}

    /** Guide adoption, aggregated from persisted guide_analytics events (opened / started / step.completed / completed / abandoned / help.requested). */
    public record GuideAnalytics(String guideId, int users, int opened, int started, int completed, int abandoned, int helpRequested, int completionRate, long avgCompletionMs, Map<Integer, Integer> stepReach, Instant lastEventAt) {}
}
