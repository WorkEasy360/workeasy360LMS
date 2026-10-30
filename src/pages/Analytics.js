// Analytics: backend-powered (services/analyticsApi.js → /api/analytics/*). Admin sees the organisation,
// instructors the courses they manage; filters are applied by the server so every visual changes together.
import { h, timeAgo } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card, SectionTitle } from "../components/Card.js";
import { Tabs } from "../components/Tabs.js";
import { Badge, Avatar } from "../components/Badge.js";
import { MeterRow, Progress, ProgressRing } from "../components/Progress.js";
import { CountUp, LineChart, Funnel, Distribution } from "../components/Charts.js";
import { EmptyState, ErrorState, LoadingState } from "../components/States.js";
import { Select, Field, Input } from "../components/Form.js";
import { GuideButton } from "../components/GuideButton.js";
import { Cover } from "../components/Domain.js";
import { listCourses, courseTitle, getCourse } from "../services/courses.js";
import { userById } from "../services/people.js";
import { can } from "../services/permissions.js";
import { isBackendOnline } from "../lib/store.js";
import { rangeFor, loadOverview, loadCourses, loadCourse, loadLearners, loadLearner, loadSkills, loadHealth, loadGuideAnalytics, loadCoachAnalytics, dayLabel } from "../services/analyticsApi.js";
import { guideStats } from "../services/analytics.js";
import { guides } from "../guide/guides.js";

const SERIES = [
  { key: "lessonsCompleted", label: "Lessons completed", color: "var(--c-primary)" },
  { key: "quizAttempts", label: "Quiz attempts", color: "var(--c-teal)" },
  { key: "activeLearners", label: "Active learners", color: "var(--c-warning)" },
];
const withLabels = (series) => (series || []).map((d) => ({ ...d, label: dayLabel(d.date) }));
const pctFmt = (v) => `${Math.round(v)}%`;

// Metric card: same card/stat markup as StatCard, with a count-up value that eases to new values on filter changes.
function Metric({ id, label, value, format, icon = "chart", tone = "", foot }) {
  const num = CountUp(value, { format: format || ((v) => String(Math.round(v))) });
  const el = h("div", { class: "card card-pad-sm metric", "data-metric": id, "data-metric-value": String(value) }, [
    h("div", { class: "row-between" }, [h("span", { class: "small muted strong" }, label), h("span", { class: ["icon-tile", tone], style: "width:34px;height:34px;border-radius:10px" }, ico(icon, 18))]),
    h("div", { class: "stat-value" }, num),
    foot && h("div", { class: "xs muted" }, foot),
  ]);
  return el;
}

export function AnalyticsPage(ctx) {
  const admin = ctx.user.role === "admin";
  const state = { range: "30d", from: "", to: "", courseId: "", status: "", tab: "overview" };
  const scopedCourses = () => listCourses().filter((c) => admin || can(ctx.user, "course.edit", c));
  const filters = () => ({ ...(state.range === "custom" ? { from: state.from, to: state.to } : rangeFor(state.range)), courseId: state.courseId, status: state.status });

  const body = h("div", { class: "stack-lg" });
  const root = h("div", { class: "stack-lg", "data-analytics-source": "loading", "data-analytics-range": state.range });

  // ---------- filters (server-side) ----------
  const customBox = h("div", { class: "row-sm", hidden: true }, [
    Field({ label: "From", control: Input({ type: "date", "aria-label": "From date", oninput: (e) => { state.from = e.target.value; refresh(); } }) }),
    Field({ label: "To", control: Input({ type: "date", "aria-label": "To date", oninput: (e) => { state.to = e.target.value; refresh(); } }) }),
  ]);
  const filterBar = h("div", { class: "analytics-filters card card-pad-sm", "data-guide-target": "analytics.filters" }, [
    Field({ label: "Period", control: Select({ options: [{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }, { value: "all", label: "All time" }, { value: "custom", label: "Custom…" }], value: state.range, onChange: (v) => { state.range = v; customBox.hidden = v !== "custom"; root.dataset.analyticsRange = v; refresh(); }, attrs: { "aria-label": "Period", "data-analytics-filter": "range" } }) }),
    customBox,
    Field({ label: "Course", control: Select({ options: [{ value: "", label: "All courses" }, ...scopedCourses().map((c) => ({ value: c.id, label: courseTitle(c) }))], value: state.courseId, onChange: (v) => { state.courseId = v; refresh(); }, attrs: { "aria-label": "Course", "data-analytics-filter": "course" } }) }),
    Field({ label: "Status", control: Select({ options: [{ value: "", label: "Any status" }, { value: "PUBLISHED", label: "Published" }, { value: "DRAFT", label: "Draft" }, { value: "IN_REVIEW", label: "In review" }, { value: "ARCHIVED", label: "Archived" }], value: state.status, onChange: (v) => { state.status = v; refresh(); }, attrs: { "aria-label": "Course status", "data-analytics-filter": "status" } }) }),
  ]);

  let token = 0;
  function refresh() {
    bus.emit("analytics.filtered", { ...filters(), tab: state.tab });
    draw();
  }

  async function draw() {
    const my = ++token;
    // No backend session yet (e.g. the page mounted while sign-in was still in flight): the "session" event re-draws.
    if (!isBackendOnline()) { body.replaceChildren(LoadingState("Signing in…")); return; }
    body.replaceChildren(LoadingState("Loading analytics…"));
    try {
      const view = await ({ overview, courses, learners, skills, health, guides: guideAnalytics }[state.tab])();
      if (my !== token) return;
      root.dataset.analyticsSource = "backend";
      body.replaceChildren(h("div", { class: "fade-swap stack-lg" }, view));
    } catch (err) {
      if (my !== token) return;
      root.dataset.analyticsSource = "error";
      body.replaceChildren(ErrorState({ title: "Analytics unavailable", description: err.message || "Could not load analytics from the server.", onRetry: draw }));
    }
  }

  // ---------- overview ----------
  async function overview() {
    const [o, coach] = await Promise.all([loadOverview(filters()), admin ? loadCoachAnalytics().catch(() => null) : null]);
    const sum = (m) => Object.values(m || {}).reduce((a, b) => a + b, 0);
    const coachCard = coach && Card(h("div", { class: "stack-sm small", "data-analytics-coach": "" }, [
      h("div", { class: "row-between" }, ["Coach conversations", h("strong", {}, `${coach.conversations} · ${coach.distinctCoachUsers} ${coach.distinctCoachUsers === 1 ? "person" : "people"}`)]),
      h("div", { class: "row-between" }, ["Questions asked", h("strong", {}, String(coach.learnerMessages))]),
      h("div", { class: "row-between" }, ["Learning plans", h("strong", {}, `${coach.plans} created · ${coach.plansStarted} started · ${coach.plansCompleted} completed`)]),
      h("div", { class: "row-between" }, ["Recommendations", h("strong", {}, `${sum(coach.recommendationsByStatus)} · ${coach.recommendationsByStatus.COMPLETED || 0} completed · ${coach.recommendationsByStatus.DISMISSED || 0} dismissed`)]),
      h("div", { class: "row-between" }, ["Feedback", h("strong", {}, `${coach.feedback.HELPFUL || 0} helpful · ${coach.feedback.NOT_RELEVANT || 0} not relevant`)]),
      h("div", { class: "row-between" }, ["AI drafts", h("strong", {}, `${coach.aiByType.COURSE || 0} courses · ${coach.aiByType.QUIZ || 0} quizzes · ${coach.aiByStatus.FAILED || 0} failed`)]),
      h("p", { class: "xs muted", style: "margin:0" }, "Counts only — conversation content is private to each learner."),
    ]));
    const metrics = h("div", { class: "metric-grid", "data-guide-target": "analytics.metrics", "data-analytics-scope": o.scope }, [
      Metric({ id: "learners", label: admin ? "Learners" : "Enrolled learners", value: admin ? o.totalLearners : o.enrolledLearners, icon: "users", foot: `${o.activeLearners} active in period` }),
      Metric({ id: "enrollments", label: "Enrolments", value: o.enrollments, icon: "book", foot: `${o.enrolledLearners} distinct learners` }),
      Metric({ id: "completionRate", label: "Completion rate", value: o.completionRate, format: pctFmt, icon: "check-circle", tone: "success", foot: `${o.completions} completions` }),
      Metric({ id: "avgProgress", label: "Avg. progress", value: o.avgProgress, format: pctFmt, icon: "chart", foot: `${o.lessonCompletionRate}% of lessons completed` }),
      Metric({ id: "quizPassRate", label: "Quiz pass rate", value: o.quizPassRate, format: pctFmt, icon: "clipboard", tone: "teal", foot: `${o.quizAttempts} attempts · avg ${o.avgQuizScore}%` }),
      Metric({ id: "certificates", label: "Certificates", value: o.certificatesIssued, icon: "award", tone: "warning", foot: `${o.certificatesExpiring} expiring · ${o.certificatesExpired} expired` }),
    ]);
    return [
      metrics,
      h("div", { class: "dash-cols" }, [
        h("div", { class: "stack-lg" }, [
          h("section", { "data-guide-target": "analytics.activity" }, [SectionTitle("Learning activity", null, "Per day, in the selected period"), Card(LineChart(withLabels(o.activity), SERIES, { height: 200, ariaLabel: "Learning activity" }))]),
          h("section", { "data-guide-target": "analytics.funnel" }, [SectionTitle("Course funnel", null, "Share of enrolled learners reaching each stage"), Card(Funnel(o.funnel, { ariaLabel: "Course funnel" }))]),
        ]),
        h("div", { class: "stack-lg" }, [
          h("section", {}, [SectionTitle("Progress distribution", null, "Enrolments by progress"), Card(Distribution(o.completionDistribution))]),
          h("section", {}, [SectionTitle("Assessments"), Card(h("div", { class: "stack" }, [
            h("div", { class: "row" }, [ProgressRing(o.quizPassRate, { size: 56, stroke: 6, color: "var(--c-teal)" }), h("div", {}, [h("div", { class: "strong small" }, "Quiz pass rate"), h("div", { class: "xs muted" }, `${o.quizAttempts} attempts · average score ${o.avgQuizScore}%`)])]),
            h("div", { class: "row" }, [ProgressRing(o.assignmentReviewRate, { size: 56, stroke: 6 }), h("div", {}, [h("div", { class: "strong small" }, "Assignments reviewed"), h("div", { class: "xs muted" }, `${o.assignmentsReviewed} of ${o.assignmentSubmissions} submissions reviewed`)])]),
            h("div", { class: "row" }, [ProgressRing(o.avgSkillProgress, { size: 56, stroke: 6, color: "var(--c-warning)" }), h("div", {}, [h("div", { class: "strong small" }, "Skill progress"), h("div", { class: "xs muted" }, `${o.skillsTracked} skills tracked · average ${o.avgSkillProgress}%`)])]),
          ]))]),
          coachCard && h("section", {}, [SectionTitle("Coach & AI adoption", null, "Across the organisation"), coachCard]),
          h("section", {}, [SectionTitle("Catalogue"), Card(h("div", { class: "stack-sm small" }, [h("div", { class: "row-between" }, ["Published courses", h("strong", {}, String(o.coursesPublished))]), h("div", { class: "row-between" }, ["All courses in scope", h("strong", {}, String(o.coursesTotal))]), h("div", { class: "row-between" }, ["Lesson completion rate", h("strong", {}, `${o.lessonCompletionRate}%`)])]))]),
        ]),
      ]),
    ];
  }

  // ---------- courses ----------
  let openCourse = null;
  async function courses() {
    const rows = await loadCourses(filters());
    const detail = h("div");
    const showCourse = async (id) => {
      openCourse = id;
      detail.replaceChildren(LoadingState("Loading course analytics…"));
      try { detail.replaceChildren(courseDetail(await loadCourse(id, filters()))); }
      catch (err) { detail.replaceChildren(ErrorState({ title: "Course analytics unavailable", description: err.message, onRetry: () => showCourse(id) })); }
    };
    if (!rows.length) return [Card(EmptyState({ icon: "chart", title: "No courses in scope", description: admin ? "Create or publish a course to see analytics." : "Publish a course to start seeing learner analytics." }))];
    const grid = h("div", { class: "grid grid-3" }, rows.map((c) => {
      const local = getCourse(c.courseId);
      return h("button", { class: "card card-hover card-pad-sm stack-sm", type: "button", style: "text-align:left;font:inherit;color:inherit;cursor:pointer", "data-analytics-course": c.courseId, "aria-pressed": String(openCourse === c.courseId), onclick: () => { grid.querySelectorAll("[data-analytics-course]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.analyticsCourse === c.courseId))); showCourse(c.courseId); } }, [
        h("div", { class: "row-sm" }, [local && Cover(local, 36, 18), h("div", { class: "grow" }, [h("div", { class: "strong small truncate" }, c.title), h("div", { class: "xs muted" }, `${c.enrolled} enrolled · ${c.completed} completed`)]), Badge(c.status.toLowerCase().replace("_", " "), c.status === "PUBLISHED" ? "success" : "")]),
        MeterRow("Avg. progress", c.avgProgress, { tone: "" }),
        h("div", { class: "row wrap xs muted", style: "gap:10px" }, [`Completion ${c.completionRate}%`, `Quiz pass ${c.quizAttempts ? c.quizPassRate + "%" : "—"}`, `Assignments ${c.assignmentsSubmitted}`, `Certified ${c.certified}`]),
      ]);
    }));
    if (openCourse && rows.some((r) => r.courseId === openCourse)) showCourse(openCourse);
    return [h("p", { class: "small muted" }, "Select a course for its funnel, lesson drop-off and learners."), grid, detail];
  }

  function courseDetail(c) {
    const instructor = userById(c.instructorId);
    return h("div", { class: "analytics-detail stack-lg", "data-analytics-course-detail": c.courseId }, [
      h("div", { class: "row-between wrap" }, [h("div", {}, [h("h2", {}, c.title), h("div", { class: "small muted" }, [instructor ? `Instructor: ${instructor.name} · ` : "", c.lastActivityAt ? `Last learner activity ${timeAgo(new Date(c.lastActivityAt).getTime())}` : "No learner activity yet"])]), can(ctx.user, "course.edit", getCourse(c.courseId) || { instructorId: c.instructorId }) && Button({ label: "Open in Builder", icon: "layers", size: "sm", variant: "secondary", href: `/builder/${c.courseId}` })]),
      h("div", { class: "metric-grid" }, [
        Metric({ id: "course-enrolled", label: "Enrolled", value: c.enrolled, icon: "users" }),
        Metric({ id: "course-inprogress", label: "In progress", value: c.inProgress, icon: "play" }),
        Metric({ id: "course-completed", label: "Completed", value: c.completed, icon: "check-circle", tone: "success", foot: `${c.completionRate}% completion` }),
        Metric({ id: "course-quiz", label: "Quiz pass rate", value: c.quizPassRate, format: pctFmt, icon: "clipboard", tone: "teal", foot: `${c.quizAttempts} attempts · avg ${c.avgQuizScore}%` }),
        Metric({ id: "course-assignments", label: "Assignments", value: c.assignmentsSubmitted, icon: "edit", foot: `${c.assignmentsReviewed} reviewed (${c.assignmentCompletionRate}%)` }),
        Metric({ id: "course-certified", label: "Certified", value: c.certified, icon: "award", tone: "warning" }),
      ]),
      h("div", { class: "dash-cols" }, [
        h("div", { class: "stack-lg" }, [
          h("section", { "data-guide-target": "analytics.funnel" }, [SectionTitle("Funnel"), Card(Funnel(c.funnel, { ariaLabel: `${c.title} funnel` }))]),
          h("section", {}, [SectionTitle("Lesson drop-off", null, "Share of enrolled learners who completed each lesson, in order"), Card(c.lessons.length ? h("div", { class: "stack" }, c.lessons.map((l, i) => h("div", { class: "stack-sm", "data-lesson-stat": l.lessonId }, [MeterRow(`${i + 1}. ${l.title}`, l.completionPct, { tone: l.dropOffPct >= 40 ? "" : "teal" }), l.dropOffPct >= 20 && h("div", { class: "xs", style: "color:var(--c-warning)" }, `Drop-off: ${l.dropOffPct} pts vs previous lesson`)]))) : EmptyState({ icon: "layers", title: "No lessons yet" }))]),
          h("section", {}, [SectionTitle("Activity", null, "This course, per day"), Card(LineChart(withLabels(c.activity), SERIES, { height: 170, ariaLabel: `${c.title} activity` }))]),
        ]),
        h("section", {}, [SectionTitle("Learners", null, `${c.learners.length} enrolled`), Card(c.learners.length ? c.learners.map((r) => h("div", { class: "list-row", "data-course-learner": r.userId }, [Avatar(userById(r.userId) || { name: r.name, hue: 200 }, "sm"), h("div", { class: "grow" }, [h("div", { class: "strong small" }, r.name), h("div", { class: "xs muted" }, `${r.dept || ""}${r.lastActiveAt ? " · active " + timeAgo(new Date(r.lastActiveAt).getTime()) : " · not started"}`)]), h("div", { style: "width:100px" }, Progress(r.progress, { size: "sm" })), h("span", { class: "small strong", style: "width:38px;text-align:right" }, `${r.progress}%`)])) : EmptyState({ icon: "users", title: "No learners enrolled yet" }), { pad: false, cls: "list-card" })]),
      ]),
    ]);
  }

  // ---------- learners ----------
  let openLearner = null;
  async function learners() {
    const rows = await loadLearners(filters());
    const detail = h("div");
    const list = h("div", { class: "card", style: "overflow:hidden" });
    const show = async (id) => {
      openLearner = id;
      list.querySelectorAll(".learner-row").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.learner === id)));
      detail.replaceChildren(LoadingState("Loading learner…"));
      try { detail.replaceChildren(learnerDetail(await loadLearner(id, filters()))); }
      catch (err) { detail.replaceChildren(ErrorState({ title: "Learner analytics unavailable", description: err.message, onRetry: () => show(id) })); }
    };
    list.replaceChildren(...rows.map((r) => h("button", { class: "learner-row", type: "button", "data-learner": r.userId, "aria-pressed": String(openLearner === r.userId), onclick: () => show(r.userId) }, [
      Avatar(userById(r.userId) || { name: r.name, hue: 200 }, "sm"),
      h("div", { class: "grow" }, [h("div", { class: "strong small" }, r.name), h("div", { class: "xs muted" }, `${r.dept || ""} · ${r.coursesEnrolled} courses · ${r.coursesCompleted} completed${r.lastActiveAt ? " · active " + timeAgo(new Date(r.lastActiveAt).getTime()) : ""}`)]),
      Progress(r.avgProgress, { size: "sm", label: `${r.name} average progress` }),
      h("span", { class: "small strong", style: "text-align:right" }, `${r.avgProgress}%`),
    ])));
    if (!rows.length) return [Card(EmptyState({ icon: "users", title: "No learners in scope", description: "Learners appear here once they enrol in a course you manage." }))];
    if (openLearner && rows.some((r) => r.userId === openLearner)) show(openLearner);
    return [h("p", { class: "small muted" }, admin ? "Learning progress only — no browsing or time-on-page tracking." : "Only learners enrolled in your courses, and only their progress in those courses."), h("div", { class: "dash-cols", "data-guide-target": "analytics.learners" }, [list, detail])];
  }

  function learnerDetail(l) {
    return h("div", { class: "analytics-detail stack", "data-analytics-learner": l.userId }, [
      h("div", { class: "card card-pad stack-sm" }, [
        h("div", { class: "row" }, [Avatar(userById(l.userId) || { name: l.name, hue: 200 }), h("div", { class: "grow" }, [h("h3", {}, l.name), h("div", { class: "small muted" }, [l.title, l.dept ? ` · ${l.dept}` : ""])]), ProgressRing(l.avgProgress, { size: 56, stroke: 6 })]),
        h("div", { class: "grid grid-2 small" }, [
          h("div", {}, [h("div", { class: "xs muted" }, "Courses"), h("div", { class: "strong" }, `${l.coursesCompleted} of ${l.coursesEnrolled} completed`)]),
          h("div", {}, [h("div", { class: "xs muted" }, "Lessons"), h("div", { class: "strong" }, String(l.lessonsCompleted))]),
          h("div", {}, [h("div", { class: "xs muted" }, "Quizzes"), h("div", { class: "strong" }, l.quizAttempts ? `${l.quizPassRate}% pass · avg ${l.avgQuizScore}%` : "No attempts")]),
          h("div", {}, [h("div", { class: "xs muted" }, "Assignments"), h("div", { class: "strong" }, `${l.assignmentsReviewed} reviewed of ${l.assignmentsSubmitted}`)]),
          h("div", {}, [h("div", { class: "xs muted" }, "Certificates"), h("div", { class: "strong" }, String(l.certificates))]),
          h("div", {}, [h("div", { class: "xs muted" }, "Last active"), h("div", { class: "strong" }, l.lastActiveAt ? timeAgo(new Date(l.lastActiveAt).getTime()) : "—")]),
        ]),
      ]),
      h("div", { class: "card card-pad stack-sm" }, [h("h4", {}, "Courses"), ...(l.courses.length ? l.courses.map((c) => h("div", { class: "stack-sm" }, [MeterRow(c.title, c.progress, { tone: c.status === "completed" ? "teal" : "" }), h("div", { class: "xs muted" }, c.status === "completed" ? "Completed" : c.nextLessonTitle ? `Next: ${c.nextLessonTitle}` : "Not started")])) : [h("p", { class: "small muted" }, "No enrolments in scope.")])]),
      l.skills.length > 0 && h("div", { class: "card card-pad stack-sm" }, [h("h4", {}, "Skills"), ...l.skills.map((s) => h("div", { class: "stack-sm" }, [MeterRow(s.name, s.progress, { tone: "teal" }), h("div", { class: "xs muted" }, `${s.levelLabel}${s.improving ? " · improving" : ""}`)]))]),
      l.recentActivity.length > 0 && h("div", { class: "card card-pad stack-sm" }, [h("h4", {}, "Recent activity"), Timeline(l.recentActivity)]),
    ]);
  }

  // ---------- skills ----------
  async function skills() {
    const rows = await loadSkills({ courseId: state.courseId });
    if (!rows.length) return [Card(EmptyState({ icon: "target", title: "No skill data yet", description: "Skill progress appears once learners complete mapped lessons." }))];
    return [h("div", { class: "grid grid-2", "data-guide-target": "analytics.skills" }, rows.map((s) => h("div", { class: "card card-pad stack-sm", "data-skill-analytics": s.skillId }, [
      h("div", { class: "row-between" }, [h("div", {}, [h("h3", {}, s.name), h("div", { class: "xs muted" }, `${s.category} · built by ${s.courses} course${s.courses === 1 ? "" : "s"}`)]), Badge(`${s.learners} learner${s.learners === 1 ? "" : "s"}`, "teal")]),
      MeterRow("Average progress", s.avgProgress, { tone: "teal" }),
      h("div", { class: "xs muted" }, `${s.improving} improving in the last 14 days`),
      Distribution(Object.entries(s.levelDistribution).map(([label, count]) => ({ label, count })), { color: "var(--c-teal)" }),
    ])))];
  }

  // ---------- course health ----------
  async function health() {
    const signals = await loadHealth({ courseId: state.courseId });
    const byCourse = new Map();
    signals.forEach((s) => { if (!byCourse.has(s.courseId)) byCourse.set(s.courseId, { title: s.courseTitle, items: [] }); byCourse.get(s.courseId).items.push(s); });
    return [
      h("p", { class: "small muted" }, "Factual signals only — each one shows the metric that triggered it. Thresholds: completion < 40% (≥2 enrolled), lesson drop-off ≥ 40 pts, quiz pass rate < 60% (≥2 attempts), no learner activity for 30 days, content unchanged for 180 days."),
      byCourse.size ? h("div", { class: "grid grid-2", "data-guide-target": "analytics.health" }, [...byCourse.entries()].map(([id, c]) => h("div", { class: "card card-pad stack-sm", "data-health-course": id }, [
        h("div", { class: "row-between" }, [h("h3", {}, c.title), Button({ label: "Open analytics", size: "sm", variant: "ghost", onClick: () => { openCourse = id; state.tab = "courses"; setTab("courses"); } })]),
        ...c.items.map((s) => h("div", { class: "health-signal", "data-health-signal": s.signal }, [h("div", {}, [Badge(s.signal, "warning"), h("div", { class: "xs muted", style: "margin-top:4px" }, s.detail)]), h("div", { style: "text-align:right" }, [h("div", { class: "health-metric" }, s.value), h("div", { class: "xs muted" }, s.metric)])])),
      ]))) : h("div", { "data-guide-target": "analytics.health" }, Card(EmptyState({ icon: "check-circle", title: "No signals right now", description: "Every published course in scope is above the thresholds." }))),
    ];
  }

  // ---------- guides (admin) — persisted guide events (/api/guides/{id}/analytics → /api/analytics/guides) are the
  // source of truth; this browser's mirrored events are only shown when the server can't be reached.
  async function guideAnalytics() {
    let rows = null, source = "backend", note = "Guide events recorded on the server for every user: opened, started, step completed, completed, abandoned, help requested.";
    try { rows = await loadGuideAnalytics(); }
    catch (err) { source = "local"; note = `Server guide analytics unavailable (${err.message}) — showing only the events mirrored in this browser.`; }
    const byId = rows ? Object.fromEntries(rows.map((r) => [r.guideId, r])) : null;
    return [h("p", { class: "small muted", "data-guide-analytics-source": source }, note), h("div", { class: "grid grid-2" }, Object.values(guides).map((g) => {
      const r = byId ? byId[g.id] : null;
      const s = byId ? (r ? { opened: r.opened, started: r.started, completed: r.completed, abandoned: r.abandoned, helpRequested: r.helpRequested, completionRate: r.completionRate, avgMs: r.avgCompletionMs, stepReach: r.stepReach || {}, users: r.users } : { opened: 0, started: 0, completed: 0, abandoned: 0, helpRequested: 0, completionRate: 0, avgMs: 0, stepReach: {}, users: 0 }) : guideStats(g.id);
      const reach = g.steps.map((st) => s.stepReach[st.order] || 0);
      const max = Math.max(1, s.started);
      return h("div", { class: "card card-pad stack", "data-guide-analytics": g.id, "data-guide-opened": String(s.opened) }, [
        h("div", { class: "row-between" }, [h("div", {}, [h("h3", {}, g.title), h("div", { class: "small muted" }, `${g.steps.length} steps · ${g.roles.join(", ")}${s.users != null ? ` · ${s.users} user${s.users === 1 ? "" : "s"}` : ""}`)]), Badge(`${s.completionRate}% completion`, s.completionRate >= 50 ? "success" : "warning")]),
        h("div", { class: "grid grid-4" }, [["Opened", s.opened], ["Started", s.started], ["Completed", s.completed], ["Abandoned", s.abandoned]].map(([l, v]) => h("div", {}, [h("div", { class: "stat-value", style: "font-size:24px" }, String(v)), h("div", { class: "xs muted" }, l)]))),
        h("div", { class: "stack-sm" }, [h("div", { class: "label" }, "Step drop-off"), ...g.steps.map((st, i) => MeterRow(`${i + 1}. ${st.title}`, Math.round((reach[i] / max) * 100), { tone: "" }))]),
      ]);
    }))];
  }

  function Timeline(items) {
    const icons = { lesson: "check-circle", quiz: "clipboard", assignment: "edit", certificate: "award", enrolled: "book", course: "flag" };
    return h("ul", { class: "timeline" }, items.map((a) => h("li", {}, [h("span", { class: "tl-dot" }, ico(icons[a.type] || "clock", 14)), h("span", { class: "small" }, [a.label, a.courseId && getCourse(a.courseId) && h("span", { class: "xs muted", style: "display:block" }, courseTitle(getCourse(a.courseId)))]), h("span", { class: "xs muted" }, timeAgo(new Date(a.at).getTime()))])));
  }

  // ---------- shell ----------
  const tabsDef = [{ id: "overview", label: "Overview" }, { id: "courses", label: "Courses" }, { id: "learners", label: "Learners" }, { id: "skills", label: "Skills" }, { id: "health", label: "Course health" }, ...(admin ? [{ id: "guides", label: "Guides" }] : [])];
  let tabsEl;
  function setTab(t) { state.tab = t; bus.emit("analytics.tab", { tab: t }); tabsEl.replaceWith(tabsEl = makeTabs()); draw(); }
  function makeTabs() {
    const el = Tabs({ tabs: tabsDef, active: state.tab, onChange: setTab, label: "Analytics sections" });
    el.querySelectorAll("button").forEach((b) => { const id = tabsDef.find((t) => t.label === b.textContent.trim())?.id; if (id) b.setAttribute("data-guide-target", `analytics.tab-${id}`); });
    return el;
  }
  tabsEl = makeTabs();
  root.append(
    PageHeader({ title: "Analytics", sub: admin ? "Organisation-wide learning outcomes, computed from real learner activity." : "How learners are doing in the courses you manage.", actions: [GuideButton("understand-analytics")] }),
    filterBar, tabsEl, body,
  );
  const offSession = bus.on("session", () => root.isConnected && draw());
  const offSync = bus.on("sync:learning", () => root.isConnected && draw()); // live: a learner finished something somewhere
  draw();
  return { title: "Analytics", crumbs: [{ label: "Analytics" }], el: root, destroy: () => { token++; offSession(); offSync(); } };
}
