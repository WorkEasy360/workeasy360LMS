package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.dto.CourseDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.CourseService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/courses")
public class CourseController {
    private final CourseService service;
    public CourseController(CourseService service) { this.service = service; }

    @GetMapping
    public List<CourseSummaryDto> list(@AuthenticationPrincipal CurrentUser user,
                                        @RequestParam(required = false) String status,
                                        @RequestParam(defaultValue = "false") boolean mine) {
        return service.list(user, status, mine);
    }

    @GetMapping("/catalog")
    public List<CourseSummaryDto> catalog(@AuthenticationPrincipal CurrentUser user) { return service.catalog(user); }

    /** Every course tree in the caller's scope in one response (post-login hydration). */
    @GetMapping("/trees")
    public List<CourseTreeDto> trees(@AuthenticationPrincipal CurrentUser user) { return service.treesFor(user); }

    @GetMapping("/{id}")
    public CourseTreeDto get(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.requireReadable(user, id); return service.treeFor(user, id); }

    @GetMapping("/{id}/readiness")
    public List<String> readiness(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.requireReadable(user, id); return service.readiness(id); }

    @PostMapping
    public CourseTreeDto create(@AuthenticationPrincipal CurrentUser user, @RequestBody CreateCourseRequest req) {
        Course c = service.create(user, req.id(), req.title());
        return service.tree(c.getId());
    }

    @PutMapping("/{id}")
    public CourseTreeDto update(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody UpdateCourseRequest req) {
        service.update(user, id, req);
        return service.tree(id);
    }

    @PostMapping("/{id}/publish")
    public PublishResult publish(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { return service.publish(user, id); }

    @PostMapping("/{id}/unpublish")
    public CourseTreeDto unpublish(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.unpublish(user, id); return service.tree(id); }

    @PostMapping("/{id}/archive")
    public CourseTreeDto archive(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.archive(user, id); return service.tree(id); }

    @PostMapping("/{id}/restore")
    public CourseTreeDto restore(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.restore(user, id); return service.tree(id); }

    @PostMapping("/{id}/assign-instructor")
    public CourseTreeDto assign(@AuthenticationPrincipal CurrentUser user, @PathVariable String id, @RequestBody AssignInstructorRequest req) {
        service.assignInstructor(user, id, req.instructorId());
        return service.tree(id);
    }

    @DeleteMapping("/{id}")
    public void delete(@AuthenticationPrincipal CurrentUser user, @PathVariable String id) { service.delete(user, id); }

    // ---- modules ----
    @PostMapping("/{courseId}/modules")
    public CourseTreeDto addModule(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId, @RequestBody(required = false) CreateModuleRequest req) {
        service.addModule(user, courseId, req == null ? null : req.id(), req == null ? null : req.title());
        return service.tree(courseId);
    }

    @PutMapping("/{courseId}/modules/reorder")
    public CourseTreeDto reorderModules(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId, @RequestBody ReorderRequest req) {
        service.reorderModules(user, courseId, req.orderedIds());
        return service.tree(courseId);
    }

    // ---- lessons (nested read for convenience) ----
    @PostMapping("/{courseId}/modules/{moduleId}/lessons")
    public CourseTreeDto addLesson(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId, @PathVariable String moduleId, @RequestBody CreateLessonRequest req) {
        if (!courseId.equals(service.getModule(moduleId).getCourseId())) throw ApiException.notFound("Module"); // never answer with another course's tree
        service.addLesson(user, moduleId, req.id(), req.title(), req.type());
        return service.tree(courseId);
    }
}
