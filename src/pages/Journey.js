// Visual learning journey: interactive nodes, animated progress flow, detail panel.
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Tabs } from "../components/Tabs.js";
import { PageHeader, Card } from "../components/Card.js";
import { Badge, StatusBadge } from "../components/Badge.js";
import { Progress, ProgressRing } from "../components/Progress.js";
import { JourneyNode } from "../components/Domain.js";
import { EmptyState } from "../components/States.js";
import { journeysFor, nextLesson, getEnrollment } from "../services/learning.js";
import { courseTitle } from "../services/courses.js";

const NS = "http://www.w3.org/2000/svg";

export function JourneyPage(ctx) {
  const user = ctx.user;
  let journeys = journeysFor(user.id);
  if (!journeys.length) return { title: "Journeys", crumbs: [{ label: "Journeys" }], el: EmptyState({ icon: "route", title: "No journeys yet", description: "Journeys chain courses into a path toward a skill." }) };

  let jid = journeys[0].id;
  let selectedId = null;
  const stage = h("div");
  let ro = null;

  const focusNode = (j) => (j.nodes.find((n) => n.status === "in-progress") || j.nodes.find((n) => n.status === "available") || j.nodes[0]).id;

  function draw() {
    journeys = journeysFor(user.id);
    const j = journeys.find((x) => x.id === jid);
    selectedId ||= focusNode(j);
    const sel = j.nodes.find((n) => n.id === selectedId);
    const depth = Math.max(...j.nodes.map((n) => n.depth));
    const rows = Array.from({ length: depth + 1 }, (_, d) => j.nodes.filter((n) => n.depth === d));
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "journey-svg");
    svg.setAttribute("aria-hidden", "true");
    const rowsEl = h("div", { class: "journey-rows" }, rows.map((row, ri) => h("div", { class: "journey-row", role: "group", "aria-label": `Step ${ri + 1}` }, row.map((n) => JourneyNode({ node: n, selected: n.id === selectedId, onSelect: (node) => { selectedId = node.id; draw(); } })))));
    const canvas = h("div", { class: "journey card" }, [svg, rowsEl]);

    const edges = () => {
      svg.replaceChildren();
      const c = canvas.getBoundingClientRect();
      const pos = (id) => { const el = canvas.querySelector(`[data-node="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left - c.left + canvas.scrollLeft + r.width / 2, top: r.top - c.top, bottom: r.bottom - c.top }; };
      svg.setAttribute("width", canvas.scrollWidth);
      j.nodes.forEach((n) => n.requires.forEach((rid) => {
        const from = j.nodes.find((x) => x.id === rid), a = pos(rid), b = pos(n.id);
        if (!a || !b) return;
        const my = (a.bottom + b.top) / 2;
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", `M${a.x},${a.bottom} C${a.x},${my} ${b.x},${my} ${b.x},${b.top}`);
        const flowing = from.status === "completed" && (n.status === "in-progress" || n.status === "available");
        p.setAttribute("class", `jedge ${from.status === "completed" && n.status === "completed" ? "is-done" : flowing ? "is-flow" : ""}`);
        svg.appendChild(p);
      }));
    };
    ro?.disconnect();
    ro = new ResizeObserver(edges);
    ro.observe(canvas);

    stage.replaceChildren(h("div", { class: "journey-layout" }, [
      h("div", { class: "stack" }, [
        h("div", { class: "row-between wrap" }, [
          h("div", {}, [h("h2", {}, j.title), h("p", { class: "small muted" }, j.description)]),
          h("div", { class: "row" }, [h("div", { class: "small strong" }, `${j.pct}% complete`), h("div", { style: "width:140px" }, Progress(j.pct, { label: `${j.title} progress` }))]),
        ]),
        canvas,
        h("p", { class: "xs muted" }, "Select a step to see its status, prerequisites and what to do next. Animated lines show where your progress is flowing."),
      ]),
      detail(j, sel),
    ]));
  }

  function detail(j, n) {
    const prereqs = n.requires.map((r) => j.nodes.find((x) => x.id === r));
    const enrollment = n.course ? getEnrollment(user.id, n.course.id) : null;
    const next = n.course && enrollment ? nextLesson(n.course, enrollment) : null;
    let action;
    if (n.type === "milestone") action = n.status === "completed" ? h("div", { class: "callout tip" }, [ico("award", 18), "Milestone reached — nicely done!"]) : h("p", { class: "small muted" }, "Complete the prerequisites to unlock this milestone.");
    else if (n.status === "completed") action = Button({ label: "Review course", icon: "book", href: `/explore/${n.course.id}` });
    else if (n.status === "locked") { const blocker = prereqs.find((p) => p.status !== "completed"); action = Button({ label: `Start “${blocker?.title}” first`, icon: "arrow-right", variant: "secondary", href: blocker?.course ? `/explore/${blocker.course.id}` : "/explore" }); }
    else action = Button({ label: n.status === "in-progress" ? "Continue course" : "Start course", icon: "play", variant: "primary", href: `/learn/${n.course.id}${next ? "/" + next.id : ""}` });
    return h("aside", { class: "journey-detail card card-pad stack", "aria-live": "polite", key: n.id }, [
      h("div", { class: "row" }, [ProgressRing(n.pct, { size: 64, stroke: 7, color: n.status === "completed" ? "var(--c-success)" : "var(--c-primary)" }), h("div", { class: "grow" }, [h("div", { class: "eyebrow" }, n.type === "milestone" ? "Milestone" : "Course"), h("h3", {}, n.title), StatusBadge(n.status === "locked-progress" ? "in-progress" : n.status)])]),
      n.course && h("p", { class: "small muted" }, n.course.description),
      n.type === "milestone" && n.description && h("p", { class: "small muted" }, n.description),
      h("div", {}, [h("div", { class: "label", style: "margin-bottom:6px" }, "Prerequisites"), prereqs.length ? h("ul", { class: "stack-sm" }, prereqs.map((p) => h("li", { class: "row-sm small" }, [ico(p.status === "completed" ? "check-circle" : "clock", 18), p.title, p.status === "completed" ? Badge("Done", "success") : Badge(`${p.pct}%`)]))) : h("p", { class: "small muted" }, "None — you can start here.")]),
      h("div", {}, [h("div", { class: "label", style: "margin-bottom:6px" }, "Next action"), action]),
    ]);
  }

  const tabs = journeys.length > 1 ? Tabs({ tabs: journeys.map((j) => ({ id: j.id, label: j.title })), active: jid, onChange: (id) => { jid = id; selectedId = null; draw(); }, label: "Learning journeys" }) : null;
  const el = h("div", { class: "stack-lg" }, [PageHeader({ title: "Learning journeys", sub: "See how each course connects to the skill you're building." }), tabs, stage]);
  draw();
  return { title: "Journeys", crumbs: [{ label: "Journeys" }], el, destroy: () => ro?.disconnect() };
}
