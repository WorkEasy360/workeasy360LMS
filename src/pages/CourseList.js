// Course management list. Instructor: "My Courses" (own courses). Admin: "Learning" (all courses + management actions).
// One implementation for both roles — actions are shown according to permissions (see services/permissions.js).
import { h, timeAgo, pluralize, fmtDate } from "../lib/dom.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { Dropdown } from "../components/Menu.js";
import { Tabs } from "../components/Tabs.js";
import { SearchInput, Field, Select, Input } from "../components/Form.js";
import { PageHeader, Card } from "../components/Card.js";
import { StatusBadge, Badge, Avatar } from "../components/Badge.js";
import { Progress } from "../components/Progress.js";
import { Cover } from "../components/Domain.js";
import { EmptyState, withLoading } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { confirmDialog, toast, openModal } from "../components/Overlay.js";
import { listCourses, courseTitle, lessonsOf, deleteCourse, publishReadiness, publishCourse, unpublishCourse, archiveCourse, restoreCourse, assignInstructor, getCourse } from "../services/courses.js";
import { courseStats } from "../services/analytics.js";
import { userById, users } from "../services/people.js";
import { courseProgress } from "../services/learning.js";
import { enrolledUsers, assign, unenroll } from "../services/enrollments.js";
import { can } from "../services/permissions.js";

const TABS = [["all", "All"], ["draft", "Draft"], ["in_review", "In review"], ["published", "Published"], ["archived", "Archived"]];

export function CourseListPage(ctx) {
  const user = ctx.user;
  const isAdmin = user.role === "admin";
  let tab = "all", q = "";
  const listEl = h("div");
  const tabHost = h("div", { style: "min-width:0;max-width:100%" }); // the tab strip scrolls inside its own width on narrow screens

  const all = () => listCourses(isAdmin ? {} : { instructorId: user.id });
  const rows = () => all().filter((c) => (tab === "all" || c.status === tab) && (!q || courseTitle(c).toLowerCase().includes(q.toLowerCase())));

  const createBtn = (extra = {}) => Button({ label: "Create Course", icon: "plus", variant: "primary", href: "/builder/new", ...extra });

  function paintTabs() {
    const n = (s) => all().filter((c) => s === "all" || c.status === s).length;
    tabHost.replaceChildren(Tabs({ tabs: TABS.map(([id, label]) => ({ id, label, count: n(id) })), active: tab, onChange: (t) => { tab = t; draw(true); }, label: "Course status" }));
  }

  function draw(keepTabs = false) {
    const list = rows();
    listEl.replaceChildren(
      list.length
        ? h("div", { class: "stack" }, list.map(courseCard))
        : Card(all().length
          ? EmptyState({ icon: "search", title: tab === "all" ? "No courses match" : `No ${TABS.find((t) => t[0] === tab)[1].toLowerCase()} courses`, description: "Try a different filter or search term." })
          : EmptyState({ icon: "rocket", title: "Create your first course", description: "Build a course in minutes — or let the guide walk you through it.", action: h("div", { class: "row" }, [createBtn({ attrs: { "data-guide-target": "courses.new-empty" } }), GuideButton("create-first-course")]) })),
      all().length > 0 && h("div", { class: "row", style: "justify-content:center;margin-top:24px" }, createBtn({ size: "lg", attrs: { "data-guide-target": "courses.new-bottom" } }))
    );
    if (!keepTabs) paintTabs();
  }
  const refresh = () => draw();

  function courseCard(c) {
    const st = courseStats(c);
    const ready = publishReadiness(c);
    const complete = Math.round((ready.filter((r) => r.ok).length / ready.length) * 100);
    const author = userById(c.instructorId);
    const editable = can(user, "course.edit", c);
    const primary = c.status === "draft" ? "Continue" : "Open Course";
    const publishedLike = c.status === "published";
    const meta = publishedLike
      ? [h("span", {}, [h("strong", {}, String(st.enrolled)), st.enrolled === 1 ? " learner" : " learners"]), h("span", {}, [h("strong", {}, `${st.enrolled ? Math.round((st.completed / st.enrolled) * 100) : 0}%`), " completion"])]
      : [h("span", {}, pluralize(c.modules.length, "module")), h("span", {}, [h("strong", {}, `${complete}%`), " complete"])];
    return h("article", { class: "card course-card-row", "aria-label": courseTitle(c) }, [
      h("a", { href: `#/builder/${c.id}`, tabindex: "-1", "aria-hidden": "true", class: "ccr-cover" }, Cover(c, 96, 30)),
      h("div", { class: "grow ccr-main" }, [
        h("div", { class: "row-sm wrap" }, [h("a", { class: "strong ccr-title", href: `#/builder/${c.id}` }, courseTitle(c)), StatusBadge(c.status), c.visibility === "assigned" && Badge("Hidden", "", "lock")]),
        h("div", { class: "row wrap small muted", style: "gap:4px 16px" }, [...meta, h("span", {}, `${pluralize(lessonsOf(c).length, "lesson")}`), h("span", {}, `Updated ${timeAgo(c.updatedAt)}`), isAdmin && author && h("span", {}, `Instructor: ${author.name}`)]),
        !publishedLike && h("div", { style: "max-width:260px" }, Progress(complete, { size: "sm", label: "Course completeness" })),
      ]),
      h("div", { class: "row-sm ccr-actions" }, [
        editable ? Button({ label: primary, variant: "primary", size: "sm", href: `/builder/${c.id}` }) : Button({ label: "View", size: "sm", href: `/explore/${c.id}` }),
        Dropdown({ icon: "more", iconRight: null, variant: "ghost", size: "sm", title: `More actions for ${courseTitle(c)}`, align: "right", items: menuItems(c) }),
      ]),
    ]);
  }

  function menuItems(c) {
    const items = [{ label: "Open in Course Builder", icon: "edit", href: `/builder/${c.id}`, disabled: !can(user, "course.edit", c) }];
    if (c.status === "published") items.push({ label: "Preview as learner", icon: "eye", href: `/explore/${c.id}` });
    if (can(user, "course.enrollments", c)) items.push({ label: "Learners & progress", icon: "users", href: "/learners" }, { label: "Manage enrollments", icon: "user", onClick: () => manageEnrollments(c) });
    if (can(user, "course.analytics", c)) items.push({ label: "Course analytics", icon: "chart", href: "/analytics" });
    items.push("sep");
    if (can(user, "course.assign", c)) items.push({ label: "Assign instructor", icon: "cap", onClick: () => assignDialog(c) });
    if (c.status === "draft" && can(user, "course.publish", c)) items.push({ label: "Publish", icon: "rocket", onClick: () => act(publishCourse(c.id, user), c) });
    if (c.status === "in_review" && can(user, "course.review", c)) items.push({ label: "Approve & publish", icon: "check-circle", onClick: () => { const r = publishCourse(c.id, user); act(r, c); } });
    if (c.status === "published" && can(user, "course.publish", c)) items.push({ label: "Unpublish", icon: "arrow-down", onClick: () => { unpublishCourse(c.id); toast("Moved back to draft", { type: "info" }); refresh(); } });
    if (c.status !== "archived" && can(user, "course.archive", c)) items.push({ label: "Archive", icon: "lock", onClick: async () => { if (await confirmDialog({ title: `Archive “${courseTitle(c)}”?`, message: "It will be hidden from learners. You can restore it any time.", confirmLabel: "Archive" })) { archiveCourse(c.id); toast("Course archived", { type: "info" }); refresh(); } } });
    if (c.status === "archived" && can(user, "course.archive", c)) items.push({ label: "Restore to draft", icon: "refresh", onClick: () => { restoreCourse(c.id); refresh(); } });
    if (isAdmin) items.push({ label: "Delete course", icon: "trash", onClick: async () => { if (enrolledUsers(c.id).length) { toast("This course has enrolled learners — archive it instead to keep their progress and certificates.", { type: "error" }); return; } if (await confirmDialog({ title: `Delete “${courseTitle(c)}”?`, message: "This can't be undone. Consider archiving instead.", confirmLabel: "Delete", danger: true })) { deleteCourse(c.id); refresh(); toast("Course deleted", { type: "info" }); } } });
    return items;
  }

  function act(res, c) {
    if (!res.ok) toast(res.denied ? "You don't have permission to publish." : `Not ready: ${res.blockers.map((b) => b.label).join("; ")}`, { type: "error" });
    else toast(res.status === "in_review" ? "Submitted for review" : "Course published");
    refresh();
  }

  function assignDialog(c) {
    const sel = Select({ options: users().filter((u) => u.role !== "learner").map((u) => ({ value: u.id, label: `${u.name} — ${u.role}` })), value: c.instructorId });
    openModal({ title: "Assign instructor", size: "sm", content: h("div", { class: "stack" }, [h("p", { class: "muted small" }, `Who should own “${courseTitle(c)}”?`), Field({ label: "Instructor", control: sel })]),
      footer: (close) => [Button({ label: "Cancel", onClick: close }), Button({ label: "Assign", variant: "primary", onClick: () => { assignInstructor(c.id, sel.value); close(); toast(`Assigned to ${userById(sel.value).name}`); refresh(); } })] });
  }

  function manageEnrollments(c) {
    const body = h("div", { class: "stack" });
    const paint = () => {
      const es = enrolledUsers(c.id);
      const candidates = users().filter((u) => u.role === "learner" && !es.some((e) => e.userId === u.id));
      const pick = Select({ options: candidates.length ? candidates.map((u) => ({ value: u.id, label: `${u.name} — ${u.dept}` })) : [{ value: "", label: "Everyone is already enrolled" }], value: candidates[0]?.id, attrs: { "aria-label": "Learner to enrol", disabled: !candidates.length } });
      const due = Input({ type: "date", "aria-label": "Due date (optional)" });
      body.replaceChildren(
        h("div", { class: "row wrap" }, [h("div", { class: "grow", style: "min-width:200px" }, pick), h("div", {}, due), Button({ label: "Enrol", icon: "plus", variant: "primary", disabled: !candidates.length, onClick: () => { assign(pick.value, c.id, { dueAt: due.value ? new Date(due.value).getTime() : null }); toast("Learner enrolled"); paint(); } })]),
        es.length ? h("div", {}, es.map((e) => { const u = userById(e.userId); return h("div", { class: "list-row" }, [Avatar(u, "sm"), h("div", { class: "grow" }, [h("div", { class: "strong small" }, u?.name), h("div", { class: "xs muted" }, `${courseProgress(e.userId, c.id).pct}% complete${e.dueAt ? ` · due ${fmtDate(e.dueAt)}` : ""}`)]), Button({ icon: "x", variant: "ghost", size: "sm", title: `Remove ${u?.name}`, onClick: () => { unenroll(e.userId, c.id); paint(); } })]); })) : h("p", { class: "small muted" }, "No one is enrolled yet.")
      );
    };
    paint();
    openModal({ title: `Enrollments · ${courseTitle(c)}`, size: "lg", content: body, footer: (close) => [Button({ label: "Done", variant: "primary", onClick: () => { close(); refresh(); } })] });
  }

  const el = h("div", { class: "stack-lg" }, [
    PageHeader({
      title: isAdmin ? "Learning" : "My Courses", sub: isAdmin ? "Every course across the organisation — create, assign, review and manage." : "Create, edit and publish your courses.",
      actions: [GuideButton("create-first-course"), Button({ label: "Create with AI", icon: "sparkles", variant: "secondary", href: "/builder/ai", attrs: { "data-guide-target": "courses.ai" } }), createBtn({ attrs: { "data-guide-target": "courses.new" } })],
    }),
    h("div", { class: "row-between wrap" }, [tabHost, h("div", { style: "width:min(280px,100%)" }, SearchInput({ placeholder: "Search courses", onInput: (v) => { q = v; draw(true); } }))]),
    listEl,
  ]);
  const stop = withLoading(listEl, () => { draw(); return [...listEl.childNodes]; }, { delay: 160, skeleton: () => h("div", { class: "stack" }, [1, 2, 3].map(() => h("div", { class: "skeleton", style: "height:96px" }))) });
  paintTabs();
  ["data:courses", "data:enrollments"].forEach((ev) => bus.on(ev, () => listEl.isConnected && draw())); // live updates from other panels
  return { title: isAdmin ? "Learning" : "My Courses", crumbs: [{ label: isAdmin ? "Learning" : "My Courses" }], el, destroy: stop };
}
