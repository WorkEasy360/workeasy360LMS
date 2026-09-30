import { h } from "../lib/dom.js";
import { Button } from "../components/Button.js";
import { Tabs } from "../components/Tabs.js";
import { PageHeader, Card } from "../components/Card.js";
import { CourseCard } from "../components/Domain.js";
import { EmptyState } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { Badge } from "../components/Badge.js";
import { enrollmentsFor, courseProgress, nextLesson } from "../services/learning.js";
import { getCourse } from "../services/courses.js";

export function MyLearningPage(ctx) {
  const items = enrollmentsFor(ctx.user.id).map((e) => ({ e, course: getCourse(e.courseId) })).filter((x) => x.course)
    .map((x) => ({ ...x, p: courseProgress(ctx.user.id, x.course.id), next: nextLesson(x.course, x.e) }));
  const groups = {
    active: items.filter((x) => x.p.status === "in-progress"),
    todo: items.filter((x) => x.p.status === "not-started"),
    done: items.filter((x) => x.p.status === "completed"),
    purchased: items.filter((x) => x.e.source === "PURCHASE"),
  };
  let tab = groups.active.length ? "active" : groups.todo.length ? "todo" : "done";
  const list = h("div");
  const empties = {
    active: ["book", "Nothing in progress", "Start a course from the catalog."],
    todo: ["clock", "No assigned courses waiting", "Courses assigned to you will appear here."],
    done: ["award", "No completed courses yet", "Finish a course to earn a certificate."],
    purchased: ["lock", "No purchased courses yet", "Paid courses you buy will appear here, ready to start."],
  };
  const draw = () => {
    const rows = groups[tab];
    list.replaceChildren(rows.length
      ? h("div", { class: "grid grid-auto" }, rows.map((x) => {
        const due = x.e.dueAt && x.p.status !== "completed" ? Badge(`Due ${new Date(x.e.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, "warning", "clock") : x.e.source === "PURCHASE" ? Badge("Purchased", "success", "check") : null;
        return CourseCard({ course: x.course, href: x.p.status === "completed" ? `/explore/${x.course.id}` : `/learn/${x.course.id}${x.next ? "/" + x.next.id : ""}`, progress: x.p.pct, badge: due });
      }))
      : Card(EmptyState({ icon: empties[tab][0], title: empties[tab][1], description: empties[tab][2], action: Button({ label: "Explore courses", variant: "primary", href: "/explore" }) })));
  };
  draw();
  const el = h("div", { class: "stack-lg" }, [
    PageHeader({ title: "My learning", sub: "Everything you've started, been assigned or finished.", actions: [GuideButton("first-lesson"), Button({ label: "Explore", icon: "compass", href: "/explore" })] }),
    Tabs({ tabs: [{ id: "active", label: "In progress", count: groups.active.length }, { id: "todo", label: "Not started", count: groups.todo.length }, { id: "done", label: "Completed", count: groups.done.length }, { id: "purchased", label: "Purchased", count: groups.purchased.length }], active: tab, onChange: (t) => { tab = t; draw(); }, label: "Learning status" }),
    list,
  ]);
  return { title: "My learning", crumbs: [{ label: "My Learning" }], el };
}
