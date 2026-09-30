import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "./Button.js";

export function EmptyState({ icon = "sparkles", title, description, action }) {
  return h("div", { class: "state" }, [h("div", { class: "state-icon" }, ico(icon, 26)), h("h3", {}, title), description && h("p", {}, description), action || null]);
}

export function LoadingState(label = "Loading…") {
  return h("div", { class: "state", role: "status", "aria-live": "polite" }, [h("div", { class: "spinner" }), h("p", {}, label)]);
}

export function ErrorState({ title = "Something went wrong", description = "Please try again.", onRetry }) {
  return h("div", { class: "state is-error", role: "alert" }, [
    h("div", { class: "state-icon" }, ico("alert", 26)), h("h3", {}, title), h("p", {}, description),
    onRetry && Button({ label: "Try again", icon: "refresh", onClick: onRetry }),
  ]);
}

export function SkeletonList(rows = 3, height = 72) {
  return h("div", { class: "stack", "aria-hidden": "true" }, Array.from({ length: rows }, () => h("div", { class: "skeleton", style: `height:${height}px` })));
}

// Show a skeleton briefly, then render — gives every data screen a real loading state.
export function withLoading(container, build, { delay = 220, skeleton = () => SkeletonList(3) } = {}) {
  container.replaceChildren(skeleton());
  let dead = false;
  const t = setTimeout(() => {
    if (dead) return;
    try {
      const out = build();
      container.replaceChildren(...(Array.isArray(out) ? out : [out]));
    } catch (err) {
      console.error(err);
      container.replaceChildren(ErrorState({ description: "This section could not be loaded.", onRetry: () => withLoading(container, build, { delay, skeleton }) }));
    }
  }, delay);
  return () => { dead = true; clearTimeout(t); };
}
