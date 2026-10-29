import { h, clamp } from "../lib/dom.js";

// Animated bar: renders at 0 then grows to the value so progress changes are visible.
export function Progress(value, { size = "", tone = "", label } = {}) {
  const v = clamp(Math.round(value || 0));
  const fill = h("span", {});
  const bar = h("div", { class: ["progress", size && `progress-${size}`, tone && `progress-${tone}`], role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": v, "aria-label": label || "Progress" }, fill);
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = v + "%")));
  bar.setValue = (n) => { const c = clamp(Math.round(n)); fill.style.width = c + "%"; bar.setAttribute("aria-valuenow", c); };
  return bar;
}

export function ProgressRing(value, { size = 56, stroke = 6, color = "var(--c-primary)", label = true } = {}) {
  const v = clamp(Math.round(value || 0));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const wrap = h("div", { class: "ring", style: `width:${size}px;height:${size}px`, role: "img", "aria-label": `${v}% complete` });
  wrap.innerHTML = `<svg width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#EEF3F2" stroke-width="${stroke}"/><circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}"/></svg>`;
  if (label) wrap.appendChild(h("span", { class: "ring-label", style: `font-size:${Math.max(11, size / 4.2)}px` }, `${v}%`));
  const fg = wrap.querySelector(".ring-fg");
  const set = (n) => (fg.style.strokeDashoffset = c * (1 - clamp(n) / 100));
  requestAnimationFrame(() => requestAnimationFrame(() => set(v)));
  wrap.setValue = set;
  return wrap;
}

// Label + bar + value, e.g.  CRM ████████░░ 80%
export function MeterRow(label, value, { tone = "teal", target } = {}) {
  const row = h("div", { class: "meter-row" }, [
    h("span", { class: "truncate strong" }, label),
    h("div", { style: "position:relative" }, [
      Progress(value, { tone, label: `${label} ${value}%` }),
      target != null && h("span", { title: `Target ${target}%`, style: `position:absolute;top:-3px;bottom:-3px;left:${clamp(target)}%;width:2px;background:var(--c-text);opacity:.5;border-radius:2px` }),
    ]),
    h("span", { class: "val" }, `${Math.round(value)}%`),
  ]);
  return row;
}
