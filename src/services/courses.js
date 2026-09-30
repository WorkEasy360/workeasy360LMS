// Course authoring service. All persistence goes through store.js so a real API can replace it later.
import { load, save as saveKey } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { uid } from "../lib/dom.js";
import { can } from "./permissions.js";
import { scheduleSync, flushSyncNow } from "./courseSync.js";

// Every course mutation goes through this instead of calling store.save("courses") directly, so a background
// sync to the real backend (see courseSync.js) is scheduled automatically without touching call sites elsewhere.
function save(courseId) {
  saveKey("courses");
  scheduleSync(courseId);
}

export const LESSON_TYPES = {
  lesson: { label: "Lesson", icon: "file" },
  video: { label: "Video", icon: "video" },
  reading: { label: "Reading", icon: "book" },
  quiz: { label: "Quiz", icon: "clipboard" },
  assignment: { label: "Assignment", icon: "upload" },
  discussion: { label: "Discussion", icon: "message" },
};

export const COVER_ICONS = ["target", "layers", "zap", "users", "shield", "chart", "rocket", "message", "book", "bulb", "compass", "cap"];
export const CATEGORIES = ["Sales", "Leadership", "Compliance", "Analytics", "Onboarding", "Customer Success", "Product", "Engineering"];
export const LEVELS = ["Beginner", "Intermediate", "Advanced"];

export const listCourses = (filter = {}) =>
  load("courses").filter((c) => (!filter.status || c.status === filter.status) && (!filter.instructorId || c.instructorId === filter.instructorId));
export const getCourse = (id) => load("courses").find((c) => c.id === id) || null;
export const lessonsOf = (course) => course.modules.flatMap((m) => m.lessons);
export const findLesson = (course, lessonId) => lessonsOf(course).find((l) => l.id === lessonId) || null;
export const moduleOfLesson = (course, lessonId) => course.modules.find((m) => m.lessons.some((l) => l.id === lessonId)) || null;
export const courseMinutes = (course) => lessonsOf(course).reduce((n, l) => n + (l.duration || 0), 0);
export const courseTitle = (c) => (c.title || "").trim() || "Untitled course";

export function coverStyle(cover = {}) {
  const h = cover.hue ?? 250;
  return `background: linear-gradient(135deg, hsl(${h} 72% 46%), hsl(${(h + 38) % 360} 70% 58%))`;
}

export function createCourse({ title = "", instructorId } = {}) {
  const hue = [250, 205, 18, 330, 160, 285, 38, 178][Math.floor(Math.random() * 8)];
  const course = {
    id: uid("c"), title, description: "", category: "Sales", level: "Beginner", status: "draft", instructorId,
    cover: { hue, icon: COVER_ICONS[Math.floor(Math.random() * COVER_ICONS.length)] }, skills: [], modules: [],
    createdAt: Date.now(), updatedAt: Date.now(), sequential: true, certExpiryMonths: 0,
  };
  load("courses").unshift(course);
  save(course.id);
  bus.emit("course.created", { courseId: course.id });
  return course;
}

// Mutate a course through fn; persists and notifies. fn may return an event to emit.
export function mutate(courseId, fn) {
  const course = getCourse(courseId);
  if (!course) return null;
  const result = fn(course);
  course.updatedAt = Date.now();
  save(courseId);
  return result;
}

export function setTitle(courseId, title) {
  mutate(courseId, (c) => (c.title = title));
  bus.emit("course.title.changed", { courseId, title });
}

export function addModule(courseId) {
  const m = mutate(courseId, (c) => {
    const m = { id: uid("m"), title: `Module ${c.modules.length + 1}`, lessons: [] };
    c.modules.push(m);
    return m;
  });
  bus.emit("module.added", { courseId, moduleId: m.id });
  return m;
}

export function addLesson(courseId, moduleId, type = "lesson") {
  const lesson = mutate(courseId, (c) => {
    const m = c.modules.find((x) => x.id === moduleId);
    if (!m) return null;
    const n = m.lessons.length + 1;
    const l = { id: uid("l"), title: type === "lesson" ? `Lesson ${n}` : `${LESSON_TYPES[type].label} ${n}`, type, duration: 5, blocks: [] };
    if (type === "quiz") l.quiz = { passScore: 70, questions: [] };
    if (type === "assignment") l.assignment = { brief: "", rubric: [] };
    if (type === "lesson" || type === "reading") l.blocks.push({ id: uid("b"), type: "text", text: "" });
    if (type === "video") l.blocks.push({ id: uid("b"), type: "video", video: null, caption: "" });
    m.lessons.push(l);
    return l;
  });
  if (lesson) bus.emit("lesson.added", { courseId, moduleId, lessonId: lesson.id });
  return lesson;
}

export function removeModule(courseId, moduleId) {
  mutate(courseId, (c) => (c.modules = c.modules.filter((m) => m.id !== moduleId)));
  bus.emit("module.removed", { courseId, moduleId });
}
export function removeLesson(courseId, lessonId) {
  mutate(courseId, (c) => c.modules.forEach((m) => (m.lessons = m.lessons.filter((l) => l.id !== lessonId))));
  bus.emit("lesson.removed", { courseId, lessonId });
}

export function moveModule(courseId, moduleId, toIndex) {
  mutate(courseId, (c) => {
    const from = c.modules.findIndex((m) => m.id === moduleId);
    if (from < 0) return;
    const [m] = c.modules.splice(from, 1);
    c.modules.splice(Math.max(0, Math.min(toIndex, c.modules.length)), 0, m);
  });
}

export function moveLesson(courseId, lessonId, toModuleId, toIndex) {
  mutate(courseId, (c) => {
    let lesson;
    c.modules.forEach((m) => {
      const i = m.lessons.findIndex((l) => l.id === lessonId);
      if (i >= 0) [lesson] = m.lessons.splice(i, 1);
    });
    const target = c.modules.find((m) => m.id === toModuleId);
    if (lesson && target) target.lessons.splice(Math.max(0, Math.min(toIndex, target.lessons.length)), 0, lesson);
  });
}

export function duplicateLesson(courseId, lessonId) {
  return mutate(courseId, (c) => {
    const m = moduleOfLesson(c, lessonId);
    const src = m?.lessons.find((l) => l.id === lessonId);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid("l");
    copy.title += " (copy)";
    copy.blocks?.forEach((b) => (b.id = uid("b")));
    m.lessons.splice(m.lessons.indexOf(src) + 1, 0, copy);
    return copy;
  });
}

export function publishReadiness(course) {
  const ls = lessonsOf(course);
  const emptyModules = course.modules.filter((m) => !m.lessons.length).length;
  return [
    { id: "title", label: "Give the course a name", ok: courseTitle(course) !== "Untitled course" && course.title.trim().length >= 3, required: true },
    { id: "module", label: "Add at least one module", ok: course.modules.length > 0, required: true },
    { id: "lesson", label: "Add at least one lesson", ok: ls.length > 0, required: true },
    { id: "empty", label: emptyModules ? `${emptyModules} module(s) have no lessons` : "Every module has lessons", ok: emptyModules === 0 && course.modules.length > 0, required: false },
    { id: "desc", label: "Add a short description", ok: course.description.trim().length >= 10, required: false },
    { id: "quiz", label: "Add a quiz or knowledge check", ok: ls.some((l) => l.type === "quiz" || l.blocks?.some((b) => b.type === "knowledge")), required: false },
  ];
}

// ---- lifecycle: draft → (in_review) → published → archived ----
export const COURSE_STATUSES = ["draft", "in_review", "published", "archived"];

export function publishCourse(courseId, user = null) {
  const course = getCourse(courseId);
  const blockers = publishReadiness(course).filter((r) => r.required && !r.ok);
  if (blockers.length) return { ok: false, blockers };
  if (user && !can(user, "course.publish", course)) {
    if (can(user, "course.submit", course)) {
      mutate(courseId, (c) => (c.status = "in_review"));
      flushSyncNow(courseId);
      bus.emit("course.submitted", { courseId });
      return { ok: true, status: "in_review" };
    }
    return { ok: false, denied: true, blockers: [] };
  }
  mutate(courseId, (c) => (c.status = "published"));
  flushSyncNow(courseId);
  bus.emit("course.published", { courseId });
  return { ok: true, status: "published" };
}

export function unpublishCourse(courseId) {
  mutate(courseId, (c) => (c.status = "draft"));
  bus.emit("course.unpublished", { courseId });
}

export function archiveCourse(courseId) {
  mutate(courseId, (c) => { c.previousStatus = c.status; c.status = "archived"; });
  bus.emit("course.archived", { courseId });
}
export function restoreCourse(courseId) {
  mutate(courseId, (c) => { c.status = c.previousStatus && c.previousStatus !== "archived" ? "draft" : "draft"; });
  bus.emit("course.restored", { courseId });
}
export function assignInstructor(courseId, instructorId) {
  mutate(courseId, (c) => (c.instructorId = instructorId));
  bus.emit("course.assigned", { courseId, instructorId });
}
// visibility: "catalog" (anyone can find it) | "assigned" (only people enrolled by an admin/instructor)
export function setVisibility(courseId, visibility) {
  mutate(courseId, (c) => (c.visibility = visibility));
}
export const isVisibleInCatalog = (c) => c.status === "published" && (c.visibility || "catalog") === "catalog";

export function deleteCourse(courseId) {
  const all = load("courses");
  const i = all.findIndex((c) => c.id === courseId);
  if (i >= 0) all.splice(i, 1);
  saveKey("courses");
  import("./api.js").then(({ api }) => api.deleteCourse(courseId)).catch((err) => console.warn("[courses] backend delete failed:", err.message));
  bus.emit("course.deleted", { courseId });
}
