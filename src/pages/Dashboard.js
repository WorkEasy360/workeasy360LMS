import { h, timeAgo, fmtDate, pluralize } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Card, SectionTitle, StatCard, PageHeader, ListRow } from "../components/Card.js";
import { Badge, Avatar, StatusBadge } from "../components/Badge.js";
import { Progress, ProgressRing, MeterRow } from "../components/Progress.js";
import { CourseCard, Cover } from "../components/Domain.js";
import { EmptyState } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { BarChart, StackedBar } from "../components/Charts.js";
import { continueLearning, dueSoon, recommended, userSkills, achievements, certificatesFor } from "../services/learning.js";
import { listCourses, courseTitle, lessonsOf } from "../services/courses.js";
import { listPosts, hasExpertAnswer } from "../services/community.js";
import { userById } from "../services/people.js";
import { learnerStats, orgStats, attentionItems, pendingReviews, topCourses, activitySeries, courseStats, byDepartment } from "../services/analytics.js";
import { guideEngine } from "../guide/GuideEngine.js";
import { NextStep, RecommendationList, PlanCard } from "../components/Recommendations.js";
import { loadRecommendations, loadPlans } from "../services/coach.js";
import { isBackendOnline } from "../lib/store.js";

const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; };

export function DashboardPage(ctx) {
  const view = { learner: LearnerDashboard, instructor: InstructorDashboard, admin: AdminDashboard }[ctx.user.role];
  return { title: "Home", crumbs: [{ label: "Home" }], el: view(ctx.user) };
}

// ---------------------------------------------------------------- Learner
function LearnerDashboard(user) {
  const cont = continueLearning(user.id);
  const top = cont[0];
  const stats = learnerStats(user.id);
  const skills = userSkills(user.id).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const due = dueSoon(user.id);
  const recs = recommended(user.id, 3);
  const posts = listPosts().slice(0, 3);
  const badges = achievements(user.id);
  const earned = badges.filter((b) => b.earned);
  const guideDone = guideEngine.progressFor("first-lesson")?.status === "completed";

  const hero = h("section", { class: "hero", "aria-label": "Continue learning" }, [
    h("div", { class: "eyebrow", style: "color:rgba(255,255,255,.75)" }, `${greeting()}, ${user.name.split(" ")[0]}`),
    h("h1", { id: "page-title", tabindex: "-1", style: "margin:6px 0 4px;font-size:28px" }, top ? "Pick up where you left off" : "Ready to start something new?"),
    top
      ? h("div", { class: "row wrap", style: "margin-top:20px;gap:20px" }, [
        h("div", { style: "flex:0 0 auto" }, ProgressRing(top.progress.pct, { size: 84, stroke: 8, color: "#fff" })),
        h("div", { class: "grow", style: "min-width:220px" }, [
          h("div", { style: "font-size:20px;font-weight:700" }, courseTitle(top.course)),
          h("div", { style: "opacity:.85" }, top.next ? `Up next: ${top.next.title} · ${top.next.duration} min` : "All lessons done"),
        ]),
        Button({ label: top.progress.done ? "Continue" : "Start learning", icon: "play", variant: "primary", size: "lg", href: `/learn/${top.course.id}${top.next ? "/" + top.next.id : ""}`, attrs: { "data-guide-target": "dashboard.continue" } }),
      ])
      : h("div", { style: "margin-top:16px" }, Button({ label: "Explore courses", icon: "compass", variant: "primary", size: "lg", href: "/explore" })),
  ]);

  const statsRow = h("div", { class: "grid grid-4" }, [
    StatCard({ label: "Learning streak", value: `${user.streak}d`, icon: "flame", tone: "warning", foot: user.streak >= 3 ? "You're on a roll" : "Learn today to build a streak" }),
    StatCard({ label: "Lessons completed", value: stats.lessons, icon: "check-circle", tone: "success", foot: `${stats.minutes} minutes learned` }),
    StatCard({ label: "Avg. quiz score", value: stats.scoreCount ? `${stats.avgScore}%` : "—", icon: "clipboard", foot: stats.scoreCount ? pluralize(stats.scoreCount, "quiz") + " taken" : "No quizzes yet" }),
    StatCard({ label: "Certificates", value: courseCerts(user), icon: "award", tone: "teal", foot: "Earned so far" }),
  ]);

  // Personalised next step + recommendations from the backend's deterministic engine (falls back to the local
  // "continue learning" hero when the backend can't be reached, so Home stays useful and fast).
  const nextHost = h("div", { class: "stack-lg", "data-home-recs": "loading" });
  const recHost = h("section", { class: "stack" });
  async function loadPersonalised() {
    if (!isBackendOnline()) { nextHost.dataset.homeRecs = "offline"; return; }
    try {
      const [recs, plans] = await Promise.all([loadRecommendations(), loadPlans().catch(() => [])]);
      nextHost.dataset.homeRecs = "backend";
      const primary = recs[0];
      const activePlan = plans.find((p) => p.status === "ACTIVE" || p.status === "DRAFT");
      nextHost.replaceChildren(primary ? NextStep(primary) : null, activePlan ? PlanCard(activePlan, { onChange: loadPersonalised }) : null);
      if (primary) hero.hidden = true;
      recHost.replaceChildren(
        SectionTitle("Recommended for you", Button({ label: "Ask the coach", variant: "ghost", size: "sm", icon: "sparkles", href: "/coach", attrs: { "data-guide-target": "home.coach" } }), "Explained from your own progress, skills and journeys"),
        recs.length > 1 ? RecommendationList(recs.slice(1), { onChange: loadPersonalised }) : recs.length === 1 ? h("p", { class: "small muted" }, "That's your one focus right now — finish it and new recommendations will follow.") : Card(EmptyState({ icon: "compass", title: "Nothing to recommend yet", description: "Enrol in a course to get personalised next steps.", action: Button({ label: "Explore courses", variant: "primary", href: "/explore" }) })),
      );
    } catch (err) { nextHost.dataset.homeRecs = "error"; console.warn("[home] recommendations unavailable:", err.message); }
  }
  loadPersonalised();

  const left = h("div", { class: "stack-lg" }, [
    recHost,
    due.length > 0 && h("section", {}, [
      SectionTitle("Coming up", null),
      Card(due.map((d) => {
        const days = Math.ceil((d.enrollment.dueAt - Date.now()) / 86400000);
        return ListRow({ leading: h("span", { class: "icon-tile warning" }, ico("clock", 20)), title: courseTitle(d.course), sub: `Due ${fmtDate(d.enrollment.dueAt)} · ${d.progress.pct}% complete`, trailing: [Badge(days <= 0 ? "Due today" : `${days} days left`, days <= 7 ? "warning" : ""), Button({ label: "Open", size: "sm", href: `/learn/${d.course.id}${d.next ? "/" + d.next.id : ""}` })] });
      }), { pad: false, cls: "list-card" }),
    ]),
    h("section", {}, [
      SectionTitle("In progress", Button({ label: "My Learning", variant: "ghost", size: "sm", iconRight: "arrow-right", href: "/my-learning" })),
      cont.length
        ? h("div", { class: "grid grid-2" }, cont.slice(0, 4).map((c) => CourseCard({ course: c.course, href: `/learn/${c.course.id}${c.next ? "/" + c.next.id : ""}`, progress: c.progress.pct })))
        : Card(EmptyState({ icon: "book", title: "Nothing in progress", description: "Find a course that fits your goals and start learning.", action: Button({ label: "Explore courses", variant: "primary", href: "/explore" }) })),
    ]),
    h("section", {}, [
      SectionTitle("Recommended for you", Button({ label: "Explore all", variant: "ghost", size: "sm", iconRight: "arrow-right", href: "/explore" }), "Based on your skill gaps"),
      recs.length ? h("div", { class: "grid grid-3" }, recs.map((r) => CourseCard({ course: r.course, href: `/explore/${r.course.id}`, reason: r.reason }))) : Card(EmptyState({ icon: "sparkles", title: "You're enrolled in everything", description: "New courses will show up here." })),
    ]),
  ]);

  const right = h("div", { class: "stack-lg" }, [
    !guideDone && h("div", { class: "card card-pad guide-promo" }, [
      h("div", { class: "row" }, [h("span", { class: "icon-tile" }, ico("sparkles", 20)), h("div", {}, [h("h3", {}, "New here?"), h("p", { class: "small muted" }, "A 3-minute guided tour — you'll complete your first lesson.")])]),
      h("div", { style: "margin-top:14px" }, GuideButton("first-lesson", { label: "Guide me through it", variant: "primary" })),
    ]),
    h("section", {}, [
      SectionTitle("Skills to grow", Button({ label: "All skills", variant: "ghost", size: "sm", href: "/skills" })),
      Card(h("div", { class: "stack" }, skills.map((s) => MeterRow(s.skill.name, s.level, { target: s.target }))), { cls: "" }),
    ]),
    h("section", {}, [
      SectionTitle("Community", Button({ label: "Open", variant: "ghost", size: "sm", href: "/community" })),
      Card(posts.map((p) => ListRow({ leading: Avatar(userById(p.authorId), "sm"), title: p.title, sub: `${userById(p.authorId)?.name.split(" ")[0]} · ${p.comments.length} replies · ${timeAgo(p.at)}`, href: `/community?post=${p.id}` })), { pad: false, cls: "list-card" }),
    ]),
    h("section", {}, [
      SectionTitle("Achievements", Button({ label: "All", variant: "ghost", size: "sm", href: "/achievements" })),
      Card(h("div", { class: "row wrap" }, [
        ...badges.map((b) => h("span", { class: ["ach-mini", b.earned && "is-earned"], title: `${b.title}${b.earned ? "" : " (locked)"}`, "aria-label": `${b.title}: ${b.earned ? "earned" : "locked"}` }, ico(b.icon, 20))),
        h("span", { class: "small muted" }, `${earned.length}/${badges.length} earned`),
      ])),
    ]),
  ]);

  return h("div", { class: "stack-lg" }, [nextHost, hero, statsRow, h("div", { class: "dash-cols" }, [left, right])]);
}
const courseCerts = (user) => String(certificatesFor(user.id).length);

// ---------------------------------------------------------------- Instructor
function InstructorDashboard(user) {
  const mine = listCourses({ instructorId: user.id });
  const stats = mine.map(courseStats);
  const enrolled = stats.reduce((n, s) => n + s.enrolled, 0);
  const avgCompletion = stats.length ? Math.round(stats.filter((s) => s.enrolled).reduce((n, s) => n + s.avgProgress, 0) / Math.max(1, stats.filter((s) => s.enrolled).length)) : 0;
  const reviews = pendingReviews(user.id);
  const drafts = mine.filter((c) => c.status === "draft");
  const questions = listPosts({ kind: "question" }).filter((p) => !hasExpertAnswer(p));
  const guideDone = guideEngine.progressFor("create-first-course")?.status === "completed";

  const attention = [
    ...reviews.slice(0, 3).map((r) => ({ icon: "upload", tone: "warning", title: `Review ${r.user.name.split(" ")[0]}'s assignment`, sub: `${courseTitle(r.course)} · ${r.lesson?.title}`, href: "/learners" })),
    ...questions.slice(0, 2).map((q) => ({ icon: "message", tone: "", title: `Answer: ${q.title}`, sub: `${userById(q.authorId)?.name} asked ${timeAgo(q.at)}`, href: `/community?post=${q.id}` })),
    ...drafts.map((c) => ({ icon: "edit", tone: "", title: `Finish “${courseTitle(c)}”`, sub: `Draft · ${pluralize(lessonsOf(c).length, "lesson")}`, href: `/builder/${c.id}` })),
  ];

  return h("div", { class: "stack-lg" }, [
    PageHeader({ eyebrow: `${greeting()}, ${user.name.split(" ")[0]}`, title: "What needs your attention?", sub: "Your courses, learners and the things waiting on you.", actions: [Button({ label: "New course", icon: "plus", variant: "primary", href: "/builder/new", attrs: { "data-guide-target": "courses.new-dashboard" } })] }),
    !guideDone && h("div", { class: "hero" }, [
      h("div", { class: "row wrap" }, [
        h("span", { class: "icon-tile", style: "background:rgba(255,255,255,.18);color:#fff" }, ico("rocket", 22)),
        h("div", { class: "grow", style: "min-width:220px" }, [h("h3", {}, "Create your first course in 4 minutes"), h("p", { style: "opacity:.85" }, "A guided walkthrough right inside the builder — name it, structure it, preview it, publish it.")]),
        GuideButton("create-first-course", { label: "Guide me", variant: "secondary" }),
      ]),
    ]),
    h("div", { class: "grid grid-4" }, [
      StatCard({ label: "Published courses", value: mine.filter((c) => c.status === "published").length, icon: "layers", foot: `${drafts.length} in draft` }),
      StatCard({ label: "Active enrolments", value: enrolled, icon: "users", tone: "teal" }),
      StatCard({ label: "Avg. completion", value: `${avgCompletion}%`, icon: "check-circle", tone: "success" }),
      StatCard({ label: "Awaiting review", value: reviews.length, icon: "upload", tone: reviews.length ? "warning" : "", foot: reviews.length ? "Learners are waiting on feedback" : "You're all caught up" }),
    ]),
    h("div", { class: "dash-cols" }, [
      h("div", { class: "stack-lg" }, [
        h("section", {}, [SectionTitle("Actions requiring attention"), attention.length ? Card(attention.map((a) => ListRow({ leading: h("span", { class: ["icon-tile", a.tone] }, ico(a.icon, 20)), title: a.title, sub: a.sub, href: a.href, trailing: ico("chevron-right", 18) })), { pad: false, cls: "list-card" }) : Card(EmptyState({ icon: "check-circle", title: "Nothing needs attention", description: "Great work — check back later." }))]),
        h("section", {}, [SectionTitle("Your courses", Button({ label: "All courses", variant: "ghost", size: "sm", href: "/courses" })), h("div", { class: "grid grid-2" }, mine.slice(0, 4).map((c) => CourseCard({ course: c, href: `/builder/${c.id}`, badge: StatusBadge(c.status) })))]),
      ]),
      h("div", { class: "stack-lg" }, [
        h("section", {}, [SectionTitle("Engagement"), Card([h("div", { class: "muted small", style: "margin-bottom:8px" }, "Lesson completions · last 30 days"), BarChart(activitySeries(30).map((d) => ({ label: d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: d.value })), { ariaLabel: "Learning activity over 30 days", showEvery: 7 })])]),
        h("section", {}, [SectionTitle("Where learners drop off"), Card(stats.filter((s) => s.enrolled).slice(0, 3).map((s) => h("div", { class: "stack-sm", style: "margin-bottom:14px" }, [h("div", { class: "row-between small" }, [h("strong", {}, courseTitle(s.course)), h("span", { class: "muted" }, `${s.completed}/${s.enrolled} finished`)]), MeterRow("Avg progress", s.avgProgress, { tone: "" })])))]),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------- Admin
function AdminDashboard(user) {
  const s = orgStats();
  const attention = attentionItems().slice(0, 5);
  const tops = topCourses().slice(0, 4);
  const dept = byDepartment();
  const c = s.certsByStatus;
  return h("div", { class: "stack-lg" }, [
    PageHeader({ eyebrow: `${greeting()}, ${user.name.split(" ")[0]}`, title: "Organisation overview", sub: "Learning activity, completion and skills across your workforce.", actions: [Button({ label: "Analytics", icon: "chart", href: "/analytics" }), Button({ label: "New course", icon: "plus", variant: "primary", href: "/builder/new" })] }),
    h("div", { class: "grid grid-4" }, [
      StatCard({ label: "Active learners (7d)", value: `${s.active}/${s.learners}`, icon: "users", foot: `${s.activePct}% engaged` }),
      StatCard({ label: "Completion rate", value: `${s.completionRate}%`, icon: "check-circle", tone: "success", foot: `${s.completions} of ${s.enrollments} enrolments` }),
      StatCard({ label: "Avg. assessment score", value: `${s.avgScore}%`, icon: "clipboard", tone: "teal" }),
      StatCard({ label: "Certificates", value: s.certs, icon: "award", tone: c.expired || c.expiring ? "warning" : "", foot: `${c.expiring} expiring · ${c.expired} expired` }),
    ]),
    h("div", { class: "dash-cols" }, [
      h("div", { class: "stack-lg" }, [
        h("section", {}, [SectionTitle("Learning activity", null, "Lessons completed per day"), Card(BarChart(activitySeries(30).map((d) => ({ label: d.date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: d.value })), { height: 180, ariaLabel: "Learning activity over 30 days" }))]),
        h("section", {}, [SectionTitle("Needs attention", Button({ label: "Certifications", variant: "ghost", size: "sm", href: "/certifications" })), attention.length ? Card(attention.map((a) => ListRow({ leading: h("span", { class: ["icon-tile", a.severity === "danger" ? "danger" : "warning"] }, ico(a.kind === "cert" ? "award" : "clock", 20)), title: a.text, sub: a.severity === "danger" ? "Action required" : "Coming up" })), { pad: false, cls: "list-card" }) : Card(EmptyState({ icon: "check-circle", title: "All clear" }))]),
        h("section", {}, [SectionTitle("Top courses"), Card(tops.map((t) => ListRow({ leading: Cover(t.course, 40, 18), title: courseTitle(t.course), sub: `${t.enrolled} enrolled · ${t.completed} completed`, trailing: h("div", { style: "width:110px" }, Progress(t.avgProgress, { size: "sm" })) })), { pad: false, cls: "list-card" })]),
      ]),
      h("div", { class: "stack-lg" }, [
        h("section", {}, [SectionTitle("Manager insights"), Card(h("div", { class: "stack" }, [MeterRow("Completion", s.completionRate, { tone: "" }), MeterRow("Assessment score", s.avgScore, { tone: "" }), MeterRow("Skill readiness", s.skillReadiness, { tone: "teal" }), h("p", { class: "xs muted" }, "Skill readiness = current skill level vs. each person's target.")]))]),
        h("section", {}, [SectionTitle("Progress by team"), Card(h("div", { class: "stack" }, dept.map((d) => MeterRow(d.dept, d.pct, { tone: "" }))))]),
        h("section", {}, [SectionTitle("Certificate health"), Card(StackedBar([{ label: "Valid", value: c.valid, color: "var(--c-success)" }, { label: "Expiring", value: c.expiring, color: "#F59E0B" }, { label: "Expired", value: c.expired, color: "var(--c-danger)" }]))]),
      ]),
    ]),
  ]);
}
