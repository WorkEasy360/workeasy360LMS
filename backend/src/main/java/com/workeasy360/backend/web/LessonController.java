package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.CourseModule;
import com.workeasy360.backend.domain.Lesson;
import com.workeasy360.backend.dto.CourseDtos;
import com.workeasy360.backend.dto.CourseDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.CourseService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/lessons")
public class LessonController {
    private final CourseService service;
    private final com.workeasy360.backend.service.AccessService access;
    public LessonController(CourseService service, com.workeasy360.backend.service.AccessService access) { this.service = service; this.access = access; }

    @GetMapping("/{id}")
    public LessonDto get(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { access.requireContentAccess(user, service.courseIdOfLesson(id)); return CourseDtos.toLesson(service.getLesson(id)); }

    @PutMapping("/{id}")
    public CourseTreeDto update(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody UpdateLessonRequest req) {
        Lesson l = service.updateLesson(user, id, req);
        CourseModule m = service.getModule(l.getModuleId());
        return service.tree(m.getCourseId());
    }

    @PostMapping("/{id}/move")
    public CourseTreeDto move(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody MoveLessonRequest req) {
        Lesson l = service.getLesson(id);
        String courseId = service.getModule(l.getModuleId()).getCourseId();
        service.moveLesson(user, id, req.toModuleId(), req.toIndex());
        return service.tree(courseId);
    }

    @PostMapping("/{id}/duplicate")
    public CourseTreeDto duplicate(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        Lesson copy = service.duplicateLesson(user, id);
        String courseId = service.getModule(copy.getModuleId()).getCourseId();
        return service.tree(courseId);
    }

    @DeleteMapping("/{id}")
    public CourseTreeDto delete(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        Lesson l = service.getLesson(id);
        String courseId = service.getModule(l.getModuleId()).getCourseId();
        service.deleteLesson(user, id);
        return service.tree(courseId);
    }
}
