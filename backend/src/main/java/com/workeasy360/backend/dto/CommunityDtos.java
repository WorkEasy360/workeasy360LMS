package com.workeasy360.backend.dto;

import com.workeasy360.backend.domain.Comment;
import com.workeasy360.backend.domain.Group;
import com.workeasy360.backend.domain.Post;
import com.workeasy360.backend.domain.Reaction;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public class CommunityDtos {
    public record CreatePostRequest(String id, String kind, String title, String body, String groupId, String courseId, String lessonId) {}
    public record CreateCommentRequest(String id, String body, String parentId) {}
    public record ReactRequest(String type) {}

    public record CommentDto(String id, String postId, String authorId, String parentId, String body, Instant createdAt, List<String> likedBy) {}

    public record PostDto(String id, String authorId, String kind, String title, String body, String groupId,
                           String courseId, String lessonId, boolean pinned, Instant createdAt,
                           Map<String, List<String>> reactions, List<CommentDto> comments) {}

    public record GroupDto(String id, String name, String description, Integer hue, List<String> members) {}

    public static CommentDto toComment(Comment c, List<Reaction> reactions) {
        return new CommentDto(c.getId(), c.getPostId(), c.getAuthorId(), c.getParentId(), c.getBody(), c.getCreatedAt(),
                reactions.stream().filter(r -> c.getId().equals(r.getCommentId())).map(Reaction::getUserId).toList());
    }

    public static PostDto toPost(Post p, List<Comment> comments, List<Reaction> reactions) {
        Map<String, List<String>> byType = new java.util.HashMap<>();
        for (var r : reactions) byType.computeIfAbsent(r.getType().name().toLowerCase(), k -> new java.util.ArrayList<>()).add(r.getUserId());
        List<CommentDto> commentDtos = comments.stream().map(c -> toComment(c, reactions)).toList();
        return new PostDto(p.getId(), p.getAuthorId(), p.getKind().name().toLowerCase(), p.getTitle(), p.getBody(),
                p.getGroupId(), p.getCourseId(), p.getLessonId(), p.getPinned(), p.getCreatedAt(), byType, commentDtos);
    }

    public static GroupDto toGroup(Group g, List<String> members) {
        return new GroupDto(g.getId(), g.getName(), g.getDescription(), g.getHue(), members);
    }
}
