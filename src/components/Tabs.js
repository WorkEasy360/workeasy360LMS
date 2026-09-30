import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";

// Tabs({ tabs:[{id,label,icon,count}], active, onChange }) — WAI-ARIA tabs pattern with arrow-key navigation.
export function Tabs({ tabs, active, onChange, label = "Sections" }) {
  const list = h("div", { class: "tabs", role: "tablist", "aria-label": label });
  const render = (current) => {
    list.replaceChildren(...tabs.map((t) =>
      h("button", {
        class: "tab", role: "tab", type: "button", id: `tab-${t.id}`, "aria-selected": String(t.id === current), tabindex: t.id === current ? "0" : "-1",
        onclick: () => { render(t.id); onChange?.(t.id); },
        onkeydown: (e) => {
          const i = tabs.findIndex((x) => x.id === current);
          const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
          if (n == null) return;
          e.preventDefault();
          const next = tabs[(n + tabs.length) % tabs.length];
          render(next.id); onChange?.(next.id);
          list.querySelector(`#tab-${next.id}`).focus();
        },
      }, [t.icon && ico(t.icon, 16), t.label, t.count != null && h("span", { class: "badge", style: "height:18px;padding:0 7px" }, String(t.count))])));
  };
  render(active ?? tabs[0].id);
  return list;
}

export function Chips({ options, value, onChange, label = "Filter" }) {
  const wrap = h("div", { class: "chips", role: "group", "aria-label": label });
  const render = (v) => wrap.replaceChildren(...options.map((o) => {
    const opt = typeof o === "string" ? { value: o, label: o } : o;
    return h("button", { class: "chip", type: "button", "aria-pressed": String(opt.value === v), onclick: () => { render(opt.value); onChange?.(opt.value); } }, opt.label);
  }));
  render(value);
  return wrap;
}

export function Breadcrumb(items) {
  return h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, items.flatMap((it, i) => {
    const last = i === items.length - 1;
    const node = last || !it.href ? h("span", last ? { "aria-current": "page" } : {}, it.label) : h("a", { href: "#" + it.href }, it.label);
    return last ? [node] : [node, ico("chevron-right", 14)];
  }));
}
