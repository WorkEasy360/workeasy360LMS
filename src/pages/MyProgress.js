// My Progress (learner): "What have I accomplished? What am I learning? What should I do next?" — every number
// comes from the learner's own persisted record via /api/analytics/me (services/analyticsApi.js).
import { h, timeAgo } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card, SectionTitle } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { MeterRow, ProgressRing } from "../components/Progress.js";
import { CountUp, LineChart } from "../components/Charts.js";
import { EmptyState, ErrorState, LoadingState } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { CourseCard } from "../components/Domain.js";
import { getCourse, courseTitle } from "../services/courses.js";
import { loadMyProgress, dayLabel } from "../services/analyticsApi.js";
import { isBackendOnline } from "../lib/store.js";
import { navigate } from "../router.js";

const SERIES = [{ key: "lessonsCompleted", label: "Lessons completed", color: "var(--c-primary)" }, { key: "quizAttempts", label: "Quiz attempts", color: "var(--c-teal)" }];

function Stat({ id, label, value, icon, tone = "", foot, format }) {
  return h("div", { class: "card card-pad-sm metric", "data-progress-stat": id, "data-progress-value": String(value) }, [
    h("div", { class: "row-between" }, [h("span", { class: "small muted strong" }, label), h("span", { class: ["icon-tile", tone], style: "width:34px;height:34px;border-radius:10px" }, ico(icon, 18))]),
    h("div", { class: "stat-value" }, CountUp(value, { format: format || ((v) => String(Math.round(v))) })),
    foot && h("div", { class: "xs muted" }, foot),
  ]);
}

export function MyProgressPage(ctx) {
  const user = ctx.user;
  const body = h("div", { class: "stack-lg" });
  const root = h("div", { class: "stack-lg", "data-progress-source": "loading" }, [
    PageHeader({ title: "My progress", sub: "What you've accomplished, what you're learning, and what to do next.", actions: [GuideButton("understand-progress")] }),
    body,
  ]);
  let alive = true;

  async function draw() {
    if (!isBackendOnline()) { body.replaceChildren(LoadingState("Signing in…")); return; } // the "session" event re-draws once signed in
    if (!body.firstChild || body.firstChild.textContent === "Signing in…") body.replaceChildren(LoadingState("Loading your progress…")); // refreshes keep the current view until new data lands
    let p;
    try { p = await loadMyProgress(); } catch (err) {
      if (!alive) return;
      root.dataset.progressSource = "error";
      body.replaceChildren(ErrorState({ title: "Progress unavailable", description: err.message, onRetry: draw }));
      return;
    }
    if (!alive) return;
    root.dataset.progressSource = "backend";
    const icons = { lesson: "check-circle", quiz: "clipboard", assignment: "edit", certificate: "award", enrolled: "book", course: "flag" };
    body.replaceChildren(h("div", { class: "fade-swap stack-lg" }, [
      // What should I do next?
      h("section", { class: "card card-pad lj-next", "data-guide-target": "progress.next", "data-next-href": p.nextAction.href }, [
        h("div", { class: "grow" }, [h("div", { class: "eyebrow" }, "What should I do next?"), h("div", { class: "strong", style: "font-size:18px" }, p.nextAction.label), h("div", { class: "small muted" }, p.nextAction.reason)]),
        Button({ label: p.nextAction.href === "/explore" ? "Explore" : "Go", icon: "arrow-right", variant: "primary", onClick: () => navigate(p.nextAction.href) }),
      ]),
      // What have I accomplished?
      h("section", { class: "stack", "data-guide-target": "progress.overview" }, [
        SectionTitle("What you've accomplished"),
        h("div", { class: "metric-grid" }, [
          Stat({ id: "streak", label: "Learning streak", value: p.streakDays, icon: "flame", tone: "warning", format: (v) => `${Math.round(v)}d`, foot: `${p.activeDays30} active days in the last 30` }),
          Stat({ id: "lessons", label: "Lessons completed", value: p.lessonsCompleted, icon: "check-circle", tone: "success", foot: `${p.minutesLearned} minutes learned` }),
          Stat({ id: "courses", label: "Courses completed", value: p.coursesCompleted, icon: "cap", foot: `${p.coursesInProgress} in progress` }),
          Stat({ id: "certificates", label: "Certificates", value: p.certificates, icon: "award", tone: "teal", foot: p.certificateList.some((c) => c.status === "EXPIRING") ? "One is expiring soon" : "All valid" }),
        ]),
      ]),
      h("div", { class: "dash-cols" }, [
        h("div", { class: "stack-lg" }, [
          // What am I learning?
          h("section", { class: "stack", "data-guide-target": "progress.courses" }, [
            SectionTitle("What you're learning", Button({ label: "My Learning", variant: "ghost", size: "sm", iconRight: "arrow-right", href: "/my-learning" }), `${p.coursesInProgress} in progress`),
            p.inProgress.length ? h("div", { class: "grid grid-2" }, p.inProgress.map((c) => { const local = getCourse(c.courseId); return local ? CourseCard({ course: local, href: `/learn/${c.courseId}${c.nextLessonId ? "/" + c.nextLessonId : ""}`, progress: c.progress }) : h("div", { class: "card card-pad-sm stack-sm" }, [h("div", { class: "strong small" }, c.title), MeterRow("Progress", c.progress)]); }))
              : Card(EmptyState({ icon: "book", title: "Nothing in progress", description: "Pick a course to start building skills.", action: Button({ label: "Explore courses", variant: "primary", href: "/explore" }) })),
          ]),
          h("section", { class: "stack", "data-guide-target": "progress.activity" }, [SectionTitle("Your learning activity", null, "Last 30 days"), Card(LineChart(p.activity.map((d) => ({ ...d, label: dayLabel(d.date) })), SERIES, { height: 170, ariaLabel: "Your learning activity" }))]),
          p.completed.length > 0 && h("section", { class: "stack" }, [SectionTitle("Completed courses", null, `${p.completed.length}`), Card(h("div", { class: "stack-sm" }, p.completed.map((c) => h("div", { class: "row-between small", "data-completed-course": c.courseId }, [h("span", { class: "row-sm" }, [ico("check-circle", 16), c.title]), h("span", { class: "xs muted" }, c.completedAt ? `Finished ${timeAgo(new Date(c.completedAt).getTime())}` : "")]))))]),
        ]),
        h("div", { class: "stack-lg" }, [
          Card(h("div", { class: "stack-sm center", style: "align-items:center;text-align:center" }, [ProgressRing(p.overallProgress, { size: 96, stroke: 10 }), h("div", { class: "eyebrow" }, "Overall progress"), h("p", { class: "xs muted" }, "Average across everything you're enrolled in.")])),
          h("section", { class: "stack", "data-guide-target": "progress.skills" }, [
            SectionTitle("Skills", Button({ label: "All skills", variant: "ghost", size: "sm", iconRight: "arrow-right", href: "/skills" }), `${p.skillsImproving} improving`),
            p.skills.length ? Card(h("div", { class: "stack" }, p.skills.slice(0, 6).map((s) => h("div", { class: "stack-sm", "data-progress-skill": s.skillId }, [MeterRow(s.name, s.progress, { tone: "teal" }), h("div", { class: "row-sm xs muted" }, [s.levelLabel, s.improving && Badge("Improving", "primary")])])))) : Card(EmptyState({ icon: "target", title: "No skills yet", description: "Complete mapped lessons to build skill evidence." })),
          ]),
          p.certificateList.length > 0 && h("section", { class: "stack" }, [SectionTitle("Certificates", Button({ label: "View", variant: "ghost", size: "sm", iconRight: "arrow-right", href: "/certificates" })), Card(h("div", { class: "stack-sm" }, p.certificateList.slice(0, 5).map((c) => h("div", { class: "row-between small" }, [h("span", { class: "truncate" }, c.courseTitle), Badge(c.status.toLowerCase(), c.status === "VALID" ? "success" : c.status === "EXPIRING" ? "warning" : "")]))))]),
          h("section", { class: "stack" }, [SectionTitle("Recent activity"), Card(p.recentActivity.length ? h("ul", { class: "timeline" }, p.recentActivity.map((a) => h("li", {}, [h("span", { class: "tl-dot" }, ico(icons[a.type] || "clock", 14)), h("span", { class: "small" }, [a.label, a.courseId && getCourse(a.courseId) && h("span", { class: "xs muted", style: "display:block" }, courseTitle(getCourse(a.courseId)))]), h("span", { class: "xs muted" }, timeAgo(new Date(a.at).getTime()))]))) : EmptyState({ icon: "clock", title: "No activity yet" }))]),
        ]),
      ]),
    ]));
  }

  const offs = ["session", "data:enrollments", "data:certificates"].map((ev) => bus.on(ev, () => root.isConnected && draw()));
  draw();
  return { title: "My progress", crumbs: [{ label: "My Progress" }], el: root, destroy: () => { alive = false; offs.forEach((off) => off()); } };
}
