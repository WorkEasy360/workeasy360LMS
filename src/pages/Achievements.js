import { h, timeAgo } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card } from "../components/Card.js";
import { Progress } from "../components/Progress.js";
import { EmptyState } from "../components/States.js";
import { achievements } from "../services/learning.js";
import { notificationsFor, markRead } from "../services/people.js";
import { toast } from "../components/Overlay.js";
import { refreshChrome } from "../layout/Shell.js";
import { bus } from "../lib/events.js";

export function AchievementsPage(ctx) {
  const list = achievements(ctx.user.id);
  const earned = list.filter((a) => a.earned).length;
  const el = h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Achievements", sub: "Small wins that add up. Keep learning to unlock the rest." }),
    Card(h("div", { class: "stack-sm" }, [h("div", { class: "row-between" }, [h("h3", {}, `${earned} of ${list.length} earned`), h("span", { class: "strong" }, `${Math.round((earned / list.length) * 100)}%`)]), Progress((earned / list.length) * 100, { size: "lg", label: "Achievements earned" })])),
    h("div", { class: "grid grid-3" }, list.map((a) => h("div", { class: ["card card-pad badge-card", !a.earned && "is-locked"] }, [
      h("span", { class: "medal" }, ico(a.earned ? a.icon : "lock", 26)),
      h("div", { class: "grow" }, [h("h3", {}, a.title), h("p", { class: "small muted" }, a.desc), h("div", { class: "xs strong", style: a.earned ? "color:var(--c-success)" : "" }, a.earned ? "Earned" : a.hint)]),
    ]))),
  ]);
  return { title: "Achievements", crumbs: [{ label: "Achievements" }], el };
}

export function NotificationsPage(ctx) {
  const list = h("div");
  const draw = () => {
    const items = notificationsFor(ctx.user.id);
    list.replaceChildren(items.length
      ? Card(items.map((n) => h("a", { class: "list-row", href: "#" + n.href, "data-notification": n.kind, style: `color:inherit;text-decoration:none;${n.read ? "" : "background:var(--c-primary-soft);margin:0 -24px;padding:12px 24px"}`, onclick: () => markRead(ctx.user.id, n.id) }, [
        h("span", { class: "icon-tile" }, ico({ due: "clock", reply: "message", achievement: "award", submission: "upload", expiry: "shield", insight: "chart", review: "clipboard", enrolment: "book" }[n.kind] || "bell", 20)),
        h("div", { class: "grow" }, [h("div", { class: "strong" }, n.title), h("div", { class: "small muted" }, n.body)]),
        h("span", { class: "xs muted nowrap" }, timeAgo(n.at)),
      ])), { pad: true })
      : Card(EmptyState({ icon: "bell", title: "You're all caught up", description: "New notifications will appear here." })));
  };
  draw();
  const off = bus.on("data:notifications", draw); // backend pulls (login hydration, event-driven refresh) land here
  return { title: "Notifications", crumbs: [{ label: "Notifications" }], el: h("div", { class: "stack-lg", "data-notifications-page": "" }, [
    PageHeader({ title: "Notifications", actions: [Button({ label: "Mark all read", icon: "check", onClick: () => { markRead(ctx.user.id); draw(); refreshChrome(); toast("All caught up", { type: "info" }); } })] }), list,
  ]), destroy: off };
}
