// Lightweight analytics computed from local data (swap for API-backed aggregates later).
import { load } from "../lib/store.js";
import { listCourses, lessonsOf, getCourse, courseTitle } from "./courses.js";
import { courseProgress, allCertificates, certStatus, userSkills, enrollmentsFor } from "./learning.js";
import { users, userById } from "./people.js";

const DAY = 86400000;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

export function activitySeries(days = 30) {
  // Deterministic pseudo-activity anchored to real enrollment volume.
  const base = Math.max(8, load("enrollments").length);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * DAY);
    const wk = d.getDay();
    const weekend = wk === 0 || wk === 6 ? 0.35 : 1;
    const wobble = 0.75 + 0.5 * Math.abs(Math.sin(i * 1.7 + 2));
    return { date: d, value: Math.round(base * 1.4 * weekend * wobble + i * 0.25) };
  });
}

export function orgStats() {
  const us = users().filter((u) => u.role === "learner");
  const es = load("enrollments");
  const now = Date.now();
  const active = us.filter((u) => enrollmentsFor(u.id).some((e) => e.lastActiveAt && now - e.lastActiveAt < 7 * DAY)).length;
  const completedEnrolls = es.filter((e) => e.completedAt).length;
  const scores = es.flatMap((e) => Object.values(e.quiz).map((q) => q.score));
  const readiness = avg(us.flatMap((u) => userSkills(u.id).map((s) => Math.min(100, (s.level / Math.max(1, s.target)) * 100))));
  const certs = allCertificates();
  const byStatus = { valid: 0, expiring: 0, expired: 0, revoked: 0 };
  certs.forEach((c) => byStatus[certStatus(c)]++);
  return {
    learners: us.length, active, activePct: pct(active, us.length),
    enrollments: es.length, completions: completedEnrolls,
    completionRate: pct(completedEnrolls, es.length),
    avgScore: Math.round(avg(scores)), skillReadiness: Math.round(readiness),
    courses: listCourses({ status: "published" }).length, drafts: listCourses({ status: "draft" }).length,
    certs: certs.length, certsByStatus: byStatus,
    lessonProgress: pct(es.reduce((n, e) => n + e.completed.length, 0), es.reduce((n, e) => n + lessonsOf(getCourse(e.courseId) || { modules: [] }).length, 0)),
  };
}

export function byDepartment() {
  const depts = {};
  users().filter((u) => u.role === "learner").forEach((u) => {
    const d = (depts[u.dept] ||= { dept: u.dept, people: 0, pct: [] });
    d.people++;
    enrollmentsFor(u.id).forEach((e) => d.pct.push(courseProgress(u.id, e.courseId).pct));
  });
  return Object.values(depts).map((d) => ({ dept: d.dept, people: d.people, pct: Math.round(avg(d.pct)) })).sort((a, b) => b.pct - a.pct);
}

export function courseStats(course) {
  const es = load("enrollments").filter((e) => e.courseId === course.id);
  const ls = lessonsOf(course);
  const scores = es.flatMap((e) => Object.values(e.quiz).map((q) => q.score));
  return {
    course, enrolled: es.length,
    completed: es.filter((e) => e.completedAt).length,
    avgProgress: Math.round(avg(es.map((e) => courseProgress(e.userId, course.id).pct))),
    avgScore: Math.round(avg(scores)),
    funnel: ls.map((l) => ({ lesson: l, pct: pct(es.filter((e) => e.completed.includes(l.id)).length, es.length) })),
  };
}

export const topCourses = () => listCourses({ status: "published" }).map(courseStats).sort((a, b) => b.enrolled - a.enrolled);

export function pendingReviews(instructorId) {
  const mine = new Set(listCourses({ instructorId }).map((c) => c.id));
  const out = [];
  load("enrollments").forEach((e) => {
    if (!mine.has(e.courseId)) return;
    Object.entries(e.submissions).forEach(([lessonId, s]) => {
      if (s.status === "submitted") {
        const course = getCourse(e.courseId);
        out.push({ enrollment: e, user: userById(e.userId), course, lesson: lessonsOf(course).find((l) => l.id === lessonId), lessonId, submission: s });
      }
    });
  });
  return out;
}

export function attentionItems() {
  const now = Date.now();
  const items = [];
  load("enrollments").forEach((e) => {
    const u = userById(e.userId), c = getCourse(e.courseId);
    if (!u || !c) return;
    const p = courseProgress(e.userId, e.courseId);
    if (e.dueAt && e.dueAt < now && p.status !== "completed") items.push({ kind: "overdue", severity: "danger", user: u, course: c, text: `${u.name} is overdue on ${courseTitle(c)}` });
    else if (e.dueAt && e.dueAt - now < 5 * DAY && p.pct < 50 && p.status !== "completed") items.push({ kind: "due", severity: "warning", user: u, course: c, text: `${u.name} is due soon on ${courseTitle(c)} (${p.pct}%)` });
  });
  allCertificates().forEach((cert) => {
    const s = certStatus(cert), u = userById(cert.userId), c = getCourse(cert.courseId);
    if (s === "expired") items.push({ kind: "cert", severity: "danger", user: u, course: c, text: `${u?.name}'s ${courseTitle(c)} certificate has expired` });
    if (s === "expiring") items.push({ kind: "cert", severity: "warning", user: u, course: c, text: `${u?.name}'s ${courseTitle(c)} certificate expires soon` });
  });
  return items.sort((a, b) => (a.severity === "danger" ? -1 : 1) - (b.severity === "danger" ? -1 : 1));
}

export function learnerStats(userId) {
  const es = enrollmentsFor(userId);
  const minutes = es.reduce((n, e) => n + lessonsOf(getCourse(e.courseId) || { modules: [] }).filter((l) => e.completed.includes(l.id)).reduce((m, l) => m + (l.duration || 0), 0), 0);
  const scores = es.flatMap((e) => Object.values(e.quiz).map((q) => q.score));
  return {
    lessons: es.reduce((n, e) => n + e.completed.length, 0), minutes,
    courses: es.filter((e) => e.completedAt).length, inProgress: es.filter((e) => !e.completedAt).length,
    avgScore: Math.round(avg(scores)), scoreCount: scores.length,
  };
}

// Guide analytics: opened / started / completed / abandoned / step drop-off / time to complete
export function guideStats(guideId) {
  const ev = load("guideAnalytics").filter((e) => e.guideId === guideId);
  const count = (t) => ev.filter((e) => e.event === t).length;
  const started = count("guide.started"), completed = count("guide.completed");
  const durations = ev.filter((e) => e.event === "guide.completed" && e.durationMs).map((e) => e.durationMs);
  const stepReach = {};
  ev.filter((e) => e.event === "step.completed").forEach((e) => (stepReach[e.step] = (stepReach[e.step] || 0) + 1));
  return { opened: count("guide.opened"), started, completed, abandoned: count("guide.abandoned"), helpRequested: count("help.requested"), completionRate: pct(completed, started), avgMs: avg(durations), stepReach };
}
