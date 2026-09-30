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
    public List<PostDto> posts(@RequestParam(required = false) String groupId, @RequestParam(required = false) String courseId,
                                @RequestParam(required = false) String lessonId, @RequestParam(required = false) String kind) {
        return service.list(groupId, courseId, lessonId, kind).stream()
                .map(p -> CommunityDtos.toPost(p, service.commentsOf(p.getId()), service.reactionsOf(p.getId()))).toList();
    }

    @PostMapping("/posts")
    public PostDto create(@AuthenticationPrincipal CurrentUser user, @RequestBody CreatePostRequest req) {
        var p = service.createPost(req.id(), user.getId(), req.kind(), req.title(), req.body(), req.groupId(), req.courseId(), req.lessonId());
        return CommunityDtos.toPost(p, List.of(), List.of());
    }

    @PostMapping("/posts/{id}/comments")
    public PostDto comment(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody CreateCommentRequest req) {
        service.addComment(req.id(), id, user.getId(), req.body(), req.parentId());
        return refetch(id);
    }

    @PostMapping("/posts/{id}/reactions")
    public PostDto reactPost(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody ReactRequest req) {
        service.togglePostReaction(id, user.getId(), req.type());
        return refetch(id);
    }

    @PostMapping("/comments/{id}/reactions")
    public PostDto reactComment(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody ReactRequest req, @RequestParam String postId) {
        service.toggleCommentReaction(id, user.getId(), req.type());
        return refetch(postId);
    }

    @PostMapping("/posts/{id}/pin")
    public PostDto pin(@org.springframework.security.core.annotation.AuthenticationPrincipal com.workeasy360.backend.security.CurrentUser user, @PathVariable String id) { service.togglePin(user, id); return refetch(id); }

    private PostDto refetch(String postId) {
        return CommunityDtos.toPost(service.getPost(postId), service.commentsOf(postId), service.reactionsOf(postId));
    }

    @GetMapping("/groups")
    public List<GroupDto> groups() { return service.groups().stream().map(g -> CommunityDtos.toGroup(g, service.membersOf(g.getId()))).toList(); }

    @PostMapping("/groups/{id}/toggle-membership")
    public GroupDto toggleMembership(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        service.toggleMembership(id, user.getId());
        return service.groups().stream().filter(g -> g.getId().equals(id)).findFirst()
                .map(g -> CommunityDtos.toGroup(g, service.membersOf(id))).orElseThrow(() -> ApiException.notFound("Group"));
    }
}
