package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.CourseModule;
import com.workeasy360.backend.dto.CourseDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.CourseService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/modules")
public class ModuleController {
    private final CourseService service;
    public ModuleController(CourseService service) { this.service = service; }

    @PutMapping("/{id}")
    public CourseTreeDto update(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody UpdateModuleRequest req) {
        CourseModule m = service.updateModule(user, id, req);
        return service.tree(m.getCourseId());
    }

    @DeleteMapping("/{id}")
    public CourseTreeDto delete(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) {
        CourseModule m = service.getModule(id);
        String courseId = m.getCourseId();
        service.deleteModule(user, id);
        return service.tree(courseId);
    }

    @PostMapping("/{id}/lessons")
    public CourseTreeDto addLesson(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody CreateLessonRequest req) {
        CourseModule m = service.getModule(id);
        service.addLesson(user, id, req.id(), req.title(), req.type());
        return service.tree(m.getCourseId());
    }
}
