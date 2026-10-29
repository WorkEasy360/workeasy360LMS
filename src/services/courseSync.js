// Best-effort background reconciliation: pushes the local (optimistic, synchronous) course object to the real
// Java backend after every edit, and pulls the backend's course list into the local cache on login/boot.
//
// Why this shape: the Course Builder and every other screen were built against `services/courses.js`'s
// synchronous, localStorage-backed functions (create/add/move/delete return immediately, no await anywhere).
// Rewriting every call site to be async would touch dozens of files and risk exactly the regressions the brief
// explicitly forbids ("do not redesign", "do not break the existing UI"). Instead, local mutations keep working
// exactly as they always have (instant UI, same call sites), and this module diffs the local course tree against
// the server's and reconciles the difference in the background, debounced per course. Client-generated ids are
// reused as the server's row ids (see backend CourseController et al.), so no id-translation layer is needed.
import { api, ApiError } from "./api.js";
import { isBackendOnline, load, replace } from "../lib/store.js";
import { bus } from "../lib/events.js";

const STATUS_TO_SERVER = { draft: "DRAFT", in_review: "IN_REVIEW", published: "PUBLISHED", archived: "ARCHIVED" };
const STATUS_FROM_SERVER = Object.fromEntries(Object.entries(STATUS_TO_SERVER).map(([k, v]) => [v, k]));
const VIS_TO_SERVER = { catalog: "CATALOG", assigned: "ASSIGNED" };
const VIS_FROM_SERVER = { CATALOG: "catalog", ASSIGNED: "assigned" };
const RULE_TO_SERVER = { manual: "MANUAL", watch90: "WATCH_90", watch100: "WATCH_100" };
const RULE_FROM_SERVER = { MANUAL: "manual", WATCH_90: "watch90", WATCH_100: "watch100" };

const timers = new Map();
const inflight = new Map(); // courseId → the push currently running; the next push for that course queues behind it
export function scheduleSync(courseId) {
  if (!isBackendOnline() || !courseId) return;
  clearTimeout(timers.get(courseId));
  timers.set(courseId, setTimeout(() => serialized(courseId), 500));
}
export function flushSyncNow(courseId) {
  clearTimeout(timers.get(courseId));
  return serialized(courseId);
}
// Pushes for the same course never overlap: two concurrent diffs against the same server tree would both try to
// insert the same module / skill rows (unique-key and optimistic-lock failures). Each push starts from a fresh
// GET, so a queued push always sees the previous one's result.
function serialized(courseId) {
  const prev = inflight.get(courseId) || Promise.resolve();
  const next = prev.then(() => pushCourse(courseId)).catch((err) => warn(courseId, err)).finally(() => { if (inflight.get(courseId) === next) inflight.delete(courseId); });
  inflight.set(courseId, next);
  return next;
}

function warn(courseId, err) {
  console.warn("[courseSync] could not sync course", courseId, err?.message || err);
  bus.emit("course.sync.failed", { courseId, message: err?.message });
}

async function pushCourse(courseId) {
  const course = load("courses").find((c) => c.id === courseId);
  if (!course) return;

  let remote;
  try { remote = await api.getCourse(courseId); }
  catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      await api.createCourse(courseId, course.title);
      remote = await api.getCourse(courseId);
    } else throw err;
  }

  await api.updateCourse(courseId, {
    title: course.title, description: course.description, cover: course.cover, category: course.category,
    level: course.level, sequential: course.sequential, certExpiryMonths: course.certExpiryMonths, skills: course.skills,
    visibility: VIS_TO_SERVER[course.visibility || "catalog"],
    priceCents: Math.max(0, Math.round(course.price || 0)), currency: course.currency || "INR",
  });

  const remoteModules = remote.modules || [];
  const localModuleIds = new Set(course.modules.map((m) => m.id));
  for (const rm of remoteModules) if (!localModuleIds.has(rm.id)) await api.deleteModule(rm.id).catch(() => {});

  for (const m of course.modules) {
    const rm = remoteModules.find((x) => x.id === m.id);
    if (!rm) await api.addModule(courseId, m.id, m.title);
    else if (rm.title !== m.title || rm.description !== (m.description || "")) await api.updateModule(m.id, { title: m.title, description: m.description || "" });

    const remoteLessons = rm?.lessons || [];
    const localLessonIds = new Set(m.lessons.map((l) => l.id));
    for (const rl of remoteLessons) if (!localLessonIds.has(rl.id)) await api.deleteLesson(rl.id).catch(() => {});

    for (let i = 0; i < m.lessons.length; i++) {
      const l = m.lessons[i];
      const existedAnywhere = remoteModules.some((x) => (x.lessons || []).some((y) => y.id === l.id));
      if (!existedAnywhere) await api.addLesson(m.id, l.id, l.title, (l.type || "lesson").toUpperCase());
      const rl = remoteModules.flatMap((x) => x.lessons || []).find((y) => y.id === l.id);
      const wrongSpot = rl && (rl.moduleId !== m.id || rl.position !== i);
      if (wrongSpot) await api.moveLesson(l.id, m.id, i).catch(() => {});
      await api.updateLesson(l.id, {
        title: l.title, description: l.description || "", type: (l.type || "lesson").toUpperCase(),
        duration: l.duration || 5, content: l.blocks || [], quiz: l.quiz || null, assignment: l.assignment || null,
        completionRule: RULE_TO_SERVER[l.completion?.rule || "manual"],
        skills: l.skills || [], // lesson → skill mappings live in lesson_skills server-side
      });
    }
  }

  if (STATUS_TO_SERVER[course.status] && remote.status !== STATUS_TO_SERVER[course.status]) {
    if (course.status === "published") await api.publishCourse(courseId).catch(() => {});
    else if (course.status === "archived") await api.archiveCourse(courseId).catch(() => {});
    else if (course.status === "draft") await api.unpublishCourse(courseId).catch(() => {});
  }
  bus.emit("course.sync.ok", { courseId });
}

// ---- pull: hydrate the local cache from the server (proves "refresh, log back in, still there") ----
function toLocalLesson(dto) {
  return {
    id: dto.id, title: dto.title, description: dto.description, type: (dto.type || "LESSON").toLowerCase(),
    duration: dto.duration, blocks: dto.content || [], quiz: dto.quiz || undefined, assignment: dto.assignment || undefined,
    completion: { rule: RULE_FROM_SERVER[dto.completionRule] || "manual" },
    skills: dto.skills || [],
  };
}
function toLocalCourse(dto) {
  return {
    id: dto.id, title: dto.title, description: dto.description, cover: dto.cover, category: dto.category, level: dto.level,
    status: STATUS_FROM_SERVER[dto.status] || "draft", visibility: VIS_FROM_SERVER[dto.visibility] || "catalog",
    instructorId: dto.instructorId, sequential: dto.sequential, certExpiryMonths: dto.certExpiryMonths, skills: dto.skills || [],
    price: dto.priceCents || 0, currency: dto.currency || "INR", locked: !!dto.locked, // locked: the server redacted lesson content for this signed-in user (paid, not purchased)
    createdAt: new Date(dto.createdAt).getTime(), updatedAt: new Date(dto.updatedAt).getTime(),
    modules: (dto.modules || []).map((m) => ({ id: m.id, title: m.title, description: m.description, lessons: (m.lessons || []).map(toLocalLesson) })),
  };
}

/** Pulls the signed-in user's own courses (instructor/admin) from the server into the local cache. Additive:
 *  never removes a locally-created course the server doesn't know about yet (e.g. sync still pending). */
// Last-write-wins by timestamp: a course not yet known locally always takes the server's copy (this is what
// makes "wipe local storage, log back in" work); a course that IS known locally only gets overwritten if the
// server is at least as fresh, so an in-flight local edit that hasn't finished syncing yet never gets clobbered.
function mergeIncomingCourses(trees) {
  const incoming = trees.filter(Boolean).map(toLocalCourse);
  const local = load("courses");
  const byId = new Map(local.map((c) => [c.id, c]));
  const editing = (location.hash.match(/^#\/builder\/([^/?]+)/) || [])[1];
  incoming.forEach((c) => {
    const existing = byId.get(c.id);
    // Never replace a course with unsynced local edits, nor the one open in the Course Builder right now: the
    // incoming copy predates those edits, and the Builder (including its open dialogs) holds references into the
    // existing object — replacing it mid-edit silently discards what the instructor is working on. The next push
    // reconciles the server from the local tree instead. (The server's own updatedAt is set on each push, so the
    // timestamp comparison alone cannot protect an edit made while a push was in flight.)
    if (existing && (timers.has(c.id) || inflight.has(c.id) || c.id === editing)) return;
    if (!existing || (c.updatedAt || 0) >= (existing.updatedAt || 0)) byId.set(c.id, c);
  });
  replace("courses", [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt));
}

export async function hydrateMyCourses() {
  if (!isBackendOnline()) return;
  try {
    mergeIncomingCourses(await api.courseTrees()); // one bulk request instead of one per course
  } catch (err) {
    console.warn("[courseSync] could not hydrate courses from backend:", err.message);
  }
}

/** Learner counterpart: the published catalog plus every course the learner is enrolled in (which may be
 *  hidden from the catalog), so a fresh browser sees real backend courses, not just the local seed. */
export async function hydrateCatalog() {
  if (!isBackendOnline()) return;
  try {
    mergeIncomingCourses(await api.courseTrees()); // the backend scopes this to the catalogue + the learner's enrolments
  } catch (err) {
    console.warn("[courseSync] could not hydrate catalog from backend:", err.message);
  }
}

/** Re-pulls one course from the server (e.g. right after a purchase unlocked its content). */
export async function refreshCourse(courseId) {
  if (!isBackendOnline()) return null;
  try { const tree = await api.getCourse(courseId); mergeIncomingCourses([tree]); return tree; }
  catch (err) { console.warn("[courseSync] could not refresh course:", err.message); return null; }
}
