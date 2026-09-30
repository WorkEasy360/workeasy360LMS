// Domain components: CourseCard, LessonCard, SkillCard, JourneyNode, Cover.
import { h, pluralize } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { coverStyle, courseTitle, lessonsOf, courseMinutes, LESSON_TYPES } from "../services/courses.js";
import { priceLabel, priceTone } from "../services/pricing.js";
import { Badge, StatusBadge } from "./Badge.js";
import { Progress, MeterRow } from "./Progress.js";

export const Cover = (course, height = 132, iconSize = 44) =>
  h("div", { class: "cover", style: `${coverStyle(course.cover)};height:${height}px`, "aria-hidden": "true" }, ico(course.cover?.icon || "book", iconSize));

// CourseCard({course, href, progress, footer, badge})
export function CourseCard({ course, href, progress, reason, badge }) {
  const total = lessonsOf(course).length;
  const body = [
    Cover(course),
    h("div", { class: "course-card-body" }, [
      h("div", { class: "row-sm wrap" }, [Badge(course.category, "primary"), Badge(priceLabel(course), priceTone(course), course.price > 0 ? "lock" : null), badge, reason && Badge(reason, "teal")]),
      h("h3", {}, courseTitle(course)),
      h("p", { class: "small muted", style: "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden" }, course.description || "No description yet."),
      h("div", { class: "course-card-foot stack-sm" }, [
        progress != null
          ? [Progress(progress, { size: "sm", label: `${courseTitle(course)} progress` }), h("div", { class: "row-between xs muted" }, [h("span", {}, `${progress}% complete`), h("span", {}, pluralize(total, "lesson"))])]
          : h("div", { class: "row-sm xs muted" }, [ico("clock", 14), `${courseMinutes(course)} min`, "·", pluralize(total, "lesson"), "·", course.level]),
      ]),
    ]),
  ];
  return h("a", { class: "card card-hover card-link course-card", href: "#" + href }, body);
}

// LessonCard: a row in an outline (player) — status aware.
export function LessonCard({ lesson, index, status = "todo", active, locked, onClick, href }) {
  const t = LESSON_TYPES[lesson.type] || LESSON_TYPES.lesson;
  const stateIcon = status === "done" ? ico("check-circle", 20) : locked ? ico("lock", 18) : ico(t.icon, 18);
  const color = status === "done" ? "var(--c-success)" : active ? "var(--c-primary)" : "var(--c-muted)";
  return h(href && !locked ? "a" : "button", {
    class: ["lesson-row", active && "is-active", locked && "is-locked", status === "done" && "is-done"], type: href ? undefined : "button",
    href: href && !locked ? "#" + href : undefined, disabled: locked && !href, "aria-current": active ? "step" : undefined,
    "aria-disabled": locked ? "true" : undefined, onclick: locked ? (e) => e.preventDefault() : onClick,
    title: locked ? "Complete the previous lesson to unlock" : undefined,
  }, [
    h("span", { style: `color:${color};display:inline-flex` }, stateIcon),
    h("span", { class: "grow" }, [h("span", { class: "lesson-title" }, lesson.title), h("span", { class: "xs muted", style: "display:block" }, `${t.label} · ${lesson.duration || 0} min`)]),
  ]);
}

export function SkillCard({ item, compact }) {
  const { skill, level, target, gap, contributors } = item;
  const status = level >= target ? ["On target", "success"] : gap > 25 ? ["Gap", "warning"] : ["Building", "primary"];
  return h("div", { class: "card card-pad-sm stack-sm" }, [
    h("div", { class: "row-between" }, [h("h4", {}, skill.name), Badge(status[0], status[1])]),
    !compact && h("p", { class: "small muted" }, skill.description),
    MeterRow("Level", level, { target }),
    h("div", { class: "xs muted" }, gap ? `${gap}% to reach your ${target}% target` : "You've reached your target"),
    !compact && contributors.length > 0 && h("div", { class: "xs muted" }, ["Boosted by: ", contributors.map((c) => `${c.course.title} (+${c.gain}%)`).join(", ")]),
  ]);
}

// JourneyNode: a button in the visual learning journey.
export function JourneyNode({ node, selected, onSelect }) {
  const s = node.status;
  const iconName = node.type === "milestone" ? "flag" : s === "completed" ? "check" : s === "locked" ? "lock" : node.course?.cover?.icon || "book";
  return h("button", {
    class: ["jnode", `is-${s}`, selected && "is-selected", node.type === "milestone" && "is-milestone"], type: "button", "data-node": node.id,
    "aria-pressed": String(!!selected), onclick: () => onSelect(node),
    "aria-label": `${node.title}, ${s.replace("-", " ")}, ${node.pct}%`,
  }, [
    h("span", { class: "jnode-icon" }, ico(iconName, 22)),
    h("span", { class: "jnode-body" }, [h("span", { class: "jnode-title" }, node.title), h("span", { class: "xs jnode-sub" }, s === "completed" ? "Completed" : s === "locked" ? "Locked" : `${node.pct}%`)]),
    node.type === "course" && s !== "locked" && h("span", { class: "jnode-bar" }, h("span", { style: `width:${node.pct}%` })),
  ]);
}

export { StatusBadge };
