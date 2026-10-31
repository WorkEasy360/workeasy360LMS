package com.workeasy360.backend.web;

import com.workeasy360.backend.dto.CommunityDtos;
import com.workeasy360.backend.dto.CommunityDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.CommunityService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/community")
public class CommunityController {
    private final CommunityService service;
    public CommunityController(CommunityService service) { this.service = service; }

    @GetMapping("/posts")
    public List<PostDto> posts(@AuthenticationPrincipal CurrentUser user, @RequestParam(required = false) String groupId, @RequestParam(required = false) String courseId,
                                @RequestParam(required = false) String lessonId, @RequestParam(required = false) String kind) {
        return service.list(user.getOrgId(), groupId, courseId, lessonId, kind).stream()
                .map(p -> CommunityDtos.toPost(p, service.commentsOf(p.getId()), service.reactionsOf(p.getId()))).toList();
    }

    @PostMapping("/posts")
    public PostDto create(@AuthenticationPrincipal CurrentUser user, @RequestBody CreatePostRequest req) {
        var p = service.createPost(user.getOrgId(), req.id(), user.getId(), req.kind(), req.title(), req.body(), req.groupId(), req.courseId(), req.lessonId());
        return CommunityDtos.toPost(p, List.of(), List.of());
    }

    @PostMapping("/posts/{id}/comments")
    public PostDto comment(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody CreateCommentRequest req) {
        service.addComment(user.getOrgId(), req.id(), id, user.getId(), req.body(), req.parentId());
        return refetch(user, id);
    }

    @PostMapping("/posts/{id}/reactions")
    public PostDto reactPost(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody ReactRequest req) {
        service.togglePostReaction(user.getOrgId(), id, user.getId(), req.type());
        return refetch(user, id);
    }

    @PostMapping("/comments/{id}/reactions")
    public PostDto reactComment(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody ReactRequest req, @RequestParam String postId) {
        service.toggleCommentReaction(user.getOrgId(), id, user.getId(), req.type());
        return refetch(user, postId);
    }

    @PostMapping("/posts/{id}/pin")
    public PostDto pin(@org.springframework.security.core.annotation.AuthenticationPrincipal com.workeasy360.backend.security.CurrentUser user, @PathVariable String id) { service.togglePin(user, id); return refetch(user, id); }

    private PostDto refetch(CurrentUser user, String postId) {
        return CommunityDtos.toPost(service.getPost(user.getOrgId(), postId), service.commentsOf(postId), service.reactionsOf(postId));
    }

    @GetMapping("/groups")
    public List<GroupDto> groups(@AuthenticationPrincipal CurrentUser user) { return service.groups(user.getOrgId()).stream().map(g -> CommunityDtos.toGroup(g, service.membersOf(g.getId()))).toList(); }

    @PostMapping("/groups/{id}/toggle-membership")
    public GroupDto toggleMembership(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        service.toggleMembership(user.getOrgId(), id, user.getId());
        return service.groups(user.getOrgId()).stream().filter(g -> g.getId().equals(id)).findFirst()
                .map(g -> CommunityDtos.toGroup(g, service.membersOf(id))).orElseThrow(() -> ApiException.notFound("Group"));
    }
}
