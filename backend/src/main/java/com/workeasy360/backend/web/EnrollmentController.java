package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.Enrollment;
import com.workeasy360.backend.dto.LearningDtos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.CourseService;
import com.workeasy360.backend.service.EnrollmentService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
public class EnrollmentController {
    private final EnrollmentService service;
    private final CourseService courseService;

    public EnrollmentController(EnrollmentService service, CourseService courseService) { this.service = service; this.courseService = courseService; }

    @PostMapping("/api/courses/{courseId}/enroll")
    public EnrollmentDto enroll(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId, @RequestBody(required = false) EnrollRequest req) {
        return EnrollmentDto.of(service.selfEnroll(user, courseId, req == null ? null : req.dueAt()));
    }

    @GetMapping("/api/me/courses")
    public List<EnrollmentDto> mine(@AuthenticationPrincipal CurrentUser user) {
        return service.mine(user.getId()).stream().map(EnrollmentDto::of).toList();
    }

    @GetMapping("/api/courses/{courseId}/learners")
    public List<EnrollmentDto> learners(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId) {
        return service.forCourse(user, courseService.get(courseId)).stream().map(EnrollmentDto::of).toList();
    }

    @PostMapping("/api/courses/{courseId}/learners/{userId}")
    public EnrollmentDto assign(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId, @PathVariable String userId, @RequestBody(required = false) EnrollRequest req) {
        return EnrollmentDto.of(service.assign(user, courseService.get(courseId), userId, req == null ? null : req.dueAt()));
    }

    @DeleteMapping("/api/courses/{courseId}/learners/{userId}")
    public void remove(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId, @PathVariable String userId) {
        service.remove(user, courseService.get(courseId), userId);
    }

    @GetMapping("/api/courses/{courseId}/progress")
    public CourseProgressDto progress(@AuthenticationPrincipal CurrentUser user, @PathVariable String courseId,
                                       @RequestParam(required = false) String userId) {
        if (userId != null && !userId.equals(user.getId())) service.forCourse(user, courseService.get(courseId)); // another learner's progress: course managers only
        return service.progress(userId != null ? userId : user.getId(), courseId);
    }
}
