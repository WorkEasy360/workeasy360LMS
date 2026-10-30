// Instructor pages: Assessments and Learners.
import { h, timeAgo, pluralize } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card, SectionTitle, StatCard } from "../components/Card.js";
import { Badge, Avatar } from "../components/Badge.js";
import { Progress } from "../components/Progress.js";
import { EmptyState } from "../components/States.js";
import { Textarea, Field } from "../components/Form.js";
import { openModal, toast } from "../components/Overlay.js";
import { listCourses, lessonsOf, courseTitle } from "../services/courses.js";
import { pendingReviews } from "../services/analytics.js";
import { load } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { hydrateCourseEnrollments } from "../services/learningSync.js";
import { courseProgress } from "../services/learning.js";
import { reviewSubmission } from "../services/review.js";
import { userById } from "../services/people.js";

export function AssessmentsPage(ctx) {
  const host = h("div", { class: "stack-lg" });
  function draw() {
    const courses = listCourses(ctx.user.role === "admin" ? {} : { instructorId: ctx.user.id });
    const rows = courses.flatMap((c) => lessonsOf(c).filter((l) => l.type === "quiz" || l.type === "assignment").map((l) => {
      const es = load("enrollments").filter((e) => e.courseId === c.id);
      const scores = es.map((e) => e.quiz[l.id]?.score).filter((s) => s != null);
      const subs = es.map((e) => e.submissions[l.id]).filter(Boolean);
      return { c, l, attempts: l.type === "quiz" ? scores.length : subs.length, avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, pending: subs.filter((s) => s.status === "submitted").length };
    }));
    host.replaceChildren(
      PageHeader({ title: "Assessments", sub: "Every quiz and assignment across your courses.", actions: [Button({ label: "Open Course Builder", icon: "layers", href: "/courses" })] }),
      rows.length
        ? h("div", { class: "card table-wrap" }, h("table", { class: "table" }, [
          h("thead", {}, h("tr", {}, ["Assessment", "Course", "Type", "Content", "Responses", "Result", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows.map((r) => h("tr", {}, [
            h("td", { class: "strong" }, r.l.title), h("td", {}, courseTitle(r.c)), h("td", {}, Badge(r.l.type === "quiz" ? "Quiz" : "Assignment", r.l.type === "quiz" ? "info" : "primary")),
            h("td", { class: "small muted" }, r.l.type === "quiz" ? pluralize(r.l.quiz?.questions.length || 0, "question") : pluralize(r.l.assignment?.rubric.length || 0, "criterion", "criteria")),
            h("td", {}, String(r.attempts)), h("td", {}, r.l.type === "quiz" ? (r.avg != null ? `${r.avg}% avg` : "—") : r.pending ? Badge(`${r.pending} to review`, "warning") : "—"),
            h("td", {}, Button({ label: "Edit", size: "sm", icon: "edit", href: `/builder/${r.c.id}` })),
          ]))),
        ]))
        : Card(EmptyState({ icon: "clipboard", title: "No assessments yet", description: "Add a quiz or assignment lesson in the Course Builder.", action: Button({ label: "Go to courses", variant: "primary", href: "/courses" }) })),
    );
  }
  draw();
  hydrateCourseEnrollments().then(() => host.isConnected && draw());
  ["sync:learning", "data:courses"].forEach((ev) => bus.on(ev, () => host.isConnected && hydrateCourseEnrollments().then(() => host.isConnected && draw())));
  return { title: "Assessments", crumbs: [{ label: "Assessments" }], el: host };
}

export function LearnersPage(ctx) {
  const mine = new Set(listCourses(ctx.user.role === "admin" ? {} : { instructorId: ctx.user.id }).map((c) => c.id));
  const host = h("div", { class: "stack-lg" });

  function draw() {
    const reviews = pendingReviews(ctx.user.id);
    const byUser = {};
    load("enrollments").filter((e) => mine.has(e.courseId)).forEach((e) => (byUser[e.userId] ||= []).push(e));
    const people = Object.entries(byUser).map(([uid, es]) => {
      const u = userById(uid);
      const pcts = es.map((e) => courseProgress(uid, e.courseId).pct);
      const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
      const last = Math.max(0, ...es.map((e) => e.lastActiveAt || 0));
      const atRisk = (!last || Date.now() - last > 7 * 86400000) && avg < 60;
      return { u, es, avg, last, atRisk };
    }).filter((p) => p.u?.role === "learner").sort((a, b) => b.atRisk - a.atRisk || a.avg - b.avg);

    host.replaceChildren(
      PageHeader({ title: "Learners", sub: "Who's learning, who's stuck, and what's waiting for feedback." }),
      h("div", { class: "grid grid-3" }, [StatCard({ label: "Learners", value: people.length, icon: "users" }), StatCard({ label: "At risk", value: people.filter((p) => p.atRisk).length, icon: "alert", tone: people.some((p) => p.atRisk) ? "warning" : "", foot: "Inactive for a week and under 60%" }), StatCard({ label: "Awaiting review", value: reviews.length, icon: "upload", tone: reviews.length ? "warning" : "success" })]),
      h("section", {}, [SectionTitle("Assignments awaiting review"), reviews.length
        ? Card(reviews.map((r) => h("div", { class: "list-row" }, [Avatar(r.user), h("div", { class: "grow" }, [h("div", { class: "strong" }, `${r.user.name} — ${r.lesson?.title}`), h("div", { class: "small muted" }, `${courseTitle(r.course)} · submitted ${timeAgo(r.submission.at)}`)]), Button({ label: "Review", variant: "primary", size: "sm", onClick: () => openReview(r) })])), { pad: false, cls: "list-card" })
        : Card(EmptyState({ icon: "check-circle", title: "Nothing waiting on you" }))]),
      h("section", {}, [SectionTitle("All learners"), people.length
        ? h("div", { class: "card table-wrap" }, h("table", { class: "table" }, [
          h("thead", {}, h("tr", {}, ["Learner", "Courses", "Avg. progress", "Last active", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, people.map((p) => h("tr", {}, [
            h("td", {}, h("div", { class: "row-sm" }, [Avatar(p.u, "sm"), h("div", {}, [h("div", { class: "strong" }, p.u.name), h("div", { class: "xs muted" }, p.u.dept)])])),
            h("td", {}, String(p.es.length)), h("td", { style: "min-width:150px" }, h("div", { class: "row-sm" }, [h("div", { style: "flex:1" }, Progress(p.avg, { size: "sm" })), h("span", { class: "small strong" }, `${p.avg}%`)])),
            h("td", { class: "small muted" }, p.last ? timeAgo(p.last) : "Never"), h("td", {}, p.atRisk ? Badge("At risk", "warning", "alert") : null),
          ]))),
        ]))
        : Card(EmptyState({ icon: "users", title: "No learners yet", description: "Learners appear once they enrol in your published courses." }))]),
    );
  }

  function openReview(r) {
    const fb = Textarea({ rows: 3, placeholder: "Give specific, encouraging feedback…", "aria-label": "Feedback" });
    const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true });
    openModal({
      title: `${r.user.name} · ${r.lesson?.title}`,
      content: h("div", { class: "stack" }, [h("div", { class: "card card-pad-sm small", style: "white-space:pre-wrap;background:var(--c-surface-2)" }, r.submission.text), r.lesson?.assignment?.rubric?.length ? h("ul", { class: "stack-sm" }, r.lesson.assignment.rubric.map((x) => h("li", { class: "row-sm small" }, [ico("check", 16), x]))) : null, Field({ label: "Feedback", control: fb }), err]),
      footer: (close) => [Button({ label: "Cancel", onClick: close }), Button({ label: "Send feedback", variant: "primary", icon: "send", onClick: () => { if (fb.value.trim().length < 3) { err.textContent = "Write a short note for the learner."; err.hidden = false; fb.focus(); return; } reviewSubmission(r.enrollment.id, r.lessonId, fb.value.trim()); close(); toast(`Feedback sent to ${r.user.name.split(" ")[0]}`); draw(); } })],
    });
  }
  draw();
  hydrateCourseEnrollments().then(() => host.isConnected && draw());
  bus.on("sync:learning", () => host.isConnected && hydrateCourseEnrollments().then(() => host.isConnected && draw()));
  return { title: "Learners", crumbs: [{ label: "Learners" }], el: host };
}
