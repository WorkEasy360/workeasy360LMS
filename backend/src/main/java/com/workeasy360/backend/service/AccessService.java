package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.Enrollment;
import com.workeasy360.backend.domain.Enums.CourseStatus;
import com.workeasy360.backend.repo.Repos.CourseRepo;
import com.workeasy360.backend.repo.Repos.EnrollmentRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * The single rule for who may see a course's content (lesson bodies, quizzes, assignments, videos, progress):
 *   - whoever can edit the course (its instructor, admins);
 *   - anyone holding an entitlement (an enrolment row: free enrolment, purchase or assignment);
 *   - anyone, for a published FREE course.
 * A published PAID course without an entitlement is visible (title, syllabus, price) but its content is locked.
 */
@Service
public class AccessService {
    private final PermissionService perm; private final EnrollmentRepo enrollments; private final CourseRepo courses;
    public AccessService(PermissionService perm, EnrollmentRepo enrollments, CourseRepo courses) { this.perm = perm; this.enrollments = enrollments; this.courses = courses; }

    public static boolean isFree(Course c) { return c.getPriceCents() == null || c.getPriceCents() <= 0; }

    public Optional<Enrollment> entitlement(CurrentUser user, Course c) { return enrollments.findByUserIdAndCourseId(user.getId(), c.getId()); }

    public boolean canAccessContent(CurrentUser user, Course c) {
        if (!perm.sameOrg(user, c)) return false; // tenant boundary: another organization's course does not exist for this user
        if (perm.canEditCourse(user, c)) return true;
        if (entitlement(user, c).isPresent()) return true;
        return c.getStatus() == CourseStatus.PUBLISHED && isFree(c);
    }

    public void requireContentAccess(CurrentUser user, Course c) {
        if (!perm.sameOrg(user, c)) throw ApiException.notFound("Course"); // don't reveal that it exists elsewhere
        if (canAccessContent(user, c)) return;
        if (c.getStatus() == CourseStatus.PUBLISHED && !isFree(c)) throw new ApiException(HttpStatus.PAYMENT_REQUIRED, "This course must be purchased before its content can be opened.");
        throw ApiException.forbidden("This course is not available to you");
    }
    public void requireContentAccess(CurrentUser user, String courseId) {
        requireContentAccess(user, courses.findById(courseId).orElseThrow(() -> ApiException.notFound("Course")));
    }
}
