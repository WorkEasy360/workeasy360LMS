// Reusable visual learning journey for one course: Course → Modules → Lessons → Practice → Skills → Certificate.
// Every node carries a state (completed / current / available / locked), its prerequisites, progress and the
// next action, so the learner can always answer "what should I do next?". Reuses the .jnode styles and state
// colours from the Journeys page; animations only communicate state (flowing edge = where progress goes next,
// pulse = the current step) and are disabled under prefers-reduced-motion.
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "./Button.js";
import { Badge } from "./Badge.js";
import { ProgressRing } from "./Progress.js";
import { load } from "../lib/store.js";
import { lessonsOf, courseTitle, LESSON_TYPES } from "../services/courses.js";
import { courseProgress, getEnrollment, isLessonDone, isLessonUnlocked, nextLesson, userSkills, certificatesFor, certStatus } from "../services/learning.js";

const STATUS_CLASS = { completed: "is-completed", current: "is-in-progress is-current", available: "is-available", locked: "is-locked" };
const STATUS_LABEL = { completed: "Completed", current: "In progress", available: "Available", locked: "Locked" };

/** Pure: builds the node graph for a user + course. Exported so tests and other screens can reason about it. */
export function buildJourney(user, course) {
  const e = getEnrollment(user.id, course.id);
  const p = courseProgress(user.id, course.id);
  const ls = lessonsOf(course);
  const next = e ? nextLesson(course, e) : ls[0] || null;
  const learnHref = (l) => `/learn/${course.id}${l ? "/" + l.id : ""}`;
  const skillRows = userSkills(user.id);
  const cert = certificatesFor(user.id).find((c) => c.courseId === course.id && certStatus(c) !== "revoked");
  const stages = [];

  stages.push({ id: "course", label: "Course", nodes: [{
    id: "course", type: "course", title: courseTitle(course), icon: course.cover?.icon || "book", pct: p.pct,
    status: p.status === "completed" ? "completed" : p.done > 0 ? "current" : "available",
    prereqs: [], detail: e ? `${p.done} of ${p.total} lessons complete` : "Enrol to start",
    action: { label: p.status === "completed" ? "Review course" : p.done ? "Continue" : e ? "Start" : "Enrol & start", href: learnHref(next) },
  }] });

  const moduleNodes = course.modules.map((m, i) => {
    const done = m.lessons.filter((l) => isLessonDone(e, l.id)).length;
    const total = m.lessons.length;
    const firstUnlocked = m.lessons.some((l) => e && isLessonUnlocked(course, e, l.id)) || (!e && i === 0) || !course.sequential;
    const status = total && done === total ? "completed" : m.lessons.some((l) => l.id === next?.id) ? "current" : firstUnlocked ? "available" : "locked";
    const prevTitle = i > 0 ? course.modules[i - 1].title : null;
    return { id: "m:" + m.id, type: "module", title: m.title, icon: "layers", pct: total ? Math.round((done / total) * 100) : 0, status,
      prereqs: course.sequential && prevTitle ? [prevTitle] : [], detail: `${done}/${total} lessons`,
      action: status === "locked" ? null : { label: status === "completed" ? "Review module" : "Open module", href: learnHref(m.lessons.find((l) => !isLessonDone(e, l.id)) || m.lessons[0]) } };
  });
  if (moduleNodes.length) stages.push({ id: "modules", label: "Modules", nodes: moduleNodes });

  const lessonNodes = ls.map((l, i) => {
    const done = isLessonDone(e, l.id);
    const unlocked = e ? isLessonUnlocked(course, e, l.id) : !course.sequential || i === 0;
    const status = done ? "completed" : l.id === next?.id ? "current" : unlocked ? "available" : "locked";
    const t = LESSON_TYPES[l.type] || LESSON_TYPES.lesson;
    return { id: "l:" + l.id, type: "lesson", lessonType: l.type, title: l.title, icon: t.icon, pct: done ? 100 : 0, status,
      prereqs: course.sequential && i > 0 ? [ls[i - 1].title] : [], detail: `${t.label} · ${l.duration || 0} min`,
      action: status === "locked" ? null : { label: done ? "Review lesson" : "Open lesson", href: learnHref(l) } };
  });
  if (lessonNodes.length) stages.push({ id: "lessons", label: "Lessons", nodes: lessonNodes });

  const practiceNodes = ls.filter((l) => l.type === "quiz" || l.type === "assignment").map((l) => {
    const quiz = e?.quiz?.[l.id], sub = e?.submissions?.[l.id];
    const base = lessonNodes.find((n) => n.id === "l:" + l.id);
    const passed = l.type === "quiz" ? !!quiz?.passed : sub?.status === "reviewed";
    const attempted = l.type === "quiz" ? !!quiz : !!sub;
    const status = passed || base.status === "completed" ? "completed" : attempted || base.status === "current" ? "current" : base.status;
    const detail = l.type === "quiz" ? (quiz ? `Best score ${quiz.score}%${quiz.passed ? " · passed" : ""}` : `Pass mark ${l.quiz?.passScore ?? 70}%`) : sub ? (sub.status === "reviewed" ? "Reviewed" : "Submitted — awaiting review") : "Submit your work";
    return { ...base, id: "p:" + l.id, type: "practice", icon: l.type === "quiz" ? "clipboard" : "edit", status, detail, pct: passed ? 100 : attempted ? 50 : 0 };
  });
  if (practiceNodes.length) stages.push({ id: "practice", label: "Practice", nodes: practiceNodes });

  const skillNodes = (course.skills || []).map((s) => {
    const row = skillRows.find((x) => x.skill.id === s.skillId);
    const level = row?.level || 0;
    const target = row?.target ?? 55;
    const status = level >= target && level > 0 ? "completed" : level > 0 ? "current" : e ? "available" : "locked";
    const lib = load("skills").find((x) => x.id === s.skillId);
    return { id: "s:" + s.skillId, type: "skill", title: row?.skill.name || lib?.name || s.skillId, icon: lib?.icon || "target", pct: level, status,
      prereqs: [courseTitle(course)], detail: row ? `${row.levelLabel || "Novice"} · ${level}%` : "Not started",
      action: { label: "See my skills", href: "/skills" } };
  });
  if (skillNodes.length) stages.push({ id: "skills", label: "Skills", nodes: skillNodes });

  stages.push({ id: "certificate", label: "Certificate", nodes: [{
    id: "certificate", type: "certificate", title: "Certificate of completion", icon: "award", pct: cert ? 100 : p.pct,
    status: cert ? "completed" : p.pct >= 100 ? "available" : p.done > 0 ? "current" : "locked",
    prereqs: ["Complete every lesson"], detail: cert ? `Issued · ${cert.id}` : `${p.pct}% of the way there`,
    action: cert ? { label: "View certificate", href: "/certificates" } : null,
  }] });

  const nextAction = p.status === "completed"
    ? { label: cert ? "View your certificate" : "Review the course", href: cert ? "/certificates" : learnHref(ls[0]), why: "You've finished every lesson." }
    : next ? { label: `${p.done ? "Continue with" : "Start with"} “${next.title}”`, href: learnHref(next), why: e ? `${p.total - p.done} lessons left in this course.` : "Enrolling takes one click." }
    : { label: "Explore courses", href: "/explore", why: "This course has no lessons yet." };
  return { stages, next: nextAction, progress: p, enrolled: !!e };
}

/**
 * LearningJourney({ user, course, onNavigate }) → element with .refresh() to re-render after progress changes.
 * Marks nodes with data-lj-node / data-lj-status so tests and guides can read the state.
 */
export function LearningJourney({ user, course, onNavigate, compact = false }) {
  let selectedId = null;
  let prevStatus = new Map();
  const root = h("div", { class: ["lj", compact && "lj-compact"], "data-guide-target": "course.journey", "aria-label": `Learning journey for ${courseTitle(course)}` });

  const go = (href) => (onNavigate ? onNavigate(href) : (location.hash = "#" + href));

  function nodeEl(n, flowsNext) {
    const changed = prevStatus.size && prevStatus.get(n.id) !== n.status;
    return h("button", {
      class: ["jnode", "jnode-sm", STATUS_CLASS[n.status], n.id === selectedId && "is-selected", changed && n.status === "completed" && "is-just-completed", changed && n.status !== "locked" && prevStatus.get(n.id) === "locked" && "is-just-unlocked"],
      type: "button", "data-lj-node": n.id, "data-lj-status": n.status, "aria-pressed": String(n.id === selectedId),
      "aria-label": `${n.title}, ${STATUS_LABEL[n.status]}, ${n.pct}%`, onclick: () => { selectedId = n.id; draw(); },
    }, [
      h("span", { class: "jnode-icon" }, ico(n.status === "completed" ? "check" : n.status === "locked" ? "lock" : n.icon, 18)),
      h("span", { class: "jnode-body" }, [h("span", { class: "jnode-title" }, n.title), h("span", { class: "xs jnode-sub" }, n.status === "completed" ? "Completed" : n.status === "locked" ? "Locked" : n.status === "current" ? "In progress" : n.detail)]),
      n.status !== "locked" && n.type !== "lesson" && h("span", { class: "jnode-bar" }, h("span", { style: `width:${n.pct}%` })),
    ]);
  }

  function detail(n) {
    if (!n) return null;
    return h("div", { class: "lj-detail card card-pad-sm", "aria-live": "polite" }, [
      h("div", { class: "row" }, [
        ProgressRing(n.pct, { size: 48, stroke: 6, color: n.status === "completed" ? "var(--c-success)" : "var(--c-primary)" }),
        h("div", { class: "grow" }, [h("div", { class: "eyebrow" }, n.type), h("div", { class: "strong" }, n.title), h("div", { class: "small muted" }, n.detail)]),
        Badge(STATUS_LABEL[n.status], n.status === "completed" ? "success" : n.status === "current" ? "primary" : n.status === "locked" ? "" : "teal"),
      ]),
      n.prereqs.length > 0 && h("div", { class: "xs muted" }, ["Requires: ", n.prereqs.join(", ")]),
      n.action && n.status !== "locked" && Button({ label: n.action.label, size: "sm", variant: "secondary", icon: "arrow-right", onClick: () => go(n.action.href) }),
      n.status === "locked" && h("div", { class: "xs muted" }, "Finish the prerequisite first — this unlocks automatically."),
    ]);
  }

  function draw() {
    const j = buildJourney(user, course);
    const all = j.stages.flatMap((s) => s.nodes);
    const sel = all.find((n) => n.id === selectedId) || null;
    const rows = [];
    j.stages.forEach((stage, i) => {
      if (i > 0) {
        const prev = j.stages[i - 1];
        const prevDone = prev.nodes.every((n) => n.status === "completed");
        const flowing = prev.nodes.some((n) => n.status === "completed" || n.status === "current") && stage.nodes.some((n) => n.status === "current" || n.status === "available");
        rows.push(h("div", { class: ["lj-edge", prevDone && "is-done", !prevDone && flowing && "is-flow"], "aria-hidden": "true" }));
      }
      rows.push(h("div", { class: "lj-stage", role: "group", "aria-label": stage.label }, [
        h("div", { class: "lj-stage-label" }, [h("span", { class: "eyebrow" }, stage.label), h("span", { class: "xs muted" }, `${stage.nodes.filter((n) => n.status === "completed").length}/${stage.nodes.length} done`)]),
        h("div", { class: "lj-nodes" }, stage.nodes.map((n) => nodeEl(n))),
      ]));
    });
    root.replaceChildren(
      h("div", { class: "lj-next card card-pad-sm" }, [
        h("div", { class: "grow" }, [h("div", { class: "eyebrow" }, "What should I do next?"), h("div", { class: "strong" }, j.next.label), h("div", { class: "xs muted" }, j.next.why)]),
        Button({ label: j.progress.status === "completed" ? "Open" : "Go", icon: "arrow-right", variant: "primary", size: "sm", attrs: { "data-guide-target": "journey.next" }, onClick: () => go(j.next.href) }),
      ]),
      h("div", { class: "lj-track" }, rows),
      detail(sel),
    );
    prevStatus = new Map(all.map((n) => [n.id, n.status]));
  }

  draw();
  root.refresh = draw;
  return root;
}
