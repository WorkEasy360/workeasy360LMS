// A task the Work Easy AI Agent proposed, shown inside its reply. Nothing happens until the person confirms; the
// backend then runs it with their own permissions and the card shows the result. A one-time secret (temporary
// password, reset link) is shown here once and never stored, so reopening the conversation shows only the outcome.
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { api } from "../services/api.js";
import { navigate } from "../router.js";
import { toast } from "./Overlay.js";

export const isOperation = (a) => a && a.type === "OPERATION";

export function OperationCard(message, index, { onNavigate } = {}) {
  const a = message.actions[index];
  const el = h("div", { class: "agent-op", "data-agent-op": a.op });
  const st = { phase: a.status === "DONE" ? "done" : a.status === "FAILED" ? "failed" : "proposed", result: a.result || "", href: a.href || null, secret: null, secretLabel: null };

  const go = (href) => { onNavigate?.(); navigate(href); };
  const chip = (label, onClick, attrs = {}, primary = false) => h("button", { class: ["agent-chip", primary && "is-primary"], type: "button", onclick: onClick, ...attrs }, label);

  function secretBox() {
    const value = st.secret.startsWith("#/") ? location.href.split("#")[0] + st.secret : st.secret;
    return h("div", { class: "agent-op-secret", "data-agent-op-secret": "" }, [
      h("div", { class: "agent-op-secret-label" }, st.secretLabel),
      h("code", {}, value),
      chip("Copy", async (e) => { try { await navigator.clipboard.writeText(value); e.target.textContent = "Copied"; } catch { e.target.textContent = "Select and copy"; } }),
    ]);
  }

  function paint() {
    el.dataset.agentOpStatus = st.phase;
    const body = [];
    if (st.phase === "proposed") {
      body.push(h("div", { class: "agent-op-text" }, a.confirm));
      body.push(h("div", { class: "agent-actions" }, [
        chip(a.label, run, { "data-agent-op-confirm": "" }, true),
        chip("Not now", () => { st.phase = "dismissed"; paint(); }, { "data-agent-op-cancel": "" }),
      ]));
    } else if (st.phase === "running") {
      body.push(h("div", { class: "agent-op-text" }, "Working on it…"));
    } else if (st.phase === "dismissed") {
      body.push(h("div", { class: "agent-op-text is-muted" }, "Okay, I won't do that."));
    } else {
      body.push(h("div", { class: "agent-op-text" }, [ico(st.phase === "done" ? "check" : "alert", 14), " ", st.result]));
      if (st.secret) body.push(secretBox());
      const buttons = [];
      if (st.href) buttons.push(chip("Open", () => go(st.href), { "data-agent-op-open": "" }, st.phase === "done"));
      if (st.phase === "failed") buttons.push(chip("Try again", run, { "data-agent-op-retry": "" }));
      if (buttons.length) body.push(h("div", { class: "agent-actions" }, buttons));
    }
    el.replaceChildren(...body);
  }

  async function run() {
    st.phase = "running"; paint();
    try {
      const r = await api.coachOperation(message.id, index);
      st.phase = r.ok ? "done" : "failed"; st.result = r.message; st.href = r.href || null; st.secret = r.secret || null; st.secretLabel = r.secretLabel || null;
      if (r.updated?.actions) message.actions = r.updated.actions;
      if (r.ok) toast(r.message, { type: "success" });
    } catch (err) {
      st.phase = err.status === 409 ? "done" : "failed";
      st.result = err.message || "That didn't work.";
    }
    paint();
  }

  paint();
  return el;
}
