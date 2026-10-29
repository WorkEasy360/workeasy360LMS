// Lightweight SVG charts — no dependencies. Every mark carries a <title> so values are inspectable and screen-reader friendly.
import { h } from "../lib/dom.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, kids = []) => {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  kids.forEach((k) => el.appendChild(k));
  return el;
};
const title = (t) => { const e = svg("title"); e.textContent = t; return e; };

// data: [{label, value}]
export function BarChart(data, { height = 160, color = "var(--c-primary)", format = (v) => v, ariaLabel = "Bar chart", showEvery = 5 } = {}) {
  const W = 600, pad = { t: 8, b: 22, l: 4, r: 4 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = (W - pad.l - pad.r) / data.length;
  const root = svg("svg", { viewBox: `0 0 ${W} ${height}`, width: "100%", role: "img", "aria-label": ariaLabel, style: "display:block;height:auto" });
  [0.5, 1].forEach((f) => root.appendChild(svg("line", { x1: 0, x2: W, y1: pad.t + (height - pad.t - pad.b) * (1 - f), y2: pad.t + (height - pad.t - pad.b) * (1 - f), stroke: "#E1E7EB", "stroke-dasharray": "3 4" })));
  data.forEach((d, i) => {
    const bh = ((height - pad.t - pad.b) * d.value) / max;
    root.appendChild(svg("rect", { x: pad.l + i * bw + bw * 0.18, y: height - pad.b - bh, width: bw * 0.64, height: Math.max(1, bh), rx: 3, fill: color, opacity: 0.9 }, [title(`${d.label}: ${format(d.value)}`)]));
    if (i % showEvery === 0) { const t = svg("text", { x: i === 0 ? pad.l : pad.l + i * bw + bw / 2, y: height - 6, "text-anchor": i === 0 ? "start" : "middle", "font-size": 11, fill: "#667581" }); t.textContent = d.label; root.appendChild(t); }
  });
  return h("div", { class: "chart" }, root);
}

export function Sparkline(values, { width = 120, height = 36, color = "var(--c-primary)" } = {}) {
  const max = Math.max(1, ...values), min = Math.min(...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * width, height - 3 - ((v - min) / Math.max(1, max - min)) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" }, [
    svg("path", { d: `${d} L${width},${height} L0,${height}Z`, fill: color, opacity: 0.12 }), svg("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }),
  ]);
}

// parts: [{label, value, color}] rendered as one stacked horizontal bar + legend
export function StackedBar(parts, { height = 12 } = {}) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return h("div", { class: "stack-sm" }, [
    h("div", { style: `display:flex;height:${height}px;border-radius:99px;overflow:hidden;background:#EEF3F2`, role: "img", "aria-label": parts.map((p) => `${p.label} ${p.value}`).join(", ") },
      parts.filter((p) => p.value).map((p) => h("span", { style: `width:${(p.value / total) * 100}%;background:${p.color};transition:width var(--t-moment) var(--ease-out)`, title: `${p.label}: ${p.value}` }))),
    h("div", { class: "row wrap xs" }, parts.map((p) => h("span", { class: "row-sm" }, [h("span", { class: "dot", style: `color:${p.color}` }), `${p.label} `, h("strong", {}, String(p.value))]))),
  ]);
}

// ---------- analytics additions: animation communicates change, never decoration; all honour reduced motion ----------
const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Animated number. Counts up on first paint; el.setValue(n) eases from the current value to the new one.
export function CountUp(value, { format = (v) => String(Math.round(v)), duration = 700 } = {}) {
  const el = h("span", { class: "count-up" }, format(reducedMotion() ? value : 0));
  let cur = 0, raf = 0;
  const go = (to) => {
    cancelAnimationFrame(raf);
    if (reducedMotion()) { cur = to; el.textContent = format(to); return; }
    const from = cur, start = performance.now();
    const step = (t) => { const k = Math.max(0, Math.min(1, (t - start) / duration)), e = 1 - Math.pow(1 - k, 3); /* rAF timestamps can precede start */ cur = from + (to - from) * e; el.textContent = format(cur); if (k < 1) raf = requestAnimationFrame(step); else { cur = to; el.textContent = format(to); } };
    raf = requestAnimationFrame(step);
  };
  requestAnimationFrame(() => go(value));
  el.setValue = go;
  return el;
}

// Multi-series line chart that draws in. data: [{date, label?, ...keys}], series: [{key, label, color}]
export function LineChart(data, series, { height = 180, ariaLabel = "Trend", showEvery = 5, format = (v) => v } = {}) {
  const W = 600, pad = { t: 10, b: 24, l: 6, r: 6 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] || 0)));
  const x = (i) => pad.l + (data.length < 2 ? (W - pad.l - pad.r) / 2 : (i / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / max);
  const totals = series.map((s) => s.label + " total " + data.reduce((n, d) => n + (d[s.key] || 0), 0)).join(", ");
  const root = svg("svg", { viewBox: "0 0 " + W + " " + height, width: "100%", role: "img", "aria-label": ariaLabel + ": " + totals, style: "display:block;height:auto" });
  [0.5, 1].forEach((f) => root.appendChild(svg("line", { x1: 0, x2: W, y1: y(max * f), y2: y(max * f), stroke: "#E1E7EB", "stroke-dasharray": "3 4" })));
  series.forEach((s) => {
    const d = data.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + "," + y(p[s.key] || 0).toFixed(1)).join(" ");
    root.appendChild(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round", class: "chart-line" }));
    data.forEach((p, i) => { if (p[s.key]) root.appendChild(svg("circle", { cx: x(i), cy: y(p[s.key]), r: 3.5, fill: s.color, class: "chart-dot" }, [title((p.label || p.date) + ": " + s.label + " " + format(p[s.key]))])); });
  });
  data.forEach((p, i) => { if (i % showEvery === 0 || i === data.length - 1) { const t = svg("text", { x: x(i), y: height - 6, "text-anchor": i === 0 ? "start" : i === data.length - 1 ? "end" : "middle", "font-size": 11, fill: "#667581" }); t.textContent = p.label || p.date; root.appendChild(t); } });
  const legend = h("div", { class: "row wrap xs", style: "gap:14px" }, series.map((s) => h("span", { class: "row-sm" }, [h("span", { class: "dot", style: "color:" + s.color }), s.label])));
  return h("div", { class: "chart chart-draw stack-sm" }, [data.length ? root : h("p", { class: "small muted" }, "No activity in this period."), legend]);
}

// Funnel: stages reveal one after another; width = share of the first stage. stages: [{stage, count, pct}]
export function Funnel(stages, { ariaLabel = "Funnel" } = {}) {
  const label = ariaLabel + ": " + stages.map((s) => s.stage + " " + s.count + " (" + s.pct + "%)").join(" → ");
  return h("div", { class: "funnel", role: "img", "aria-label": label },
    stages.map((s, i) => h("div", { class: "funnel-stage", style: "--i:" + i + ";--w:" + Math.max(10, s.pct) + "%", "data-funnel-stage": s.stage.toLowerCase(), "data-funnel-count": String(s.count) }, [
      h("div", { class: "funnel-bar" }, [h("span", { class: "funnel-label" }, s.stage), h("span", { class: "funnel-count" }, String(s.count))]),
      h("span", { class: "funnel-pct xs muted" }, s.pct + "%"),
    ])));
}

// Distribution of learners across progress buckets. buckets: [{label, count}]
export function Distribution(buckets, { color = "var(--c-primary)" } = {}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return h("div", { class: "dist stack-sm", role: "img", "aria-label": buckets.map((b) => b.label + ": " + b.count).join(", ") }, buckets.map((b, i) => h("div", { class: "dist-row" }, [
    h("span", { class: "xs muted truncate" }, b.label),
    h("span", { class: "dist-track" }, h("span", { class: "dist-fill", style: "--i:" + i + ";width:" + (b.count / max) * 100 + "%;background:" + color })),
    h("span", { class: "xs strong", style: "min-width:22px;text-align:right" }, String(b.count)),
  ])));
}
