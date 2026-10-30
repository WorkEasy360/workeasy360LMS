// Catalog + course detail (learner).
import { h, pluralize } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Chips } from "../components/Tabs.js";
import { SearchInput, Select } from "../components/Form.js";
import { PageHeader, Card, SectionTitle } from "../components/Card.js";
import { Badge, Avatar } from "../components/Badge.js";
import { CourseCard, Cover } from "../components/Domain.js";
import { Progress, ProgressRing } from "../components/Progress.js";
import { EmptyState, ErrorState, withLoading } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { toast } from "../components/Overlay.js";
import { listCourses, getCourse, lessonsOf, courseTitle, courseMinutes, LESSON_TYPES, coverStyle, isVisibleInCatalog } from "../services/courses.js";
import { courseProgress, enroll, nextLesson, getEnrollment, isLessonDone, isLessonUnlocked, recommended, certificatesFor } from "../services/learning.js";
import { listPosts } from "../services/community.js";
import { userById } from "../services/people.js";
import { load } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { navigate } from "../router.js";
import { LearningJourney } from "../components/LearningJourney.js";
import { LEVEL_LABELS } from "../services/skillsSync.js";
import { isFree, priceLabel, priceTone, formatPrice, courseAccess, startPurchase } from "../services/commerce.js";

export function ExplorePage(ctx) {
  const user = ctx.user;
  let q = "", cat = "All", level = "All";
  const results = h("div");
  const recs = recommended(user.id, 3);

  function draw() {
    const list = listCourses({ status: "published" }).filter(isVisibleInCatalog).filter((c) =>
      (cat === "All" || c.category === cat) && (level === "All" || c.level === level) &&
      (!q || `${c.title} ${c.description} ${c.category}`.toLowerCase().includes(q.toLowerCase())));
    results.replaceChildren(list.length
      ? h("div", { class: "grid grid-auto" }, list.map((c, i, arr) => {
        const p = courseProgress(user.id, c.id);
        const card = CourseCard({ course: c, href: `/explore/${c.id}`, progress: p.enrolled ? p.pct : null });
        if (i === arr.findIndex((x) => courseProgress(user.id, x.id).status !== "completed")) card.setAttribute("data-guide-target", "explore.first-course");
        return card;
      }))
      : Card(EmptyState({ icon: "search", title: "No courses match", description: "Try clearing a filter or searching for something else.", action: Button({ label: "Clear filters", onClick: () => { q = ""; cat = "All"; level = "All"; draw(); } }) })));
  }

  const cats = ["All", ...new Set(listCourses({ status: "published" }).map((c) => c.category))];
  const el = h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Explore", sub: "Find the next thing to learn.", actions: [GuideButton("first-lesson")] }),
    recs.length > 0 && h("section", {}, [SectionTitle("Recommended for you", null, "Picked from your skill gaps"), h("div", { class: "grid grid-3" }, recs.map((r) => CourseCard({ course: r.course, href: `/explore/${r.course.id}`, reason: r.reason })))]),
    h("section", { class: "stack" }, [
      SectionTitle("All courses"),
      h("div", { class: "catalog-filters" }, [
        h("div", { style: "width:min(300px,100%)" }, SearchInput({ placeholder: "Search courses", onInput: (v) => { q = v; draw(); } })),
        Chips({ options: cats, value: cat, onChange: (v) => { cat = v; draw(); }, label: "Category" }),
        Select({ options: ["All", "Beginner", "Intermediate", "Advanced"].map((v) => ({ value: v, label: v === "All" ? "Any level" : v })), value: level, onChange: (v) => { level = v; draw(); }, attrs: { "aria-label": "Level", style: "width:auto" } }),
      ]),
      results,
    ]),
  ]);
  const stop = withLoading(results, () => { draw(); return results.firstChild; }, { delay: 200, skeleton: () => h("div", { class: "grid grid-auto" }, [1, 2, 3, 4].map(() => h("div", { class: "skeleton", style: "height:260px" }))) });
  ["data:courses", "data:enrollments"].forEach((ev) => bus.on(ev, () => results.isConnected && draw())); // live catalog updates
  return { title: "Explore", crumbs: [{ label: "Explore" }], el, destroy: stop };
}

export function CourseDetailPage(ctx) {
  const user = ctx.user;
  const course = getCourse(ctx.params.id);
  if (!course || (course.status !== "published" && user.role === "learner")) {
    return { title: "Not found", crumbs: [{ label: "Explore", href: "/explore" }, { label: "Not found" }], el: ErrorState({ title: "Course unavailable", description: "This course isn't published yet or no longer exists.", onRetry: () => navigate("/explore") }) };
  }
  const p = courseProgress(user.id, course.id);
  const e = getEnrollment(user.id, course.id);
  const ls = lessonsOf(course);
  const next = e ? nextLesson(course, e) : ls[0];
  const cert = certificatesFor(user.id).find((c) => c.courseId === course.id);
  const discussion = listPosts({ courseId: course.id });
  const instructor = userById(course.instructorId);
  const skills = course.skills.map((s) => ({ ...s, skill: load("skills").find((x) => x.id === s.skillId) })).filter((s) => s.skill);

  const paid = !isFree(course);
  const go = () => {
    enroll(user.id, course.id);
    if (!p.enrolled) toast(`You're enrolled in “${courseTitle(course)}”`);
    navigate(`/learn/${course.id}${next ? "/" + next.id : ""}`);
  };
  const startCta = () => Button({
    label: p.status === "completed" ? "Review course" : p.done ? "Continue learning" : p.enrolled ? "Start learning" : paid ? "Start learning" : "Enrol & start", icon: "play", variant: "primary", size: "lg",
    onClick: go, attrs: { "data-guide-target": "course.start" },
  });
  const buy = async (btn) => {
    btn.disabled = true;
    try { const c = await startPurchase(course.id); navigate(`/checkout/${c.order.id}`); }
    catch (err) { toast(err.status === 409 ? "You already have access to this course." : err.message, { type: err.status === 409 ? "info" : "error" }); btn.disabled = false; }
  };
  // Paid courses: the CTA depends on the server's entitlement answer (a purchase, an assignment, or an editor role).
  let access = paid ? null : { canAccess: true, free: true };
  const cta = h("div", { class: "stack-sm", style: "align-items:flex-end", "data-course-access": paid ? "checking" : "free" });
  const drawCta = () => {
    if (!paid || (access && access.canAccess)) { cta.dataset.courseAccess = paid ? "unlocked" : "free"; cta.replaceChildren(paid && access?.source === "PURCHASE" ? Badge("Purchased", "success", "check") : null, startCta()); return; }
    if (access === null) { cta.dataset.courseAccess = "checking"; cta.replaceChildren(Button({ label: "Checking access…", disabled: true })); return; }
    cta.dataset.courseAccess = "locked";
    cta.replaceChildren(
      h("div", { class: "strong", style: "color:#fff;font-size:22px" }, formatPrice(course.price, course.currency)),
      access.canPurchase
        ? Button({ label: "Buy this course", icon: "lock", variant: "primary", size: "lg", attrs: { "data-course-buy": "" }, onClick: (e) => buy(e.currentTarget) })
        : h("div", { class: "row-sm small", style: "color:#fff;opacity:.92" }, [ico("lock", 16), access.pendingOrderId ? "" : "Purchases aren't available on this server yet."]),
      access.pendingOrderId && Button({ label: "Resume checkout", variant: "secondary", href: `/checkout/${access.pendingOrderId}`, attrs: { "data-course-resume-checkout": "" } }),
    );
  };
  drawCta();
  if (paid) courseAccess(course).then((a) => { access = a; drawCta(); drawSyllabus(); }).catch(() => { access = { canAccess: false, canPurchase: false }; drawCta(); });

  const hero = h("div", { class: "course-hero", style: coverStyle(course.cover) }, [
    h("div", { class: "row wrap", style: "justify-content:space-between;align-items:flex-end;gap:24px" }, [
      h("div", { class: "stack-sm", style: "max-width:640px" }, [
        h("div", { class: "row-sm wrap" }, [Badge(course.category), Badge(course.level), Badge(priceLabel(course), priceTone(course), paid ? "lock" : null), course.compliance && Badge("Compliance", "warning")]),
        h("h1", { id: "page-title", tabindex: "-1", style: "color:#fff;font-size:30px" }, courseTitle(course)),
        h("p", { style: "opacity:.92;font-size:16px" }, course.description),
        h("div", { class: "row-sm small wrap", style: "opacity:.92" }, [ico("clock", 16), `${courseMinutes(course)} min`, "·", pluralize(ls.length, "lesson"), "·", pluralize(course.modules.length, "module")]),
      ]),
      h("div", { class: "stack-sm", style: "align-items:flex-end" }, [p.enrolled && ProgressRing(p.pct, { size: 64, color: "#fff", stroke: 7 }), cta]),
    ]),
  ]);

  const syllabusHost = h("div", { class: "stack" });
  const drawSyllabus = () => syllabusHost.replaceChildren(...(paid && !(access && access.canAccess) ? [h("div", { class: "callout", "data-course-locked-note": "" }, [ico("lock", 18), h("div", {}, [h("strong", {}, "Lessons unlock after purchase. "), "You can see what's inside; the content opens once your purchase is complete."])])] : []), ...syllabus());
  const syllabus = () => course.modules.map((m, mi) => h("div", { class: "card" }, [
    h("div", { class: "row-between", style: "padding:14px 20px;border-bottom:1px solid var(--c-border)" }, [h("h3", {}, `${mi + 1}. ${m.title}`), h("span", { class: "small muted" }, pluralize(m.lessons.length, "lesson"))]),
    h("div", { style: "padding:6px 10px" }, m.lessons.map((l) => {
      const done = e && isLessonDone(e, l.id), locked = e ? !isLessonUnlocked(course, e, l.id) : course.sequential && l !== ls[0];
      return h("div", { class: "lesson-row", style: "cursor:default" }, [
        h("span", { style: `display:inline-flex;color:${done ? "var(--c-success)" : "var(--c-muted)"}` }, ico(done ? "check-circle" : locked ? "lock" : LESSON_TYPES[l.type].icon, 18)),
        h("span", { class: "grow" }, [h("span", { class: "lesson-title" }, l.title), h("span", { class: "xs muted", style: "display:block" }, `${LESSON_TYPES[l.type].label} · ${l.duration} min`)]),
      ]);
    })),
  ]));
  drawSyllabus();

  // Learner-facing journey (what's done, what's next, what it unlocks). Re-renders when progress/skills land.
  const journey = (user.role === "learner" || p.enrolled) && !(paid && !p.enrolled && user.role === "learner") ? LearningJourney({ user, course, onNavigate: (href) => { if (/^\/learn\//.test(href)) enroll(user.id, course.id); navigate(href); } }) : null;
  const offs = journey ? ["data:enrollments", "data:userSkills", "data:certificates"].map((ev) => bus.on(ev, () => journey.isConnected && journey.refresh())) : [];

  const el = h("div", { class: "stack-lg" }, [
    hero,
    journey && h("section", { class: "stack" }, [SectionTitle("Your learning journey", null, "Course → modules → lessons → practice → skills → certificate"), journey]),
    h("div", { class: "detail-cols" }, [
      h("div", { class: "stack" }, [SectionTitle("What's inside"), syllabusHost]),
      h("div", { class: "stack" }, [
        skills.length > 0 && Card(h("div", { class: "stack-sm" }, [h("h3", {}, "Skills you'll build"), ...skills.map((s) => h("div", { class: "row-between small" }, [h("span", {}, [s.skill.name, h("span", { class: "xs muted", style: "display:block" }, `Target: ${LEVEL_LABELS[s.targetLevel || 3]}`)]), Badge(`+${s.points}%`, "teal")]))])),
        Card(h("div", { class: "stack-sm" }, [h("h3", {}, "Your instructor"), h("div", { class: "row" }, [Avatar(instructor), h("div", {}, [h("div", { class: "strong" }, instructor?.name), h("div", { class: "small muted" }, instructor?.title)])])])),
        Card(h("div", { class: "stack-sm" }, [h("h3", {}, "Certificate"), h("p", { class: "small muted" }, course.certExpiryMonths ? `Valid for ${course.certExpiryMonths} months, then renewal is required.` : "Earn a certificate when you finish. It never expires."), cert && Button({ label: "View my certificate", icon: "award", size: "sm", href: "/certificates" })])),
        Card(h("div", { class: "stack-sm" }, [h("h3", {}, "Discussion"), h("p", { class: "small muted" }, `${pluralize(discussion.length, "conversation")} about this course.`), Button({ label: "Open community", size: "sm", href: "/community" })])),
      ]),
    ]),
  ]);
  return { title: courseTitle(course), crumbs: [{ label: user.role === "learner" ? "Explore" : "Learning", href: user.role === "learner" ? "/explore" : "/courses" }, { label: courseTitle(course) }], el, destroy: () => offs.forEach((off) => off()) };
}
