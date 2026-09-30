import { h, uid } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";

// Field wraps a control with label + hint + error, wiring aria-describedby.
export function Field({ label, hint, error, control, cls = "" }) {
  const id = control.id || (control.id = uid("f"));
  const wrap = h("div", { class: ["field", cls] });
  if (label) wrap.appendChild(h("label", { class: "label", for: id }, label));
  wrap.appendChild(control);
  const notes = [];
  if (hint) notes.push(h("div", { class: "hint", id: id + "-hint" }, hint));
  if (error) { notes.push(h("div", { class: "hint", id: id + "-err", role: "alert", style: "color:var(--c-danger)" }, error)); control.setAttribute("aria-invalid", "true"); }
  if (notes.length) control.setAttribute("aria-describedby", notes.map((n) => n.id).join(" "));
  notes.forEach((n) => wrap.appendChild(n));
  return wrap;
}

export const Input = (attrs = {}) => h("input", { type: "text", ...attrs, class: ["input", attrs.large && "input-lg", attrs.class], large: undefined });
export const Textarea = (attrs = {}) => h("textarea", { rows: 4, ...attrs, class: ["textarea", attrs.class] }, attrs.value ?? "");

export function Select({ options, value, onChange, attrs = {} }) {
  const el = h("select", { class: "select", onchange: (e) => onChange?.(e.target.value), ...attrs },
    options.map((o) => { const opt = typeof o === "string" ? { value: o, label: o } : o; return h("option", { value: opt.value, selected: opt.value === value }, opt.label); }));
  return el;
}

export function SearchInput({ placeholder = "Search", value = "", onInput, attrs = {} }) {
  return h("div", { class: "input-wrap" }, [ico("search", 18), h("input", { class: "input", type: "search", placeholder, value, "aria-label": placeholder, oninput: (e) => onInput?.(e.target.value), ...attrs })]);
}

export function Switch({ checked, onChange, label }) {
  return h("label", { class: "switch", title: label }, [
    h("input", { type: "checkbox", role: "switch", checked, "aria-label": label, onchange: (e) => onChange?.(e.target.checked) }), h("span"),
  ]);
}

export function Checkbox({ label, checked, onChange }) {
  return h("label", { class: "check" }, [h("input", { type: "checkbox", checked, onchange: (e) => onChange?.(e.target.checked) }), h("span", {}, label)]);
}
