import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { initials, avatarBg } from "../services/people.js";

export function Badge(label, variant = "", iconName) {
  return h("span", { class: ["badge", variant && `badge-${variant}`] }, [iconName && ico(iconName, 12), label]);
}

export function Avatar(user, size = "") {
  return h("span", { class: ["avatar", size && `avatar-${size}`], style: avatarBg(user), title: user?.name, "aria-hidden": "true" }, initials(user?.name));
}

const STATUS = {
  published: ["Published", "success"], draft: ["Draft", "warning"], in_review: ["In review", "info"], archived: ["Archived", ""],
  completed: ["Completed", "success"], "in-progress": ["In progress", "primary"], "not-started": ["Not started", ""],
  available: ["Ready", "primary"], locked: ["Locked", ""],
  valid: ["Valid", "success"], expiring: ["Expiring soon", "warning"], expired: ["Expired", "danger"], revoked: ["Revoked", "danger"],
  submitted: ["Awaiting review", "warning"], reviewed: ["Reviewed", "success"],
};
export function StatusBadge(status) {
  const [label, variant] = STATUS[status] || [status, ""];
  return Badge(label, variant);
}
