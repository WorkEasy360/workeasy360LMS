package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.SkillEntities.*;
import com.workeasy360.backend.dto.SkillDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.PermissionService;
import com.workeasy360.backend.service.SkillService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
public class SkillController {
    private final SkillService service;
    private final PermissionService perm;
    private final com.workeasy360.backend.repo.Repos.UserRepo users;
    public SkillController(SkillService service, PermissionService perm, com.workeasy360.backend.repo.Repos.UserRepo users) { this.service = service; this.perm = perm; this.users = users; }

    // ---- library (everyone can read; admin writes) ----
    @GetMapping("/api/skills")
    public List<SkillDto> list(@AuthenticationPrincipal CurrentUser user, @RequestParam(defaultValue = "false") boolean includeInactive) { return service.listSkills(user.getOrgId(), includeInactive); }
    @PostMapping("/api/skills")
    public SkillDto create(@AuthenticationPrincipal CurrentUser user, @RequestBody UpsertSkillRequest req) {
        Skill s = service.upsertSkill(user, req);
        return service.listSkills(user.getOrgId(), true).stream().filter(x -> x.id().equals(s.getId())).findFirst().orElseThrow();
    }
    @PutMapping("/api/skills/{id}")
    public SkillDto update(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody UpsertSkillRequest req) {
        Skill s = service.upsertSkill(user, new UpsertSkillRequest(id, req.name(), req.description(), req.categoryId(), req.icon(), req.levels(), req.active()));
        return service.listSkills(user.getOrgId(), true).stream().filter(x -> x.id().equals(s.getId())).findFirst().orElseThrow();
    }
    @PostMapping("/api/skills/{id}/deactivate")
    public void deactivate(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.setActive(user, id, false); }
    @PostMapping("/api/skills/{id}/activate")
    public void activate(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.setActive(user, id, true); }

    @GetMapping("/api/skills/categories")
    public List<CategoryDto> categories(@AuthenticationPrincipal CurrentUser user) { return service.listCategories(user.getOrgId()); }
    @PostMapping("/api/skills/categories")
    public CategoryDto createCategory(@AuthenticationPrincipal CurrentUser user, @RequestBody UpsertCategoryRequest req) { return CategoryDto.of(service.upsertCategory(user, req)); }

    // ---- mappings ----
    @GetMapping("/api/courses/{courseId}/skills")
    public List<CourseSkillDto> courseSkills(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId) { service.requireSameOrgCourse(user, courseId); return service.courseSkills(courseId); }
    @PutMapping("/api/courses/{courseId}/skills")
    public List<CourseSkillDto> setCourseSkills(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId, @RequestBody List<CourseSkillDto> body) { return service.setCourseSkills(user, courseId, body); }

    @GetMapping("/api/lessons/{lessonId}/skills")
    public List<LessonSkillDto> lessonSkills(@AuthenticationPrincipal CurrentUser user, @PathVariable String lessonId) { service.requireSameOrgCourse(user, service.courseIdOfLesson(lessonId)); return service.lessonSkills(lessonId); }
    @PutMapping("/api/lessons/{lessonId}/skills")
    public List<LessonSkillDto> setLessonSkills(@AuthenticationPrincipal CurrentUser user, @PathVariable String lessonId, @RequestBody List<LessonSkillDto> body) { return service.setLessonSkills(user, lessonId, body); }

    // ---- learner standing ----
    @GetMapping("/api/me/skills")
    public List<UserSkillDto> mine(@AuthenticationPrincipal CurrentUser user) { return service.userSkills(user.getId()); }
    @PostMapping("/api/me/skills/recalculate")
    public List<UserSkillDto> recalc(@AuthenticationPrincipal CurrentUser user) { service.recalculate(user.getId()); return service.userSkills(user.getId()); }
    @GetMapping("/api/users/{userId}/skills")
    public List<UserSkillDto> forUser(@AuthenticationPrincipal CurrentUser user, @PathVariable String userId) {
        if (!perm.isAdmin(user) && user.getRole() != com.workeasy360.backend.domain.Enums.Role.INSTRUCTOR && !user.getId().equals(userId)) throw ApiException.forbidden("Not allowed");
        if (!user.getId().equals(userId) && !users.findById(userId).map(t -> user.getOrgId().equals(t.getOrgId())).orElse(false)) throw ApiException.notFound("User");
        return service.userSkills(userId);
    }

    // ---- learning paths ----
    @GetMapping("/api/learning-paths")
    public List<LearningPathDto> paths(@AuthenticationPrincipal CurrentUser user) { return service.learningPaths(user.getOrgId()); }
}
