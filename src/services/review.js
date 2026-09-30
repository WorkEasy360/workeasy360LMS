// Instructor review of assignment submissions.
import { load, save, isBackendOnline } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { getCourse, courseTitle } from "./courses.js";
import { notify } from "./people.js";
import { api } from "./api.js";

export function reviewSubmission(enrollmentId, lessonId, feedback) {
  const e = load("enrollments").find((x) => x.id === enrollmentId);
  const s = e?.submissions[lessonId];
  if (!s) return;
  s.status = "reviewed";
  s.feedback = feedback;
  save("enrollments");
  notify(e.userId, { kind: "achievement", title: "Your assignment was reviewed", body: `${courseTitle(getCourse(e.courseId))} · ${feedback.slice(0, 80)}`, href: `/learn/${e.courseId}/${lessonId}` });
  bus.emit("assignment.reviewed", { enrollmentId, lessonId });
  if (isBackendOnline()) {
    api.pendingSubmissions(e.courseId)
      .then((pending) => {
        const match = pending.find((p) => p.userId === e.userId && p.lessonId === lessonId);
        return match ? api.reviewSubmission(match.id, feedback) : null;
      })
      .catch((err) => console.warn("[review] backend sync failed:", err.message));
  }
}
