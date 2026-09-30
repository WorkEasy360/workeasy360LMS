// Learning Coach: a grounded conversation over the learner's own context, next to their deterministic
// recommendations and learning plans. The chat needs the AI provider; everything else works without it.
import { h, timeAgo } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card, SectionTitle } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { ProgressRing } from "../components/Progress.js";
import { EmptyState, LoadingState } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { toast } from "../components/Overlay.js";
import { NextStep, RecommendationList, PlanCard } from "../components/Recommendations.js";
import { loadCoachContext, sendCoachMessage, loadConversation, loadConversations, loadPlans, createPlan, SUGGESTED_PROMPTS, LESSON_PROMPTS } from "../services/coach.js";
import { navigate } from "../router.js";

export function CoachPage(ctx) {
  const user = ctx.user;
  const lessonId = ctx.query?.lessonId || ctx.params?.lessonId || new URLSearchParams((location.hash.split("?")[1] || "")).get("lessonId") || null;
  let context = null, conversationId = null, messages = [], plans = [], sending = false;
  const root = h("div", { class: "stack-lg coach", "data-coach-state": "loading" });
  const left = h("div", { class: "stack-lg" }), right = h("div", { class: "stack-lg" });
  const thread = h("div", { class: "coach-thread", role: "log", "aria-live": "polite", "aria-label": "Conversation with your learning coach" });
  const input = h("textarea", { class: "textarea coach-input", rows: 2, placeholder: lessonId ? "Ask about this lesson…" : "Ask your coach… e.g. What should I learn next?", "aria-label": "Message your learning coach", "data-guide-target": "coach.input", onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } });
  const sendBtn = Button({ label: "Send", icon: "send", variant: "primary", attrs: { "data-guide-target": "coach.send" }, onClick: () => send() });

  // ---------- snapshot + recommendations ----------
  function snapshot() {
    if (!context) return LoadingState("Loading your learning snapshot…");
    const inProgress = context.courses.filter((c) => c.status !== "completed" && c.done > 0).length, completed = context.courses.filter((c) => c.status === "completed").length;
    const recs = context.recommendationCards || [];
    const primary = recs[0];
    const avg = context.courses.length ? Math.round(context.courses.reduce((n, c) => n + c.pct, 0) / context.courses.length) : 0;
    return h("div", { class: "stack-lg" }, [
      h("div", { class: "card card-pad row wrap", style: "gap:18px;align-items:center", "data-guide-target": "coach.snapshot" }, [
        ProgressRing(avg, { size: 72, stroke: 8 }),
        h("div", { class: "grow" }, [h("div", { class: "eyebrow" }, `${greeting()}, ${user.name.split(" ")[0]}`), h("div", { class: "strong", style: "font-size:18px" }, context.courses.length ? `${completed} completed · ${inProgress} in progress · ${context.learner.streakDays}-day streak` : "You haven't enrolled in anything yet"), h("div", { class: "xs muted" }, context.skills.length ? `Skills: ${context.skills.slice(0, 3).map((s) => `${s.name} ${s.level}`).join(" · ")}` : "No skill data yet")]),
        context.currentLesson && Badge(`Learning: ${context.currentLesson.title}`, "primary", "book"),
      ]),
      primary ? h("div", { "data-guide-target": "coach.recommendation" }, NextStep(primary)) : Card(EmptyState({ icon: "compass", title: "No recommendation yet", description: "Enrol in a course and the coach will have a concrete next step for you.", action: Button({ label: "Explore courses", variant: "primary", href: "/explore" }) })),
      recs.length > 1 && h("section", { class: "stack" }, [SectionTitle("Also recommended", null, "Based on your progress, skills and journeys"), RecommendationList(recs.slice(1), { onChange: reload })]),
      plans.filter((p) => p.status === "DRAFT" || p.status === "ACTIVE").slice(0, 1).map((p) => PlanCard(p, { onChange: reload })),
    ]);
  }
  const greeting = () => { const hr = new Date().getHours(); return hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; };

  // ---------- conversation ----------
  function bubble(m) {
    const actions = (m.actions || []).map((a) => Button({ label: a.label, icon: a.type === "CONTINUE_LESSON" ? "play" : a.type === "START_PLAN" ? "clock" : "arrow-right", size: "sm", variant: a.type === "CONTINUE_LESSON" || a.type === "START_PLAN" ? "primary" : "secondary", attrs: { "data-coach-action": a.type }, onClick: () => a.type === "START_PLAN" ? startPlan(a.planId) : navigate(a.href) }));
    return h("div", { class: ["coach-msg", m.role === "USER" ? "is-user" : "is-coach"], "data-coach-msg": m.role }, [
      m.role === "COACH" && h("span", { class: "coach-avatar" }, ico("sparkles", 14)),
      h("div", { class: "coach-bubble" }, [h("div", { class: "coach-text" }, m.content.split("\n").map((line) => h("div", {}, line))), actions.length > 0 && h("div", { class: "row wrap", style: "margin-top:8px" }, actions), h("div", { class: "xs muted", style: "margin-top:4px" }, [m.role === "COACH" ? "Grounded in your learning record · " : "", timeAgo(new Date(m.at).getTime())])]),
    ]);
  }
  async function startPlan(planId) { try { const { planAction } = await import("../services/coach.js"); await planAction(planId, "start"); toast("Plan started — your first item is ready", { type: "success" }); await reload(); } catch (err) { toast(err.message, { type: "error" }); } }

  function drawThread() {
    thread.replaceChildren(...(messages.length ? messages.map(bubble) : [h("div", { class: "coach-empty stack-sm" }, [h("p", { class: "small muted" }, context?.aiAvailable === false ? "The coach's chat is unavailable right now (no AI provider configured). Your recommendations above still work." : "Ask me anything about your learning. I only use your own progress, skills, journeys and the courses available to you — nothing else."), h("div", { class: "row wrap" }, (lessonId ? LESSON_PROMPTS : SUGGESTED_PROMPTS).map((p) => h("button", { class: "chip", type: "button", "data-coach-prompt": "", onclick: () => { input.value = p; send(); } }, p)))])]));
    thread.scrollTop = thread.scrollHeight;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true; sendBtn.disabled = true; root.dataset.coachState = "sending";
    const pending = h("div", { class: "coach-msg is-coach is-pending", "aria-busy": "true" }, [h("span", { class: "coach-avatar" }, ico("sparkles", 14)), h("div", { class: "coach-bubble" }, h("span", { class: "coach-typing" }, [h("i"), h("i"), h("i")]))]);
    messages.push({ role: "USER", content: text, at: new Date().toISOString() }); drawThread(); thread.append(pending); thread.scrollTop = thread.scrollHeight; input.value = "";
    try {
      const r = await sendCoachMessage({ conversationId, text, lessonId });
      conversationId = r.conversationId;
      messages[messages.length - 1] = r.user; messages.push(r.coach);
      if (r.plan) { plans = [r.plan, ...plans]; }
      bus.emit("coach.replied", { conversationId, hasActions: (r.coach.actions || []).length > 0 });
      root.dataset.coachState = "ready"; drawThread();
      if (r.plan) left.replaceChildren(snapshot());
    } catch (err) {
      pending.remove(); root.dataset.coachState = "error";
      thread.append(h("div", { class: "coach-msg is-coach is-error", role: "alert", "data-coach-error": "" }, [h("span", { class: "coach-avatar" }, ico("alert", 14)), h("div", { class: "coach-bubble" }, [h("div", { class: "coach-text" }, err.status === 503 ? "The coach isn't available right now — the AI provider isn't configured. Your recommendations and courses still work." : err.message || "Something went wrong."), h("div", { class: "row wrap", style: "margin-top:8px" }, Button({ label: "Try again", size: "sm", variant: "secondary", onClick: () => { input.value = text; send(); } }))])]));
      thread.scrollTop = thread.scrollHeight;
    } finally { sending = false; sendBtn.disabled = false; input.focus(); }
  }

  async function reload() {
    try {
      const [c, ps] = await Promise.all([loadCoachContext(lessonId), loadPlans().catch(() => [])]);
      context = c; plans = ps;
      if (root.dataset.coachState !== "loading") root.dataset.coachState = "ready";
      left.replaceChildren(snapshot());
      drawThread();
    } catch (err) { root.dataset.coachState = "error"; left.replaceChildren(Card(EmptyState({ icon: "alert", title: "Couldn't load your learning snapshot", description: err.message, action: Button({ label: "Try again", onClick: reload }) }))); }
  }
  async function openLatest() {
    try { const list = await loadConversations(); const latest = list.find((c) => (c.lessonId || null) === lessonId); if (latest) { const full = await loadConversation(latest.id); conversationId = full.id; messages = full.messages; drawThread(); } } catch {}
  }

  right.append(
    h("div", { class: "card coach-chat", "data-guide-target": "coach.chat" }, [
      h("div", { class: "coach-chat-head" }, [h("span", { class: "coach-avatar" }, ico("sparkles", 16)), h("div", {}, [h("div", { class: "strong small" }, "Learning Coach"), h("div", { class: "xs muted" }, lessonId ? "Talking about your current lesson" : "Uses only your own learning record")]), h("span", { class: "grow" }), Button({ label: "New chat", size: "sm", variant: "ghost", onClick: () => { conversationId = null; messages = []; drawThread(); input.focus(); } })]),
      thread,
      h("div", { class: "coach-compose" }, [input, sendBtn]),
    ]),
  );
  const offs = ["data:enrollments", "plan.changed"].map((ev) => bus.on(ev, () => root.isConnected && reload()));
  root.append(
    PageHeader({ title: "Learning Coach", sub: "What should you learn or do next — and why. Grounded in your own progress, skills and journeys.", actions: [GuideButton("meet-coach"), Button({ label: "Home", icon: "home", href: "/" })] }),
    h("div", { class: "coach-layout" }, [left, right]),
  );
  left.replaceChildren(LoadingState("Loading your learning snapshot…"));
  drawThread();
  root.dataset.coachState = "loading";
  // "ready" only once the snapshot AND any previous conversation are in place, so nothing re-renders under the learner.
  reload().then(openLatest).finally(() => { if (root.dataset.coachState === "loading") root.dataset.coachState = "ready"; });
  return { title: "Learning Coach", crumbs: [{ label: "Coach" }], el: root, destroy: () => offs.forEach((off) => off()) };
}
