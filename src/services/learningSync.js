// Pulls the signed-in learner's enrollments + lesson progress + certificates from the backend into the local
// cache on login / refresh — the same additive, last-write-wins pattern as courseSync.js's hydrateMyCourses,
// so "watch a video, refresh the browser, log back in, still resumes" holds from the real UI.
import { api } from "./api.js";
import { isBackendOnline, load, save, replace } from "../lib/store.js";
import { getCourse, lessonsOf } from "./courses.js";

const ms = (iso) => (iso ? new Date(iso).getTime() : 0);

/** Merge server lesson-progress rows into a local enrollment's video progress, keyed by the lesson's first video
 *  block. Newer wins per block: a local position the learner reached moments ago (not yet synced) is never
 *  overwritten by an older server row, while a fresh browser (no local row) always takes the server's. */
function mergeVideoProgress(existing = {}, progressRows, course) {
  const merged = { ...existing };
  if (!course) return merged;
  for (const p of progressRows) {
    if (!p.lastPosition && !p.watchPercentage) continue;
    const lesson = lessonsOf(course).find((l) => l.id === p.lessonId);
    const block = lesson?.blocks?.find((b) => b.type === "video");
    if (!block) continue;
    const local = merged[block.id];
    const serverAt = ms(p.updatedAt);
    if (local && (local.updatedAt || 0) >= serverAt) continue;
    merged[block.id] = {
      position: p.lastPosition || 0, lastPosition: p.lastPosition || 0, percent: p.watchPercentage || 0,
      maxPercent: Math.max(p.watchPercentage || 0, local?.maxPercent || 0), completed: !!p.videoCompleted,
      updatedAt: serverAt || Date.now(),
    };
  }
  return merged;
}

function toLocalEnrollment(dto, progressRows, course, existing) {
  const completed = [...new Set([...(existing?.completed || []), ...progressRows.filter((p) => p.status === "COMPLETED").map((p) => p.lessonId)])];
  return {
    ...(existing || { quiz: {}, submissions: {}, notes: {}, bookmarks: [] }),
    id: dto.id, userId: dto.userId, courseId: dto.courseId, completed,
    startedAt: dto.startedAt ? ms(dto.startedAt) : existing?.startedAt || Date.now(),
    lastLessonId: dto.lastLessonId || existing?.lastLessonId || null,
    completedAt: dto.completedAt ? ms(dto.completedAt) : existing?.completedAt || null,
    lastActiveAt: dto.lastActiveAt ? ms(dto.lastActiveAt) : existing?.lastActiveAt || null,
    dueAt: dto.dueAt ? ms(dto.dueAt) : existing?.dueAt || null,
    source: dto.source || existing?.source || "FREE", orderId: dto.orderId || existing?.orderId || null,
    videoProgress: mergeVideoProgress(existing?.videoProgress, progressRows, course),
  };
}

/** Authoritative per-course progress pull, used by the Player on lesson load. Returns true if anything changed. */
export async function hydrateLessonProgress(userId, courseId) {
  if (!isBackendOnline()) return false;
  const rows = await api.progressDetail(courseId);
  const enrollments = load("enrollments");
  const e = enrollments.find((x) => x.userId === userId && x.courseId === courseId);
  if (!e) return false;
  const before = JSON.stringify([e.completed, e.videoProgress || {}]);
  rows.filter((p) => p.status === "COMPLETED").forEach((p) => { if (!e.completed.includes(p.lessonId)) e.completed.push(p.lessonId); });
  e.videoProgress = mergeVideoProgress(e.videoProgress, rows, getCourse(courseId));
  const changed = JSON.stringify([e.completed, e.videoProgress]) !== before;
  if (changed) save("enrollments");
  return changed;
}

export async function hydrateMyLearning() {
  if (!isBackendOnline()) return;
  try {
    const enrollDtos = await api.myEnrollments();
    const local = load("enrollments");
    const byKey = new Map(local.map((e) => [`${e.userId}:${e.courseId}`, e]));
    const incoming = await Promise.all(enrollDtos.map(async (dto) => {
      const progressRows = await api.progressDetail(dto.courseId).catch(() => []);
      return toLocalEnrollment(dto, progressRows, getCourse(dto.courseId), byKey.get(`${dto.userId}:${dto.courseId}`));
    }));
    incoming.forEach((e) => byKey.set(`${e.userId}:${e.courseId}`, e));
    replace("enrollments", [...byKey.values()]);

    const certs = await api.certificates();
    const localCerts = load("certificates");
    const byCertKey = new Map(localCerts.map((c) => [`${c.userId}:${c.courseId}`, c]));
    certs.forEach((c) => byCertKey.set(`${c.userId}:${c.courseId}`, {
      id: c.certificateNumber, userId: c.userId, courseId: c.courseId,
      issuedAt: ms(c.issuedAt), expiresAt: c.expiresAt ? ms(c.expiresAt) : null,
      revoked: c.status === "REVOKED",
    }));
    replace("certificates", [...byCertKey.values()]);
  } catch (err) {
    console.warn("[learningSync] could not hydrate learning data from backend:", err.message);
  }
}
