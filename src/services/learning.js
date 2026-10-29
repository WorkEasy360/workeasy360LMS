// Learner-side service: enrollments, progress, skills, journeys, certificates, achievements.
// Local mutations stay synchronous and instant (same call sites, same UI); each one also fires a best-effort
// background call to the real backend (see services/api.js), which is the seam covered by learningSync.js's
// hydrateMyLearning() pulling this data back from the server on login / refresh.
import { load, save } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { uid } from "../lib/dom.js";
import { getCourse, lessonsOf, listCourses, courseTitle } from "./courses.js";
import { userById, notify } from "./people.js";
import { api } from "./api.js";
import { isBackendOnline } from "../lib/store.js";
import { refreshMySkills, levelToPct, LEVEL_LABELS } from "./skillsSync.js";

const bg = (label, promise) => { if (isBackendOnline()) promise.catch((err) => console.warn(`[learning] ${label} sync failed:`, err.message)); };

const DAY = 86400000;

// ---------- enrollments & progress ----------
export const enrollmentsFor = (userId) => load("enrollments").filter((e) => e.userId === userId);
export const getEnrollment = (userId, courseId) => load("enrollments").find((e) => e.userId === userId && e.courseId === courseId) || null;

export function enroll(userId, courseId, extra = {}) {
  let e = getEnrollment(userId, courseId);
  if (e) return e;
  e = { id: uid("e"), userId, courseId, completed: [], quiz: {}, submissions: {}, notes: {}, bookmarks: [], startedAt: Date.now(), lastLessonId: null, completedAt: null, lastActiveAt: Date.now(), dueAt: null, ...extra };
  load("enrollments").push(e);
  save("enrollments");
  bus.emit("course.enrolled", { userId, courseId });
  bg("enroll", api.enroll(courseId, extra.dueAt));
  return e;
}

export function courseProgress(userId, courseId) {
  const course = getCourse(courseId);
  const e = getEnrollment(userId, courseId);
  const lessons = course ? lessonsOf(course) : [];
  const ids = new Set(lessons.map((l) => l.id));
  const done = e ? e.completed.filter((id) => ids.has(id)).length : 0;
  const total = lessons.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct, enrolled: !!e, enrollment: e, status: !e ? "not-started" : pct >= 100 ? "completed" : done > 0 ? "in-progress" : "not-started" };
}

export function isLessonDone(e, lessonId) { return !!e?.completed.includes(lessonId); }

export function isLessonUnlocked(course, e, lessonId) {
  if (!course.sequential) return true;
  if (isLessonDone(e, lessonId)) return true;
  const ls = lessonsOf(course);
  const i = ls.findIndex((l) => l.id === lessonId);
  return i <= 0 || isLessonDone(e, ls[i - 1].id);
}

export function nextLesson(course, e) {
  return lessonsOf(course).find((l) => !isLessonDone(e, l.id) && isLessonUnlocked(course, e, l.id)) || null;
}

export function completeLesson(userId, courseId, lessonId) {
  const course = getCourse(courseId);
  const e = enroll(userId, courseId);
  const before = snapshot(userId, courseId);
  const already = e.completed.includes(lessonId);
  if (!already) e.completed.push(lessonId);
  e.lastLessonId = lessonId;
  e.lastActiveAt = Date.now();
  const all = lessonsOf(course);
  const finished = all.length > 0 && all.every((l) => e.completed.includes(l.id));
  let certificate = null;
  if (finished && !e.completedAt) {
    e.completedAt = Date.now();
    certificate = issueCertificate(userId, courseId);
  }
  save("enrollments");
  const after = snapshot(userId, courseId);
  const result = {
    already, courseBefore: before.pct, courseAfter: after.pct, courseCompleted: finished && !!certificate, certificate,
    next: nextLesson(course, e),
    // Instant estimate for the completion card using the same deterministic rules the backend applies; the
    // authoritative standing is re-pulled from /me/skills once the progress save lands (refreshMySkills below).
    skills: already ? [] : projectedGain(userId, course, lessonId, finished).map((g) => {
      const cur = before.skills.find((b) => b.skill.id === g.skill.id);
      const from = cur?.level ?? 0;
      return { skill: g.skill, before: from, level: Math.min(100, from + g.gain), target: cur?.target ?? levelToPct(3) };
    }).filter((s) => s.level > s.before),
    journeys: after.journeys.map((j) => ({ ...j, before: before.journeys.find((b) => b.id === j.id)?.pct ?? j.pct })).filter((j) => j.pct > j.before),
    unlocked: null,
  };
  result.unlocked = result.next && !already ? result.next : null;
  if (!already) bus.emit("lesson.completed", { userId, courseId, lessonId, ...result });
  if (result.courseCompleted) bus.emit("course.completed", { userId, courseId });
  if (!already && isBackendOnline()) {
    api.updateLessonProgress(lessonId, { complete: true }).then((server) => {
      // Reconcile to the backend's authoritative certificate number (issued a moment after the instant local one).
      if (server?.certificateId && result.certificate && server.certificateId !== result.certificate.id) {
        const cert = load("certificates").find((c) => c.id === result.certificate.id);
        if (cert) { cert.id = server.certificateId; save("certificates"); }
        // Anything already showing the provisional number (the completion card) swaps to the real one.
        bus.emit("certificate.reconciled", { from: result.certificate.id, to: server.certificateId, userId, courseId });
      }
      refreshMySkills();
    }).catch((err) => console.warn("[learning] progress sync failed:", err.message));
  }
  return result;
}

function snapshot(userId, courseId) {
  return {
    pct: courseProgress(userId, courseId).pct,
    skills: userSkills(userId).map((s) => ({ skill: s.skill, level: s.level, target: s.target })),
    journeys: journeysFor(userId).filter((j) => j.nodes.some((n) => n.courseId === courseId)).map((j) => ({ id: j.id, title: j.title, pct: j.pct })),
  };
}

export function saveQuizResult(userId, courseId, lessonId, { score, passed, answers }) {
  const e = enroll(userId, courseId);
  const prev = e.quiz[lessonId];
  e.quiz[lessonId] = { score: Math.max(score, prev?.score ?? 0), last: score, passed: passed || !!prev?.passed, attempts: (prev?.attempts || 0) + 1, at: Date.now() };
  save("enrollments");
  bus.emit("quiz.completed", { userId, courseId, lessonId, score, passed });
  // The answers go along so the backend can score the attempt itself; it never trusts a client-reported score.
  bg("quiz attempt", api.submitQuizAttempt(lessonId, { responses: answers || null, score, passed }).then(refreshMySkills)); // passed quiz = assessed evidence
}

export function submitAssignment(userId, courseId, lessonId, text) {
  const e = enroll(userId, courseId);
  e.submissions[lessonId] = { text, at: Date.now(), status: "submitted", feedback: "" };
  save("enrollments");
  bus.emit("assignment.submitted", { userId, courseId, lessonId });
  bg("assignment submission", api.submitAssignment(lessonId, text).then(refreshMySkills));
}

export function setNote(userId, courseId, lessonId, text) {
  const e = enroll(userId, courseId);
  e.notes[lessonId] = text;
  save("enrollments");
}
export function toggleBookmark(userId, courseId, lessonId) {
  const e = enroll(userId, courseId);
  const i = e.bookmarks.indexOf(lessonId);
  i >= 0 ? e.bookmarks.splice(i, 1) : e.bookmarks.push(lessonId);
  save("enrollments");
  return i < 0;
}

// ---------- skills ----------
// Each row: { skill, level (progress %), target (%), gap, contributors[{course, gain, pct}], currentLevel (1-4),
// levelLabel, targetLevel, evidence[], improving, source: "backend" | "projected" }.
// The backend's stored UserSkill rows (hydrated by skillsSync.js) are the source of truth. The projection below
// is only a fallback for an offline session / before the first hydration, and applies the same deterministic
// rules as the server (see SkillService.recalculate) — it never invents a base level.
export function userSkills(userId) {
  const rows = load("userSkills").filter((r) => r.userId === userId);
  if (rows.length) return fromBackendRows(userId, rows);
  return projectedSkills(userId);
}

const skillById = (id) => load("skills").find((s) => s.id === id) || { id, name: id, description: "", category: "General" };

function fromBackendRows(userId, rows) {
  return rows.map((r) => {
    const skill = skillById(r.skillId);
    const target = levelToPct(r.targetLevel || 3);
    const level = Math.min(100, r.progressPercentage || 0);
    const contributors = (r.courseIds || []).map((id) => getCourse(id)).filter(Boolean).map((course) => {
      const lessonIds = new Set(lessonsOf(course).map((l) => l.id));
      const gain = (r.evidence || []).filter((ev) => ev.refId === course.id || lessonIds.has(ev.refId)).reduce((n, ev) => n + (ev.points || 0), 0);
      return { course, gain, pct: courseProgress(userId, course.id).pct };
    });
    return { skill, level, base: 0, target, gap: Math.max(0, target - level), contributors, currentLevel: r.currentLevel || 1, levelLabel: r.levelLabel || LEVEL_LABELS[r.currentLevel || 1], targetLevel: r.targetLevel || 3, evidence: r.evidence || [], improving: !!r.improving, source: "backend" };
  });
}

/** Points a lesson completion earns per skill, by the shared rule: an explicitly mapped lesson → its contribution;
 *  an unmapped lesson → an equal share of each course-skill weight; finishing the course → the remainder. */
export function projectedGain(userId, course, lessonId, finished) {
  const ls = lessonsOf(course);
  const lesson = ls.find((l) => l.id === lessonId);
  const cs = course.skills || [];
  const gains = {};
  const add = (id, n) => { if (n > 0) gains[id] = (gains[id] || 0) + n; };
  const own = lesson?.skills || [];
  if (own.length) own.forEach((m) => add(m.skillId, m.contribution || 10));
  else cs.forEach((s) => add(s.skillId, Math.floor((s.points || 30) / Math.max(1, ls.length))));
  if (finished) {
    const e = getEnrollment(userId, course.id);
    cs.forEach((s) => {
      const unmappedDone = ls.filter((l) => e?.completed.includes(l.id) && !(l.skills || []).length).length;
      add(s.skillId, Math.max(0, (s.points || 30) - unmappedDone * Math.floor((s.points || 30) / Math.max(1, ls.length))));
    });
  }
  return Object.entries(gains).map(([id, gain]) => ({ skill: skillById(id), gain }));
}

function projectedSkills(userId) {
  const points = {}, contributors = {}, targets = {}, assessed = new Set();
  enrollmentsFor(userId).forEach((e) => {
    const c = getCourse(e.courseId);
    if (!c) return;
    const ls = lessonsOf(c);
    const cs = c.skills || [];
    const share = {};
    const add = (id, n) => { if (n <= 0) return; points[id] = (points[id] || 0) + n; (contributors[id] ||= new Map()).set(c.id, (contributors[id].get(c.id) || 0) + n); };
    cs.forEach((s) => (targets[s.skillId] = Math.max(targets[s.skillId] || 0, s.targetLevel || 3)));
    ls.filter((l) => e.completed.includes(l.id)).forEach((l) => {
      const own = l.skills || [];
      if (own.length) own.forEach((m) => add(m.skillId, m.contribution || 10));
      else cs.forEach((s) => { const g = Math.floor((s.points || 30) / ls.length); add(s.skillId, g); share[s.skillId] = (share[s.skillId] || 0) + g; });
      if (e.quiz?.[l.id]?.passed) (own.length ? own.map((m) => m.skillId) : cs.map((s) => s.skillId)).forEach((id) => { assessed.add(id); add(id, Math.round((15 * (e.quiz[l.id].score || 70)) / 100)); });
    });
    if (e.completedAt) cs.forEach((s) => add(s.skillId, Math.max(0, (s.points || 30) - (share[s.skillId] || 0))));
  });
  const ids = new Set([...Object.keys(targets), ...Object.keys(points)]);
  return load("skills").filter((s) => s.active !== false && ids.has(s.id)).map((skill) => {
    const level = Math.min(100, points[skill.id] || 0);
    const targetLevel = targets[skill.id] || 3;
    const target = levelToPct(targetLevel);
    const currentLevel = level >= 80 && assessed.has(skill.id) ? 4 : level >= 55 && assessed.has(skill.id) ? 3 : level >= 25 ? 2 : 1;
    const contribs = [...(contributors[skill.id] || new Map()).entries()].map(([cid, gain]) => ({ course: getCourse(cid), gain, pct: courseProgress(userId, cid).pct })).filter((x) => x.course);
    return { skill, level, base: 0, target, gap: Math.max(0, target - level), contributors: contribs, currentLevel, levelLabel: LEVEL_LABELS[currentLevel], targetLevel, evidence: [], improving: false, source: "projected" };
  });
}

// ---------- journeys ----------
export function journeysFor(userId) {
  return load("journeys").map((j) => {
    const byId = Object.fromEntries(j.nodes.map((n) => [n.id, n]));
    const resolved = {};
    const resolve = (n) => {
      if (resolved[n.id]) return resolved[n.id];
      const reqs = n.requires.map((r) => resolve(byId[r]));
      const prereqsDone = reqs.every((r) => r.status === "completed");
      let pct = 0, status, course = null;
      if (n.type === "course") {
        course = getCourse(n.courseId);
        pct = courseProgress(userId, n.courseId).pct;
        status = pct >= 100 ? "completed" : pct > 0 ? "in-progress" : prereqsDone ? "available" : "locked";
      } else {
        pct = reqs.length ? Math.round(reqs.reduce((a, r) => a + r.pct, 0) / reqs.length) : 0;
        status = prereqsDone ? "completed" : pct > 0 ? "in-progress" : "locked";
      }
      const depth = reqs.length ? Math.max(...reqs.map((r) => r.depth)) + 1 : 0;
      return (resolved[n.id] = { ...n, course, title: n.title || (course ? courseTitle(course) : ""), pct, status, depth, prereqTitles: n.requires.map((r) => byId[r].title || courseTitle(getCourse(byId[r].courseId) || { title: "" })) });
    };
    const nodes = j.nodes.map(resolve);
    const pct = Math.round(nodes.reduce((a, n) => a + n.pct, 0) / nodes.length);
    return { ...j, nodes, pct };
  });
}

// ---------- home / recommendations ----------
export function continueLearning(userId) {
  return enrollmentsFor(userId)
    .map((e) => ({ e, course: getCourse(e.courseId) }))
    .filter(({ course, e }) => course && courseProgress(userId, e.courseId).status !== "completed")
    .map(({ e, course }) => ({ course, enrollment: e, progress: courseProgress(userId, course.id), next: nextLesson(course, e) }))
    .sort((a, b) => (b.progress.done > 0) - (a.progress.done > 0) || (b.enrollment.lastActiveAt || 0) - (a.enrollment.lastActiveAt || 0));
}

export function dueSoon(userId) {
  return continueLearning(userId).filter((x) => x.enrollment.dueAt).sort((a, b) => a.enrollment.dueAt - b.enrollment.dueAt);
}

export function recommended(userId, limit = 3) {
  const skills = userSkills(userId);
  return listCourses({ status: "published" })
    .filter((c) => !getEnrollment(userId, c.id) && (c.visibility || "catalog") === "catalog")
    .map((course) => {
      let best = null, score = 0;
      course.skills.forEach((s) => {
        const sk = skills.find((x) => x.skill.id === s.skillId);
        if (sk && sk.gap > 0) { score += sk.gap; if (!best || sk.gap > best.gap) best = sk; }
      });
      return { course, score, reason: best ? `Closes your ${best.skill.name} gap` : "Popular with your team" };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------- certificates ----------
export const allCertificates = () => load("certificates");
export const certificatesFor = (userId) => load("certificates").filter((c) => c.userId === userId).sort((a, b) => b.issuedAt - a.issuedAt);

export function certStatus(cert) {
  if (cert.revoked) return "revoked";
  if (cert.expiresAt && cert.expiresAt < Date.now()) return "expired";
  if (cert.expiresAt && cert.expiresAt - Date.now() < 60 * DAY) return "expiring";
  return "valid";
}

export function issueCertificate(userId, courseId) {
  const existing = load("certificates").find((c) => c.userId === userId && c.courseId === courseId && !c.revoked && certStatus(c) !== "expired");
  if (existing) return existing;
  const course = getCourse(courseId);
  const now = Date.now();
  const code = `WE360-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const cert = { id: code, userId, courseId, issuedAt: now, expiresAt: course.certExpiryMonths ? now + course.certExpiryMonths * 30.4 * DAY : null, revoked: false };
  load("certificates").unshift(cert);
  save("certificates");
  notify(userId, { kind: "achievement", title: `You earned the ${courseTitle(course)} certificate`, body: "Your certificate is ready to view and share.", href: "/certificates" });
  bus.emit("certificate.issued", { userId, courseId, certificateId: code });
  return cert;
}

// Verification architecture: a public lookup by ID (later: signed QR / verifiable credential).
export function verifyCertificate(code) {
  const cert = load("certificates").find((c) => c.id.toLowerCase() === String(code).trim().toLowerCase());
  if (!cert) return null;
  return { cert, status: certStatus(cert), user: userById(cert.userId), course: getCourse(cert.courseId) };
}

/** Backend-authoritative verification (public endpoint, no sign-in needed). Resolves to the same shape as
 *  verifyCertificate(), null when the number is unknown, and only falls back to the local cache when the
 *  backend can't be reached at all (never as a substitute for a definitive "not found"). */
export async function verifyCertificateRemote(code) {
  try {
    const c = await api.verifyCertificate(String(code).trim());
    const cert = { id: c.certificateNumber, userId: c.userId, courseId: c.courseId, issuedAt: new Date(c.issuedAt).getTime(), expiresAt: c.expiresAt ? new Date(c.expiresAt).getTime() : null, revoked: c.status === "REVOKED",
      recipientName: c.recipientName, courseTitle: c.courseTitle, instructorName: c.instructorName, issuer: c.issuer };
    return { cert, status: c.status.toLowerCase(), user: userById(c.userId), course: getCourse(c.courseId), source: "backend" };
  } catch (err) {
    if (err?.status === 404) return null;
    if (err?.status === 0) { const local = verifyCertificate(code); return local ? { ...local, source: "local" } : null; }
    throw err;
  }
}

export function renewCertificate(id) {
  const cert = load("certificates").find((c) => c.id === id);
  const course = cert && getCourse(cert.courseId);
  if (!cert || !course?.certExpiryMonths) return;
  cert.issuedAt = Date.now();
  cert.expiresAt = Date.now() + course.certExpiryMonths * 30.4 * DAY;
  save("certificates");
  bg("certificate renewal", api.renewCertificate(id));
}

// ---------- achievements ----------
export function achievements(userId) {
  const u = userById(userId);
  const es = enrollmentsFor(userId);
  const completedLessons = es.reduce((n, e) => n + e.completed.length, 0);
  const completedCourses = es.filter((e) => e.completedAt).length;
  const bestQuiz = Math.max(0, ...es.flatMap((e) => Object.values(e.quiz).map((q) => q.score)));
  const posts = load("posts");
  const contributions = posts.filter((p) => p.authorId === userId).length + posts.reduce((n, p) => n + p.comments.filter((c) => c.authorId === userId).length, 0);
  const topSkill = Math.max(0, ...userSkills(userId).map((s) => s.level));
  return [
    { id: "first-lesson", title: "First steps", desc: "Complete your first lesson", icon: "play", earned: completedLessons >= 1, hint: `${Math.min(completedLessons, 1)}/1` },
    { id: "first-course", title: "Course complete", desc: "Finish a whole course", icon: "cap", earned: completedCourses >= 1, hint: `${Math.min(completedCourses, 1)}/1` },
    { id: "quiz-ace", title: "Quiz ace", desc: "Score 90% or higher on a quiz", icon: "star", earned: bestQuiz >= 90, hint: bestQuiz ? `Best ${bestQuiz}%` : "No quizzes yet" },
    { id: "streak", title: "On a roll", desc: "Learn 3 days in a row", icon: "flame", earned: (u?.streak || 0) >= 3, hint: `${u?.streak || 0}/3 days` },
    { id: "explorer", title: "Explorer", desc: "Enrol in 3 courses", icon: "compass", earned: es.length >= 3, hint: `${Math.min(es.length, 3)}/3` },
    { id: "contributor", title: "Community voice", desc: "Post or reply in the community", icon: "message", earned: contributions >= 1, hint: `${Math.min(contributions, 1)}/1` },
    { id: "skilled", title: "Skill builder", desc: "Reach 80% in any skill", icon: "target", earned: topSkill >= 80, hint: `Top skill ${topSkill}%` },
  ];
}
