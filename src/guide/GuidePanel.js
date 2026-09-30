// GuidePanel: the persistent ~1/3 side panel (bottom sheet on mobile). Stays open while the user works in the live app.
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Badge } from "../components/Badge.js";
import { guideEngine } from "./GuideEngine.js";
import { GUIDE_TYPES } from "./guides.js";
import { navigate } from "../router.js";
import { announce } from "../lib/dom.js";

let lastAnnounced = "";

export function initGuidePanel() {
  const root = document.getElementById("guide-root");
  guideEngine.subscribe((state) => render(root, state));
  render(root, guideEngine.state);
}

function render(root, state) {
  const focusKey = root.contains(document.activeElement) ? document.activeElement?.dataset?.key : null;
  const scroller = root.querySelector(".guide-body");
  const scrollTop = scroller?.scrollTop || 0;
  root.replaceChildren();
  if (!state.open) return;
  const { guide } = state;
  const step = guideEngine.step;
  const panel = h("aside", { class: "guide-panel", role: "complementary", "aria-label": `Guide: ${guide.title}` });
  panel.appendChild(header(guide, state));
  panel.appendChild(state.finished ? completion(guide, state) : body(guide, step, state));
  if (!state.finished) panel.appendChild(footer(state, step));
  root.appendChild(panel);

  const newScroller = panel.querySelector(".guide-body");
  if (newScroller && !state.finished) newScroller.scrollTop = scrollTop;

  const msg = state.finished ? `Guide complete: ${guide.title}` : `Step ${state.stepIndex + 1} of ${guide.steps.length}: ${step.title}${state.stepDone ? " — done" : ""}`;
  if (msg !== lastAnnounced) { lastAnnounced = msg; announce(msg); }
  (focusKey && panel.querySelector(`[data-key="${focusKey}"]:not([disabled])`))?.focus();
}

function header(guide, state) {
  const remaining = guide.steps.slice(state.stepIndex + (state.stepDone ? 1 : 0)).reduce((n, s) => n + (s.estimatedDuration || 10), 0);
  return h("div", { class: "guide-head" }, [
    h("div", { class: "row" }, [
      h("span", { class: "icon-tile" }, ico("sparkles", 20)),
      h("div", { class: "grow" }, [
        h("div", { class: "eyebrow" }, GUIDE_TYPES[guide.type] || "Guide"),
        h("div", { class: "guide-title" }, guide.title),
      ]),
      h("button", { class: "btn btn-ghost btn-icon btn-sm guide-collapse", type: "button", "aria-label": "Collapse or expand guide", "data-key": "collapse", onclick: () => document.body.classList.toggle("sheet-min") }, ico("chevron-down", 18)),
      Button({ icon: "refresh", variant: "ghost", size: "sm", title: "Restart guide", onClick: () => guideEngine.restart(), attrs: { "data-key": "restart" } }),
      Button({ icon: "x", variant: "ghost", size: "sm", title: "Exit guide", onClick: () => guideEngine.close(), attrs: { "data-key": "exit" } }),
    ]),
    !state.finished && h("div", { class: "guide-progress" }, [
      h("div", { class: "row-between xs muted strong" }, [h("span", {}, `Step ${state.stepIndex + 1} of ${guide.steps.length}`), h("span", {}, remaining ? `~${Math.max(1, Math.round(remaining / 60))} min left` : "Almost done")]),
      h("div", { class: "seg-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(guide.steps.length), "aria-valuenow": String(guideEngine.completed.size), "aria-label": "Guide progress" },
        guide.steps.map((s, i) => h("span", { class: ["seg", guideEngine.completed.has(s.id) && "is-done", i === state.stepIndex && "is-current"] }))),
    ]),
  ]);
}

function body(guide, step, state) {
  const done = state.stepDone;
  const status = state.misroute
    ? h("div", { class: "guide-status is-warn" }, [
        h("div", { class: "row-sm" }, [ico("compass", 18), h("strong", {}, "This step happens on another screen")]),
        h("p", { class: "small" }, "The highlighted control isn't on this page."),
        Button({ label: step.route?.label || "Take me there", variant: "primary", size: "sm", icon: "arrow-right", onClick: () => guideEngine.goToStepRoute(), attrs: { "data-key": "goto" } }),
      ])
    : done
      ? h("div", { class: "guide-status is-done", role: "status" }, [ico("check-circle", 20), h("div", {}, [h("strong", {}, "Nice — that's done."), h("div", { class: "small" }, state.stepIndex < guide.steps.length - 1 ? "Moving to the next step…" : "Wrapping up…")])])
      : h("div", { class: "guide-status is-wait", role: "status" }, [h("span", { class: "spinner" }), h("div", {}, [h("strong", {}, step.passive ? "In progress…" : "Your turn"), h("div", { class: "small" }, step.action ? `${step.action} in the highlighted area.` : "Do this in the app on the left.")])]);

  return h("div", { class: "guide-body" }, [
    h("div", { class: "guide-step", key: step.id }, [
      h("div", { class: "guide-step-num" }, done ? ico("check", 18) : String(step.order)),
      h("div", { class: "grow" }, [
        h("h3", { tabindex: "-1", id: "guide-step-title" }, step.title),
        h("p", { class: "guide-desc" }, step.description),
        step.tip && h("div", { class: "callout tip", style: "margin-top:12px" }, [ico("bulb", 18), h("div", {}, step.tip)]),
      ]),
    ]),
    status,
    h("div", { class: "eyebrow", style: "margin:24px 0 8px" }, "All steps"),
    h("ol", { class: "guide-steps" }, guide.steps.map((s, i) => {
      const isDone = guideEngine.completed.has(s.id);
      const current = i === state.stepIndex;
      const reachable = i <= state.stepIndex;
      return h("li", {}, h("button", {
        class: ["guide-step-item", current && "is-current", isDone && "is-done"], type: "button", disabled: !reachable, "data-key": `step-${i}`,
        "aria-current": current ? "step" : undefined, onclick: () => guideEngine.goToStep(i),
      }, [h("span", { class: "gs-dot" }, isDone ? ico("check", 12) : String(i + 1)), h("span", { class: "grow" }, s.title)]));
    })),
  ]);
}

function footer(state, step) {
  return h("div", { class: "guide-foot" }, [
    Button({ label: "Back", icon: "arrow-left", variant: "ghost", size: "sm", disabled: state.stepIndex === 0, onClick: () => guideEngine.back(), attrs: { "data-key": "back" } }),
    h("div", { class: "grow" }),
    !state.stepDone && Button({ label: "Skip step", variant: "ghost", size: "sm", onClick: () => guideEngine.skipStep(), attrs: { "data-key": "skip" } }),
    Button({ label: state.stepIndex === state.guide.steps.length - 1 ? "Finish" : "Next", iconRight: "arrow-right", variant: "primary", size: "sm", disabled: !state.stepDone, onClick: () => guideEngine.next(), attrs: { "data-key": "next", title: state.stepDone ? "" : "Complete the step in the app to continue" } }),
  ]);
}

function completion(guide, state) {
  const ctx = guideEngine.ctx();
  const mins = Math.max(1, Math.round((state.summary?.durationMs || 0) / 60000));
  return h("div", { class: "guide-body guide-complete" }, [
    h("div", { class: "complete-badge" }, ico("check", 34)),
    h("h2", { tabindex: "-1" }, "Guide complete!"),
    h("p", { class: "muted", style: "margin:6px 0 20px" }, guide.outcome),
    h("div", { class: "card card-pad-sm stack-sm", style: "text-align:left" }, [
      ...guide.steps.map((s) => h("div", { class: "row-sm small" }, [ico(guideEngine.completed.has(s.id) ? "check-circle" : "minus", 18), h("span", { style: guideEngine.completed.has(s.id) ? "" : "color:var(--c-muted)" }, s.title)])),
      h("div", { class: "xs muted", style: "margin-top:6px" }, `${state.summary?.done ?? 0} of ${guide.steps.length} steps · about ${mins} min`),
    ]),
    h("div", { class: "stack-sm", style: "margin-top:20px" }, [
      h("div", { class: "eyebrow" }, "What next?"),
      ...(guide.nextActions || []).map((a) => Button({ label: a.label, icon: a.icon, variant: "secondary", cls: "btn-block", onClick: () => { guideEngine.close(); navigate(a.href(ctx)); } })),
    ]),
    h("div", { class: "row", style: "margin-top:20px;justify-content:center" }, [
      Button({ label: "Restart", icon: "refresh", variant: "ghost", onClick: () => guideEngine.restart() }),
      Button({ label: "Close guide", variant: "primary", onClick: () => guideEngine.close(), attrs: { "data-autofocus": "" } }),
    ]),
  ]);
}
