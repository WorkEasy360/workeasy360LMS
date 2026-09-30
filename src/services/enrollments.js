// Enrollment management (admin / course owner).
import { load, save, isBackendOnline } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { uid } from "../lib/dom.js";
import { api } from "./api.js";
import { notify } from "./people.js";
import { getCourse, courseTitle } from "./courses.js";

export const enrolledUsers = (courseId) => load("enrollments").filter((e) => e.courseId === courseId);

/** Instructor/admin enrols a learner. Online, the backend creates the enrolment (and notifies the learner); the local row keeps the dialog responsive. */
export function assign(userId, courseId, { dueAt = null } = {}) {
  const existed = !!load("enrollments").find((e) => e.userId === userId && e.courseId === courseId);
  const e = existed ? load("enrollments").find((x) => x.userId === userId && x.courseId === courseId) : addLocal(userId, courseId, dueAt);
  if (dueAt && !e.dueAt) { e.dueAt = dueAt; save("enrollments"); }
  if (isBackendOnline()) api.assignLearner(courseId, userId, dueAt).catch((err) => console.warn("[enrollments] backend assign failed:", err.message));
  notify(userId, { kind: "due", title: `You've been enrolled in ${courseTitle(getCourse(courseId))}`, body: dueAt ? "A due date has been set." : "Start whenever you're ready.", href: `/learn/${courseId}` });
  return e;
}
// Same row shape as learning.enroll(), without the self-enrol API call (POST /enroll enrols the caller, not the learner).
function addLocal(userId, courseId, dueAt) {
  const e = { id: uid("e"), userId, courseId, completed: [], quiz: {}, submissions: {}, notes: {}, bookmarks: [], startedAt: null, lastLessonId: null, completedAt: null, lastActiveAt: null, dueAt };
  load("enrollments").push(e);
  save("enrollments");
  bus.emit("course.enrolled", { userId, courseId });
  return e;
}

export function unenroll(userId, courseId) {
  const all = load("enrollments");
  const i = all.findIndex((e) => e.userId === userId && e.courseId === courseId);
  if (i >= 0) all.splice(i, 1);
  save("enrollments");
  if (isBackendOnline()) api.removeLearner(courseId, userId).catch((err) => console.warn("[enrollments] backend remove failed:", err.message));
  bus.emit("course.unenrolled", { userId, courseId });
}
