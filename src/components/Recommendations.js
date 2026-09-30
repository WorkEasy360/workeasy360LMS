// Recommendation cards + "Your next step" + learning plan card, shared by Home and the Coach.
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { bus } from "../lib/events.js";
import { Button } from "./Button.js";
import { Badge } from "./Badge.js";
import { Progress } from "./Progress.js";
import { toast } from "./Overlay.js";
import { TYPE_LABELS, TYPE_ICONS, CTA_LABELS, giveFeedback, planAction } from "../services/coach.js";
import { navigate } from "../router.js";

/** ONE primary recommended action. */
export function NextStep(rec) {
  if (!rec) return null;
  return h("section", { class: "card card-pad next-step", "data-guide-target": "home.next-step", "data-rec-id": rec.id, "data-rec-type": rec.type, "aria-label": "Your next step" }, [
    h("div", { class: "row wrap", style: "gap:18px;align-items:center" }, [
      h("span", { class: "icon-tile", style: "width:52px;height:52px;border-radius:14px" }, ico(TYPE_ICONS[rec.type] || "sparkles", 24)),
      h("div", { class: "grow", style: "min-width:220px" }, [
        h("div", { class: "eyebrow" }, "Your next step"),
        h("div", { class: "strong", style: "font-size:20px" }, rec.title),
        h("div", { class: "row-sm wrap xs muted", style: "margin-top:4px" }, [Badge(TYPE_LABELS[rec.type] || rec.type, "primary"), rec.skillName && Badge(rec.skillName, "teal"), rec.minutes != null && h("span", { class: "row-sm" }, [ico("clock", 14), `~${rec.minutes} min`]), rec.progressPct != null && h("span", {}, `${rec.progressPct}% complete`)]),
        h("div", { class: "small", style: "margin-top:8px", "data-guide-target": "rec.reason" }, [h("strong", {}, "Why: "), rec.reason]),
      ]),
      Button({ label: CTA_LABELS[rec.type] || "Open", icon: "arrow-right", variant: "primary", size: "lg", attrs: { "data-guide-target": "rec.cta", "data-rec-cta": rec.id }, onClick: () => navigate(rec.href) }),
    ]),
  ]);
}

/** One recommendation card with feedback controls. onChange() is called after feedback so the host can reload. */
export function RecommendationCard(rec, { onChange } = {}) {
  const card = h("article", { class: "card card-pad-sm rec-card stack-sm", "data-rec-card": rec.id, "data-rec-type": rec.type, "data-guide-target": "rec.card" }, [
    h("div", { class: "row-between" }, [h("span", { class: "row-sm" }, [h("span", { class: "icon-tile", style: "width:32px;height:32px;border-radius:9px" }, ico(TYPE_ICONS[rec.type] || "sparkles", 16)), Badge(TYPE_LABELS[rec.type] || rec.type, "")]), rec.minutes != null && h("span", { class: "xs muted row-sm" }, [ico("clock", 12), `~${rec.minutes} min`])]),
    h("h4", {}, rec.title),
    rec.skillName && h("div", { class: "row-sm xs" }, [ico("target", 12), h("span", { class: "muted" }, "Skill: "), rec.skillName]),
    rec.progressPct != null && Progress(rec.progressPct, { size: "sm", label: `${rec.title} progress` }),
    h("p", { class: "small", "data-rec-reason": rec.id }, rec.reason),
    h("div", { class: "row-between wrap" }, [
      Button({ label: CTA_LABELS[rec.type] || "Open", icon: "arrow-right", size: "sm", variant: "primary", attrs: { "data-rec-cta": rec.id }, onClick: () => navigate(rec.href) }),
      h("span", { class: "row-sm rec-feedback", role: "group", "aria-label": `Feedback on ${rec.title}`, "data-guide-target": "rec.feedback" }, [
        Button({ icon: "thumbs", variant: "ghost", size: "sm", title: "Helpful", attrs: { "aria-label": "Helpful", "data-rec-feedback": "HELPFUL", "aria-pressed": String(rec.feedback === "HELPFUL") }, onClick: () => feedback("HELPFUL") }),
        Button({ icon: "minus", variant: "ghost", size: "sm", title: "Not relevant", attrs: { "aria-label": "Not relevant", "data-rec-feedback": "NOT_RELEVANT" }, onClick: () => feedback("NOT_RELEVANT") }),
        Button({ icon: "x", variant: "ghost", size: "sm", title: "Dismiss", attrs: { "aria-label": "Dismiss", "data-rec-feedback": "DISMISSED" }, onClick: () => feedback("DISMISSED") }),
      ]),
    ]),
  ]);
  async function feedback(value) {
    try {
      await giveFeedback(rec.id, value);
      if (value === "HELPFUL") { toast("Thanks — we'll show you more like this", { type: "info", duration: 1800 }); card.querySelector('[data-rec-feedback="HELPFUL"]').setAttribute("aria-pressed", "true"); }
      else { card.classList.add("is-leaving"); setTimeout(() => { card.remove(); onChange?.(value); }, 250); toast(value === "DISMISSED" ? "Dismissed — we won't suggest this again for a while" : "Noted — we'll stop suggesting this", { type: "info", duration: 2200 }); }
    } catch (err) { toast(err.message, { type: "error" }); }
  }
  return card;
}

export function RecommendationList(recs, { onChange } = {}) {
  return h("div", { class: "grid grid-2 rec-grid", "data-guide-target": "home.recommendations" }, recs.slice(0, 5).map((r, i) => { const c = RecommendationCard(r, { onChange }); c.style.setProperty("--i", i); return c; }));
}

/** Learning plan card: items with completion state; Start / Continue / Complete / Dismiss. */
export function PlanCard(plan, { onChange } = {}) {
  const act = async (action) => { try { const p = await planAction(plan.id, action); bus.emit("plan.changed", { id: plan.id, status: p.status }); onChange?.(p); } catch (err) { toast(err.message, { type: "error" }); } };
  const next = plan.items.find((i) => !i.done);
  return h("section", { class: "card card-pad plan-card stack-sm", "data-plan": plan.id, "data-plan-status": plan.status, "aria-label": plan.title }, [
    h("div", { class: "row-between wrap" }, [h("div", {}, [h("div", { class: "eyebrow" }, plan.source === "COACH" ? "Plan from your coach" : "Learning plan"), h("h3", {}, plan.title)]), Badge(plan.status === "COMPLETED" ? "Completed" : plan.status === "ACTIVE" ? "In progress" : plan.status === "DISMISSED" ? "Dismissed" : "Ready", plan.status === "COMPLETED" ? "success" : plan.status === "ACTIVE" ? "primary" : "")]),
    Progress(plan.items.length ? Math.round((plan.doneCount / plan.items.length) * 100) : 0, { size: "sm", label: `${plan.title} progress` }),
    h("ol", { class: "plan-items" }, plan.items.map((it) => h("li", { class: ["plan-item", it.done && "is-done", next && it.id === next.id && plan.status === "ACTIVE" && "is-current"], "data-plan-item": it.id }, [
      h("span", { class: "plan-dot" }, ico(it.done ? "check" : it.kind === "QUIZ" ? "clipboard" : it.kind === "PRACTICE" ? "edit" : it.kind === "REVIEW" ? "refresh" : "book", 14)),
      h("span", { class: "grow small" }, [h("span", { class: "xs muted" }, `${it.kind.charAt(0)}${it.kind.slice(1).toLowerCase()} · ${it.minutes} min`), h("span", { style: "display:block" }, it.title)]),
      it.lessonId ? Button({ label: it.done ? "Review" : "Open", size: "sm", variant: "ghost", href: it.href }) : !it.done && plan.status === "ACTIVE" ? Button({ label: "Done", size: "sm", variant: "ghost", onClick: async () => { const { planItemDone } = await import("../services/coach.js"); const p = await planItemDone(plan.id, it.id); onChange?.(p); } }) : null,
    ]))),
    h("div", { class: "row wrap" }, [
      plan.status === "DRAFT" && Button({ label: "Start plan", icon: "play", variant: "primary", size: "sm", attrs: { "data-plan-action": "start" }, onClick: () => act("start") }),
      plan.status === "ACTIVE" && next && Button({ label: "Continue", icon: "arrow-right", variant: "primary", size: "sm", attrs: { "data-plan-action": "continue" }, href: next.href }),
      plan.status === "ACTIVE" && Button({ label: "Mark complete", icon: "check", variant: "secondary", size: "sm", attrs: { "data-plan-action": "complete" }, onClick: () => act("complete") }),
      (plan.status === "DRAFT" || plan.status === "ACTIVE") && Button({ label: "Dismiss", variant: "ghost", size: "sm", attrs: { "data-plan-action": "dismiss" }, onClick: () => act("dismiss") }),
    ]),
  ]);
}
