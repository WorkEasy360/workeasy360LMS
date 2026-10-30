package com.workeasy360.backend.service;

import com.workeasy360.backend.web.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Admin-initiated permanent removal of a person and everything they produced. The schema's foreign keys mostly do NOT
 * cascade (deliberately, so ordinary code can't wipe history by accident), so this service deletes the dependent rows
 * in dependency order inside one transaction. Courses are the one thing we refuse to touch: a course is organisational
 * content other people are enrolled in, so an instructor with courses must have them reassigned or deleted first.
 */
@Service
public class UserDeleteService {
    private final JdbcTemplate jdbc;
    public UserDeleteService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @Transactional
    public void delete(String requesterId, String userId) {
        if (requesterId.equals(userId)) throw ApiException.badRequest("You can't delete your own account");
        Integer exists = jdbc.queryForObject("select count(*) from users where id = ?", Integer.class, userId);
        if (exists == null || exists == 0) throw ApiException.notFound("User");
        Integer courses = jdbc.queryForObject("select count(*) from courses where instructor_id = ?", Integer.class, userId);
        if (courses != null && courses > 0)
            throw ApiException.conflict("This person still owns " + courses + " course(s). Reassign or delete their courses first.");

        // Their reviews of other people's submissions stay, just no longer attributed.
        jdbc.update("update submissions set reviewed_by = null where reviewed_by = ?", userId);

        // Community content they wrote. Comments/reactions under their posts, replies under their comments and
        // reactions on those cascade at the database level.
        jdbc.update("delete from reactions where user_id = ?", userId);
        jdbc.update("delete from comments where author_id = ?", userId);
        jdbc.update("delete from posts where author_id = ?", userId);

        // Their learning record.
        jdbc.update("delete from certificates where user_id = ?", userId);
        jdbc.update("delete from submissions where user_id = ?", userId);
        jdbc.update("delete from quiz_attempts where user_id = ?", userId);
        jdbc.update("delete from lesson_progress where user_id = ?", userId);
        jdbc.update("delete from enrollments where user_id = ?", userId);

        // Coach / AI artifacts (feedback, messages and plan items cascade from their parents).
        jdbc.update("delete from recommendation_feedback where user_id = ?", userId);
        jdbc.update("delete from recommendations where user_id = ?", userId);
        jdbc.update("delete from coach_conversations where user_id = ?", userId);
        jdbc.update("delete from learning_plans where user_id = ?", userId);
        jdbc.update("delete from ai_generations where user_id = ?", userId);

        // Misc per-user rows.
        jdbc.update("delete from notifications where user_id = ?", userId);
        jdbc.update("delete from guide_progress where user_id = ?", userId);
        jdbc.update("delete from guide_analytics where user_id = ?", userId);
        jdbc.update("delete from videos where owner_id = ?", userId);

        // group_members, user_skills, skill_assessments, orders and password_resets cascade from users.
        jdbc.update("delete from users where id = ?", userId);
    }
}
