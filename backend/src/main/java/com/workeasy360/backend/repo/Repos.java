package com.workeasy360.backend.repo;

import com.workeasy360.backend.domain.*;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

// Grouped in one file to keep the repository layer easy to scan; each is a plain Spring Data JPA interface.
public class Repos {

    public interface UserRepo extends JpaRepository<User, String> {
        Optional<User> findByEmailIgnoreCase(String email);
        List<User> findByRole(Enums.Role role);
    }

    public interface CourseRepo extends JpaRepository<Course, String> {
        List<Course> findByInstructorId(String instructorId);
        List<Course> findByStatus(Enums.CourseStatus status);
    }

    public interface ModuleRepo extends JpaRepository<CourseModule, String> {
        List<CourseModule> findByCourseIdOrderByPositionAsc(String courseId);
        List<CourseModule> findByCourseIdIn(java.util.Collection<String> courseIds);
        long countByCourseId(String courseId);
        void deleteByCourseId(String courseId);
    }

    public interface LessonRepo extends JpaRepository<Lesson, String> {
        List<Lesson> findByModuleIdOrderByPositionAsc(String moduleId);
        List<Lesson> findByModuleIdIn(java.util.Collection<String> moduleIds);
        void deleteByModuleId(String moduleId);
    }

    public interface VideoRepo extends JpaRepository<Video, String> {
        List<Video> findByOwnerId(String ownerId);
    }

    public interface EnrollmentRepo extends JpaRepository<Enrollment, String> {
        Optional<Enrollment> findByUserIdAndCourseId(String userId, String courseId);
        List<Enrollment> findByUserId(String userId);
        List<Enrollment> findByCourseId(String courseId);
        // analytics: one query per scope instead of one per course
        List<Enrollment> findByCourseIdIn(java.util.Collection<String> courseIds);
        @org.springframework.data.jpa.repository.Query("select count(distinct e.userId) from Enrollment e where e.courseId in :ids and e.lastActiveAt >= :since")
        long countActiveLearners(@org.springframework.data.repository.query.Param("ids") java.util.Collection<String> ids, @org.springframework.data.repository.query.Param("since") java.time.Instant since);
        @org.springframework.data.jpa.repository.Query("select e.courseId, count(e), sum(case when e.completedAt is not null then 1 else 0 end) from Enrollment e where e.courseId in :ids group by e.courseId")
        List<Object[]> countByCourse(@org.springframework.data.repository.query.Param("ids") java.util.Collection<String> ids);
    }

    public interface LessonProgressRepo extends JpaRepository<LessonProgress, String> {
        Optional<LessonProgress> findByUserIdAndLessonId(String userId, String lessonId);
        List<LessonProgress> findByUserIdAndCourseId(String userId, String courseId);
        List<LessonProgress> findByCourseIdIn(java.util.Collection<String> courseIds);
        List<LessonProgress> findByUserId(String userId);
    }

    public interface QuizAttemptRepo extends JpaRepository<QuizAttempt, String> {
        List<QuizAttempt> findByUserIdAndLessonIdOrderBySubmittedAtDesc(String userId, String lessonId);
        List<QuizAttempt> findByCourseIdIn(java.util.Collection<String> courseIds);
        List<QuizAttempt> findByUserId(String userId);
    }

    public interface SubmissionRepo extends JpaRepository<Submission, String> {
        Optional<Submission> findByUserIdAndLessonId(String userId, String lessonId);
        List<Submission> findByCourseIdAndStatus(String courseId, Enums.SubmissionStatus status);
        List<Submission> findByCourseIdIn(java.util.Collection<String> courseIds);
        List<Submission> findByUserId(String userId);
    }

    public interface CertificateRepo extends JpaRepository<Certificate, String> {
        List<Certificate> findByUserId(String userId);
        Optional<Certificate> findByCertificateNumberIgnoreCase(String number);
        Optional<Certificate> findByUserIdAndCourseId(String userId, String courseId);
        List<Certificate> findByCourseIdIn(java.util.Collection<String> courseIds);
    }

    public interface GroupRepo extends JpaRepository<Group, String> {}
    public interface GroupMemberRepo extends JpaRepository<GroupMember, GroupMember.Key> {
        List<GroupMember> findByGroupId(String groupId);
    }

    public interface PostRepo extends JpaRepository<Post, String> {
        List<Post> findByGroupId(String groupId);
        List<Post> findByCourseId(String courseId);
        List<Post> findByCourseIdAndLessonId(String courseId, String lessonId);
    }
    public interface CommentRepo extends JpaRepository<Comment, String> {
        List<Comment> findByPostId(String postId);
    }
    public interface ReactionRepo extends JpaRepository<Reaction, String> {
        List<Reaction> findByPostId(String postId);
        List<Reaction> findByCommentId(String commentId);
        Optional<Reaction> findByPostIdAndUserIdAndType(String postId, String userId, Enums.ReactionType type);
        Optional<Reaction> findByCommentIdAndUserIdAndType(String commentId, String userId, Enums.ReactionType type);
    }

    public interface GuideProgressRepo extends JpaRepository<GuideProgress, String> {
        List<GuideProgress> findByUserId(String userId);
        Optional<GuideProgress> findByUserIdAndGuideId(String userId, String guideId);
    }
    public interface GuideAnalyticsRepo extends JpaRepository<GuideAnalyticsEvent, String> {
        List<GuideAnalyticsEvent> findByGuideId(String guideId);
        List<GuideAnalyticsEvent> findByUserIdAndGuideIdAndEventAndAtAfter(String userId, String guideId, String event, java.time.Instant after);
        List<GuideAnalyticsEvent> findByUserId(String userId);
    }

    public interface RecommendationRepo extends JpaRepository<CoachEntities.Recommendation, String> {
        List<CoachEntities.Recommendation> findByUserId(String userId);
        Optional<CoachEntities.Recommendation> findByUserIdAndRefKey(String userId, String refKey);
    }
    public interface RecommendationFeedbackRepo extends JpaRepository<CoachEntities.RecommendationFeedback, String> {
        List<CoachEntities.RecommendationFeedback> findByUserId(String userId);
    }
    public interface CoachConversationRepo extends JpaRepository<CoachEntities.CoachConversation, String> {
        List<CoachEntities.CoachConversation> findByUserIdOrderByUpdatedAtDesc(String userId);
    }
    public interface CoachMessageRepo extends JpaRepository<CoachEntities.CoachMessage, String> {
        List<CoachEntities.CoachMessage> findByConversationIdOrderByAtAsc(String conversationId);
    }
    public interface LearningPlanRepo extends JpaRepository<CoachEntities.LearningPlan, String> {
        List<CoachEntities.LearningPlan> findByUserIdOrderByCreatedAtDesc(String userId);
    }
    public interface LearningPlanItemRepo extends JpaRepository<CoachEntities.LearningPlanItem, String> {
        List<CoachEntities.LearningPlanItem> findByPlanIdOrderByPositionAsc(String planId);
        List<CoachEntities.LearningPlanItem> findByPlanIdIn(java.util.Collection<String> planIds);
    }

    public interface AiGenerationRepo extends JpaRepository<AiGeneration, String> {
        List<AiGeneration> findByUserIdOrderByCreatedAtDesc(String userId);
        List<AiGeneration> findByUserIdAndInputHashAndStatusOrderByCreatedAtDesc(String userId, String inputHash, AiGeneration.Status status);
    }

    public interface OrderRepo extends JpaRepository<CommerceEntities.PurchaseOrder, String> {
        List<CommerceEntities.PurchaseOrder> findByUserIdOrderByCreatedAtDesc(String userId);
        List<CommerceEntities.PurchaseOrder> findByUserIdAndCourseIdAndStatus(String userId, String courseId, CommerceEntities.OrderStatus status);
        List<CommerceEntities.PurchaseOrder> findAllByOrderByCreatedAtDesc();
    }
    public interface PaymentRepo extends JpaRepository<CommerceEntities.Payment, String> {
        List<CommerceEntities.Payment> findByOrderIdOrderByCreatedAtDesc(String orderId);
    }

    public interface NotificationRepo extends JpaRepository<Notification, String> {
        List<Notification> findByUserIdOrderByAtDesc(String userId);
    }

    public interface PasswordResetRepo extends JpaRepository<PasswordReset, String> {
        java.util.Optional<PasswordReset> findByTokenHash(String tokenHash);
        List<PasswordReset> findByUserIdAndUsedAtIsNull(String userId);
    }

    // ---- skills engine ----
    public interface SkillCategoryRepo extends JpaRepository<SkillEntities.SkillCategory, String> {}
    public interface SkillRepo extends JpaRepository<SkillEntities.Skill, String> {}
    public interface CourseSkillRepo extends JpaRepository<SkillEntities.CourseSkill, String> {
        List<SkillEntities.CourseSkill> findByCourseId(String courseId);
        List<SkillEntities.CourseSkill> findBySkillId(String skillId);
        List<SkillEntities.CourseSkill> findByCourseIdIn(java.util.Collection<String> courseIds);
        void deleteByCourseId(String courseId);
    }
    public interface LessonSkillRepo extends JpaRepository<SkillEntities.LessonSkill, String> {
        List<SkillEntities.LessonSkill> findByLessonId(String lessonId);
        List<SkillEntities.LessonSkill> findByLessonIdIn(java.util.Collection<String> lessonIds);
        void deleteByLessonId(String lessonId);
    }
    public interface UserSkillRepo extends JpaRepository<SkillEntities.UserSkill, String> {
        List<SkillEntities.UserSkill> findByUserId(String userId);
        Optional<SkillEntities.UserSkill> findByUserIdAndSkillId(String userId, String skillId);
        List<SkillEntities.UserSkill> findByUserIdIn(java.util.Collection<String> userIds);
    }
    public interface SkillAssessmentRepo extends JpaRepository<SkillEntities.SkillAssessment, String> {
        List<SkillEntities.SkillAssessment> findByUserId(String userId);
        Optional<SkillEntities.SkillAssessment> findFirstByUserIdAndSkillIdAndLessonIdAndKind(String userId, String skillId, String lessonId, String kind);
    }
    public interface LearningPathRepo extends JpaRepository<SkillEntities.LearningPath, String> {}
    public interface LearningPathNodeRepo extends JpaRepository<SkillEntities.LearningPathNode, String> {
        List<SkillEntities.LearningPathNode> findByPathIdOrderByPositionAsc(String pathId);
    }
}
