package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.Enums.Role;
import com.workeasy360.backend.security.CurrentUser;
import org.springframework.stereotype.Component;

/**
 * Backend-enforced permission matrix — mirrors the frontend's src/services/permissions.js `can()` table so the two
 * stay conceptually identical, but this copy is authoritative: the frontend's checks are UX only, every mutating
 * endpoint re-checks here. Never trust a role or ownership claim supplied only by the client.
 */
@Component
public class PermissionService {

    /** Tenant boundary: the one rule every other rule sits behind. An admin is an admin of THEIR organization only. */
    public boolean sameOrg(CurrentUser u, Course course) {
        return course.getOrgId() == null || course.getOrgId().equals(u.getOrgId());
    }

    public boolean canCreateCourse(CurrentUser u) {
        return u.getRole() == Role.ADMIN || u.getRole() == Role.INSTRUCTOR;
    }

    public boolean canEditCourse(CurrentUser u, Course course) {
        if (!sameOrg(u, course)) return false;
        if (u.getRole() == Role.ADMIN) return true;
        return u.getRole() == Role.INSTRUCTOR && course.getInstructorId().equals(u.getId());
    }

    public boolean canPublish(CurrentUser u, Course course, boolean instructorsCanPublish) {
        if (!sameOrg(u, course)) return false;
        if (u.getRole() == Role.ADMIN) return true;
        return u.getRole() == Role.INSTRUCTOR && course.getInstructorId().equals(u.getId()) && instructorsCanPublish;
    }

    public boolean canSubmitForReview(CurrentUser u, Course course) {
        return sameOrg(u, course) && u.getRole() == Role.INSTRUCTOR && course.getInstructorId().equals(u.getId());
    }

    public boolean canReview(CurrentUser u) { return u.getRole() == Role.ADMIN; }
    public boolean canAssignInstructor(CurrentUser u) { return u.getRole() == Role.ADMIN; }
    public boolean canArchive(CurrentUser u, Course course) { return canEditCourse(u, course); }
    public boolean canManageEnrollments(CurrentUser u, Course course) { return canEditCourse(u, course); }
    public boolean canViewAnalytics(CurrentUser u, Course course) { return canEditCourse(u, course); }
    public boolean isAdmin(CurrentUser u) { return u.getRole() == Role.ADMIN; }
    /** WorkEasy360's own staff: platform oversight, never a member of a customer organization. */
    public boolean isPlatform(CurrentUser u) { return u.getRole() == Role.PLATFORM; }
}
