import { h, uid } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "./Button.js";

// Dropdown: items = [{label, icon, onClick, href, desc, disabled}, "sep", {group:"Label"}]
export function Dropdown({ label, icon, iconRight = label ? "chevron-down" : null, variant = "secondary", size, items, align = "left", title, attrs = {}, renderTrigger }) {
  const wrap = h("div", { class: "menu-wrap" });
  let menu = null;
  const menuId = uid("menu");
  const trigger = renderTrigger
    ? renderTrigger({ onClick: toggle })
    : Button({ label, icon, iconRight, variant, size, title, onClick: toggle, attrs: { "aria-haspopup": "menu", "aria-expanded": "false", ...attrs } });
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  wrap.appendChild(trigger);

  function close(refocus = true) {
    if (!menu) return;
    menu.remove(); menu = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", onKey, true);
    if (refocus) trigger.focus();
  }
  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  const onKey = (e) => {
    if (!menu) return;
    const btns = [...menu.querySelectorAll(".menu-item:not([disabled])")];
    const i = btns.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (e.key === "Tab") close(false);
  };
  function toggle() {
    if (menu) return close();
    const list = typeof items === "function" ? items() : items;
    menu = h("div", { class: ["menu", `align-${align}`], role: "menu", id: menuId },
      list.map((it) => {
        if (it === "sep") return h("div", { class: "menu-sep", role: "separator" });
        if (it.group) return h("div", { class: "menu-label" }, it.group);
        const inner = [it.icon && ico(it.icon, 18), h("span", { class: "grow" }, [it.label, it.desc && h("span", { class: "menu-desc" }, it.desc)]), it.badge];
        const common = { class: "menu-item", role: "menuitem", tabindex: "-1", ...(it.attrs || {}) };
        if (it.href) return h("a", { ...common, href: "#" + it.href, onclick: () => close(false) }, inner);
        return h("button", { ...common, type: "button", disabled: it.disabled, onclick: () => { close(false); it.onClick?.(); } }, inner);
      }));
    wrap.appendChild(menu);
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", onKey, true);
    menu.querySelector(".menu-item:not([disabled])")?.focus();
  }
  wrap.close = close;
  return wrap;
}

// Tooltip: hover + keyboard focus, described-by for screen readers.
let tipEl;
export function tooltip(el, text) {
  const id = uid("tip");
  const show = () => {
    hide();
    tipEl = h("div", { class: "tooltip-pop", role: "tooltip", id }, text);
    document.body.appendChild(tipEl);
    const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
    tipEl.style.left = Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2)) + "px";
    tipEl.style.top = (r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8) + "px";
    el.setAttribute("aria-describedby", id);
  };
  const hide = () => { tipEl?.remove(); tipEl = null; el.removeAttribute("aria-describedby"); };
  el.addEventListener("mouseenter", show); el.addEventListener("focus", show);
  el.addEventListener("mouseleave", hide); el.addEventListener("blur", hide);
  el.addEventListener("keydown", (e) => e.key === "Escape" && hide());
  return el;
}
