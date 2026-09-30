// Modal / Drawer / Toast. All mount inside #overlay-root (inside the app column) so the guide panel stays visible and usable.
import { h, trapFocus, announce } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "./Button.js";

const root = () => document.getElementById("overlay-root");
let toastHost;

function open({ title, content, footer, size = "", side = false, onClose, dismissible = true, labelledBy = "Dialog" }) {
  const previous = document.activeElement;
  const titleId = "dlg-" + Math.random().toString(36).slice(2, 7);
  const panel = h("div", { class: [side ? "drawer" : "modal", size && `modal-${size}`], role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" });
  const scrim = h("div", { class: ["scrim", side && "side"] }, panel);
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    release();
    scrim.remove();
    previous?.isConnected && previous.focus?.();
    onClose?.(result);
  };
  const closeBtn = dismissible ? Button({ icon: "x", variant: "ghost", size: "sm", title: "Close", onClick: () => close() }) : null;
  const body = h("div", { class: side ? "drawer-body" : "modal-body" }, typeof content === "function" ? content(close) : content);
  panel.append(
    h("div", { class: side ? "drawer-head" : "modal-head" }, [h("h2", { id: titleId, class: "grow" }, title || labelledBy), closeBtn]),
    body,
    ...(footer ? [h("div", { class: "modal-foot" }, typeof footer === "function" ? footer(close) : footer)] : [])
  );
  scrim.addEventListener("mousedown", (e) => { if (dismissible && e.target === scrim) close(); });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape" && dismissible) { e.stopPropagation(); close(); } });
  root().appendChild(scrim);
  const release = trapFocus(panel);
  const firstField = panel.querySelector("[data-autofocus], input:not([type=hidden]), textarea, select");
  (firstField || panel.querySelector(".btn-primary") || closeBtn || panel).focus();
  return { close, el: panel, body };
}

export const openModal = (opts) => open(opts);
export const openDrawer = (opts) => open({ ...opts, side: true });

export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const finish = (v, close) => { decided = true; resolve(v); close(); };
    openModal({
      title, size: "sm", onClose: () => !decided && resolve(false),
      content: h("p", { class: "muted" }, message),
      footer: (close) => [Button({ label: cancelLabel, variant: "secondary", onClick: () => finish(false, close) }), Button({ label: confirmLabel, variant: danger ? "danger" : "primary", onClick: () => finish(true, close), attrs: { "data-autofocus": "" } })],
    });
  });
}

export function toast(message, { type = "success", duration = 3800, action } = {}) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h("div", { class: "toasts", "aria-live": "polite", role: "status" });
    root()?.parentElement.appendChild(toastHost);
  }
  const iconName = { success: "check-circle", error: "alert", info: "info" }[type];
  const el = h("div", { class: ["toast", type] }, [ico(iconName, 18), h("div", { class: "grow" }, message), action && Button({ label: action.label, variant: "ghost", size: "sm", cls: "toast-action", onClick: () => { action.onClick(); dismiss(); } })]);
  el.querySelector(".toast-action")?.setAttribute("style", "color:#fff;text-decoration:underline");
  const dismiss = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 200); };
  toastHost.appendChild(el);
  announce(message);
  if (duration) setTimeout(dismiss, duration);
  return dismiss;
}
