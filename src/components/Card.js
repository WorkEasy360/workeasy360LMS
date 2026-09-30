import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "./Button.js";

export const Card = (children, { pad = true, cls = "", attrs = {} } = {}) => h("div", { class: ["card", pad && "card-pad", cls], ...attrs }, children);

export function SectionTitle(title, action, sub) {
  return h("div", { class: "section-title" }, [
    h("div", {}, [h("h2", {}, title), sub && h("p", { class: "muted small" }, sub)]),
    action || null,
  ]);
}

export function StatCard({ label, value, delta, icon = "chart", tone = "", foot }) {
  return h("div", { class: "card card-pad-sm" }, [
    h("div", { class: "row-between" }, [h("span", { class: "small muted strong" }, label), h("span", { class: ["icon-tile", tone], style: "width:34px;height:34px;border-radius:10px" }, ico(icon, 18))]),
    h("div", { class: "stat-value", style: "margin-top:10px" }, String(value)),
    (delta || foot) && h("div", { class: "xs muted", style: "margin-top:6px" }, delta || foot),
  ]);
}

// PageHeader: title + supporting line + actions. The primary action should be the last (right-most) one.
export function PageHeader({ title, sub, actions = [], eyebrow }) {
  return h("div", { class: "page-head" }, [
    h("div", {}, [eyebrow && h("div", { class: "eyebrow", style: "margin-bottom:6px" }, eyebrow), h("h1", { tabindex: "-1", id: "page-title" }, title), sub && h("p", { class: "sub" }, sub)]),
    actions.length ? h("div", { class: "row wrap" }, actions) : null,
  ]);
}

export function ListRow({ leading, title, sub, trailing, href, onClick }) {
  const inner = [leading, h("div", { class: "grow" }, [h("div", { class: "strong truncate" }, title), sub && h("div", { class: "small muted truncate" }, sub)]), trailing];
  return href
    ? h("a", { class: "list-row", href: "#" + href, style: "color:inherit;text-decoration:none" }, inner)
    : h("div", { class: "list-row", onclick: onClick, style: onClick ? "cursor:pointer" : "" }, inner);
}
