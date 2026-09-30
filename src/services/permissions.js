// Role/permission checks — one Course Builder, many roles. UI and routes ask `can(user, action, course)`
// instead of branching on role names, so new roles (e.g. Reviewer) are a data change, not a new screen.
import { settings } from "./people.js";

const ALL = "*";

// action → who may do it. "own" = only for courses the user owns.
const MATRIX = {
  admin: { "course.create": ALL, "course.view": ALL, "course.edit": ALL, "course.publish": ALL, "course.archive": ALL, "course.assign": ALL, "course.visibility": ALL, "course.enrollments": ALL, "course.analytics": ALL, "course.review": ALL, "course.submit": ALL, "assessment.manage": ALL },
  instructor: { "course.create": ALL, "course.view": "own", "course.edit": "own", "course.publish": "own", "course.submit": "own", "course.archive": "own", "course.enrollments": "own", "course.analytics": "own", "assessment.manage": "own" },
  reviewer: { "course.view": ALL, "course.review": ALL },
  learner: {},
};

export function can(user, action, course = null) {
  if (!user) return false;
  const scope = MATRIX[user.role]?.[action];
  if (!scope) return false;
  if (action === "course.publish" && user.role === "instructor" && settings().instructorPublish === false) return false;
  if (scope === ALL) return true;
  return !course || course.instructorId === user.id; // "own"
}

export const canCreateCourse = (user) => can(user, "course.create");
export const isAuthor = (user) => ["admin", "instructor"].includes(user?.role);
