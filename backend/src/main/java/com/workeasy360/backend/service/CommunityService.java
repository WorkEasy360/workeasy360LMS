package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.*;
import com.workeasy360.backend.domain.Enums.*;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;

@Service
@Transactional
public class CommunityService {
    private final PostRepo posts;
    private final CommentRepo comments;
    private final ReactionRepo reactions;
    private final GroupRepo groups;
    private final GroupMemberRepo groupMembers;
    private final NotificationService notifications;
    private final UserRepo users;
    private final CourseRepo courses;
    private final LessonRepo lessons;

    public CommunityService(PostRepo posts, CommentRepo comments, ReactionRepo reactions, GroupRepo groups, GroupMemberRepo groupMembers, NotificationService notifications, UserRepo users, CourseRepo courses, LessonRepo lessons) {
        this.posts = posts; this.comments = comments; this.reactions = reactions; this.groups = groups; this.groupMembers = groupMembers; this.notifications = notifications; this.users = users; this.courses = courses; this.lessons = lessons;
    }

    public List<Post> list(String orgId, String groupId, String courseId, String lessonId, String kind) {
        List<Post> all = posts.findByOrgId(orgId);
        return all.stream()
                .filter(p -> groupId == null || groupId.equals(p.getGroupId()))
                .filter(p -> courseId == null || courseId.equals(p.getCourseId()))
                .filter(p -> lessonId == null || lessonId.equals(p.getLessonId()))
                .filter(p -> kind == null || kind.equalsIgnoreCase(p.getKind().name()))
                .sorted(Comparator.comparing(Post::getPinned).reversed().thenComparing(Comparator.comparing(Post::getCreatedAt).reversed()))
                .toList();
    }

    public Post getPost(String orgId, String id) {
        Post p = posts.findById(id).orElseThrow(() -> ApiException.notFound("Post"));
        if (p.getOrgId() != null && !p.getOrgId().equals(orgId)) throw ApiException.notFound("Post"); // tenant boundary
        return p;
    }
    public List<Comment> commentsOf(String postId) { return comments.findByPostId(postId); }
    public List<Reaction> reactionsOf(String postId) {
        List<Reaction> onPost = reactions.findByPostId(postId);
        List<Reaction> onComments = commentsOf(postId).stream().flatMap(c -> reactions.findByCommentId(c.getId()).stream()).toList();
        return java.util.stream.Stream.concat(onPost.stream(), onComments.stream()).toList();
    }

    public Post createPost(String orgId, String id, String authorId, String kind, String title, String body, String groupId, String courseId, String lessonId) {
        // The client proposes the id (local-first sync re-pushes the same post after a reload). JPA save() would
        // silently turn a colliding id into an UPDATE of someone else's post, so collisions are resolved here:
        // same author → the already-stored post (idempotent re-push); someone else's id → refused.
        if (id != null && !id.isBlank()) {
            var existing = posts.findById(id);
            if (existing.isPresent()) {
                if (!existing.get().getAuthorId().equals(authorId) || !orgId.equals(existing.get().getOrgId())) throw ApiException.forbidden("That discussion already exists");
                return existing.get();
            }
        } else id = "p-" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        if ((title == null || title.isBlank()) && (body == null || body.isBlank())) throw ApiException.badRequest("Write something first");
        if (title != null && title.length() > 300) throw ApiException.badRequest("Keep the title under 300 characters.");
        if (body != null && body.length() > 20_000) throw ApiException.badRequest("Keep the post under 20,000 characters.");
        // A post may reference a course/lesson/group that only exists in the browser's offline demo data; keep the post
        // and drop the dangling reference instead of failing on the foreign key.
        if (groupId != null && !groups.existsById(groupId)) groupId = null;
        if (courseId != null && !courses.existsById(courseId)) courseId = null;
        if (lessonId != null && !lessons.existsById(lessonId)) lessonId = null;
        Post p = Post.builder().id(id).authorId(authorId).orgId(orgId).kind(parseKind(kind)).title(title == null ? "" : title)
                .body(body == null ? "" : body).groupId(groupId).courseId(courseId).lessonId(lessonId).build();
        return posts.save(p);
    }
    private PostKind parseKind(String k) { try { return PostKind.valueOf(k.toUpperCase()); } catch (Exception e) { return PostKind.DISCUSSION; } }

    public Comment addComment(String orgId, String id, String postId, String authorId, String body, String parentId) {
        Post post = getPost(orgId, postId);
        if (id != null && !id.isBlank()) {
            var existing = comments.findById(id); // same id-collision rules as posts
            if (existing.isPresent()) {
                if (!existing.get().getAuthorId().equals(authorId)) throw ApiException.forbidden("That comment already exists");
                return existing.get(); // idempotent re-push: stored once, notified once
            }
        } else id = "cm-" + java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        if (body == null || body.isBlank()) throw ApiException.badRequest("Write a comment first");
        if (body.length() > 5_000) throw ApiException.badRequest("Keep the comment under 5,000 characters.");
        if (parentId != null && !comments.existsById(parentId)) parentId = null; // dangling thread parent: keep the comment at top level
        Comment saved = comments.save(Comment.builder().id(id).postId(postId).authorId(authorId).body(body).parentId(parentId).build());
        // Notify the post author (and, for a threaded reply, the parent comment's author) - never the person replying.
        if (notifications.ruleEnabledFor(post.getAuthorId(), "discussionReplies")) {
            String who = users.findById(authorId).map(User::getName).orElse("Someone");
            String href = "/community?post=" + postId;
            java.util.Set<String> targets = new java.util.LinkedHashSet<>();
            if (parentId != null) comments.findById(parentId).map(Comment::getAuthorId).ifPresent(targets::add);
            targets.add(post.getAuthorId());
            targets.remove(authorId);
            for (String t : targets) notifications.notify(t, "reply", who + " replied to " + (post.getTitle() == null || post.getTitle().isBlank() ? "your post" : "“" + post.getTitle() + "”"), body == null ? "" : body, href, java.time.Duration.ofMinutes(10));
        }
        return saved;
    }

    public void togglePostReaction(String orgId, String postId, String userId, String type) {
        getPost(orgId, postId);
        ReactionType t = parseReaction(type);
        var existing = reactions.findByPostIdAndUserIdAndType(postId, userId, t);
        if (existing.isPresent()) reactions.delete(existing.get());
        else reactions.save(Reaction.builder().postId(postId).userId(userId).type(t).build());
    }
    public void toggleCommentReaction(String orgId, String commentId, String userId, String type) {
        Comment cm = comments.findById(commentId).orElseThrow(() -> ApiException.notFound("Comment"));
        getPost(orgId, cm.getPostId()); // tenant boundary: the comment's post must be in the caller's organization
        ReactionType t = parseReaction(type);
        var existing = reactions.findByCommentIdAndUserIdAndType(commentId, userId, t);
        if (existing.isPresent()) reactions.delete(existing.get());
        else reactions.save(Reaction.builder().commentId(commentId).userId(userId).type(t).build());
    }
    private ReactionType parseReaction(String type) {
        try { return ReactionType.valueOf(type.toUpperCase()); }
        catch (RuntimeException e) { throw ApiException.badRequest("Unknown reaction type"); }
    }

    public void togglePin(com.workeasy360.backend.security.CurrentUser user, String postId) {
        if (user.getRole() == com.workeasy360.backend.domain.Enums.Role.LEARNER) throw ApiException.forbidden("Only instructors and admins can pin discussions");
        Post p = getPost(user.getOrgId(), postId);
        p.setPinned(!p.getPinned());
        posts.save(p);
    }

    public List<Group> groups(String orgId) { return groups.findByOrgId(orgId); }
    public List<String> membersOf(String groupId) { return groupMembers.findByGroupId(groupId).stream().map(GroupMember::getUserId).toList(); }

    public void toggleMembership(String orgId, String groupId, String userId) {
        Group g = groups.findById(groupId).orElseThrow(() -> ApiException.notFound("Group"));
        if (g.getOrgId() != null && !g.getOrgId().equals(orgId)) throw ApiException.notFound("Group"); // tenant boundary
        var key = new GroupMember.Key(groupId, userId);
        if (groupMembers.existsById(key)) groupMembers.deleteById(key);
        else groupMembers.save(GroupMember.builder().groupId(groupId).userId(userId).build());
    }
}
