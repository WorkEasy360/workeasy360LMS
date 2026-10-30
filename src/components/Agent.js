// Work Easy AI Agent: the floating AI agent on every signed-in page (launcher bottom-right, panel on the right).
// It talks to the Learning Coach backend, so every answer is grounded in the signed-in user's own learning record; on a
// lesson page it also sends the lesson. Guided tours for the user's role are one click away. Hidden on /coach, which
// is the full-page version of the same conversation.
import { h, timeAgo } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { getUser } from "../lib/store.js";
import { navigate } from "../router.js";
import { sendCoachMessage, loadConversations, loadConversation, planAction, SUGGESTED_PROMPTS, LESSON_PROMPTS } from "../services/coach.js";
import { guidesForRole, contextGuide } from "../guide/guides.js";
import { guideEngine } from "../guide/GuideEngine.js";
import { AgentAvatar } from "./Brand.js";
import { toast } from "./Overlay.js";

const NAME = "Work Easy AI Agent";
const lessonFromPath = (path) => (path.match(/^\/learn\/[^/?]+\/([^/?]+)/) || [])[1] || null;
const narrow = () => window.matchMedia("(max-width: 640px)").matches;

let launcher, panel, head, body, input, sendBtn;
let st = fresh(null);
function fresh(userId) { return { userId, open: false, view: "chat", conversationId: null, messages: [], sending: false, path: "/", lessonId: null }; }

export function initAgent(host) {
  launcher = h("button", { class: "agent-launcher", type: "button", id: "agent-launcher", "aria-label": `Open ${NAME}`, "aria-expanded": "false", "aria-controls": "agent-panel", "data-agent-launcher": "", hidden: true, onclick: () => setOpen(true) }, [
    AgentAvatar(56, "agent-launcher-img"), h("span", { class: "agent-busy", "aria-hidden": "true", hidden: true }),
  ]);
  input = h("textarea", { class: "agent-input", rows: 1, placeholder: "Ask me anything…  (Enter to send)", "aria-label": `Message ${NAME}`, "data-agent-input": "",
    oninput: () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; paintSend(); },
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } });
  sendBtn = h("button", { class: "agent-send", type: "button", "aria-label": "Send message", "data-agent-send": "", disabled: true, onclick: () => send() }, ico("send", 15));
  head = h("div", { class: "agent-head" });
  body = h("div", { class: "agent-body" });
  panel = h("aside", { class: "agent-panel", id: "agent-panel", role: "complementary", "aria-label": NAME, "data-agent-panel": "", "data-agent-state": "ready", hidden: true,
    onkeydown: (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } } }, [
    head, body,
    h("div", { class: "agent-compose" }, [
      h("div", { class: "agent-field" }, [input, sendBtn]),
      h("p", { class: "agent-note" }, "Answers use only your own learning record and the courses available to you."),
    ]),
  ]);
  host.append(launcher, panel);
}

/** Called on every navigation: follows the signed-in user and the current page. */
export function updateAgent(path) {
  if (!launcher) return;
  const user = getUser();
  if (!user) { document.body.classList.remove("has-agent"); launcher.hidden = true; panel.hidden = true; st = fresh(null); return; }
  if (user.id !== st.userId) st = fresh(user.id);
  st.path = path;
  st.lessonId = lessonFromPath(path);
  const onCoach = /^\/coach(\/|\?|$)/.test(path);
  if (onCoach) st.open = false;
  document.body.classList.toggle("has-agent", !onCoach);
  render();
}

function setOpen(open) {
  st.open = open;
  render();
  if (open) setTimeout(() => (st.view === "chat" ? input : panel.querySelector("button"))?.focus(), 30);
  else launcher.focus();
}

function render() {
  const onCoach = !document.body.classList.contains("has-agent");
  launcher.hidden = onCoach || st.open;
  launcher.setAttribute("aria-expanded", String(st.open));
  launcher.querySelector(".agent-busy").hidden = !st.sending;
  panel.hidden = onCoach || !st.open;
  panel.dataset.agentState = st.sending ? "sending" : panel.dataset.agentState === "error" ? "error" : "ready";
  if (!st.open) return;
  drawHead();
  st.view === "history" ? drawHistory() : drawChat();
  panel.querySelector(".agent-compose").hidden = st.view !== "chat";
  input.disabled = st.sending;
  input.placeholder = st.sending ? "The assistant is replying…" : st.lessonId ? "Ask about this lesson…  (Enter to send)" : "Ask me anything…  (Enter to send)";
  paintSend();
}

const iconBtn = (iconName, label, onClick, attrs = {}) => h("button", { class: "agent-icon-btn", type: "button", "aria-label": label, title: label, onclick: onClick, ...attrs }, ico(iconName, 16));

function drawHead() {
  const history = st.view === "history";
  head.replaceChildren(
    history ? iconBtn("chevron-left", "Back to chat", () => { st.view = "chat"; render(); input.focus(); }) : AgentAvatar(28, "agent-head-avatar"),
    h("div", { class: "grow" }, history
      ? h("div", { class: "agent-title" }, "Conversation history")
      : [h("div", { class: "agent-title" }, NAME), h("div", { class: "agent-sub" }, st.lessonId ? "Knows the lesson you're on" : ROLE_SUB[getUser()?.role] || ROLE_SUB.learner)]),
    !history && iconBtn("message", "View conversation history", () => { st.view = "history"; render(); }, { "data-agent-history": "" }),
    !history && iconBtn("plus", "New conversation", () => newChat(), { "data-agent-new": "" }),
    iconBtn("expand", "Open the full Learning Coach", () => { setOpen(false); navigate(st.lessonId ? `/coach?lessonId=${encodeURIComponent(st.lessonId)}` : "/coach"); }),
    iconBtn("x", `Close ${NAME}`, () => setOpen(false), { "data-agent-close": "" }),
  );
}

function newChat() { st.conversationId = null; st.messages = []; st.view = "chat"; panel.dataset.agentState = "ready"; render(); input.focus(); }

// ---------- chat ----------
function drawChat() {
  const log = h("div", { class: "agent-log", role: "log", "aria-live": "polite", "aria-label": "Conversation with the assistant" }, st.messages.length ? st.messages.map(bubble) : emptyState());
  if (st.sending) log.append(h("div", { class: "agent-msg is-coach", "aria-busy": "true", "data-agent-pending": "" }, [AgentAvatar(28, "agent-msg-avatar"), h("div", { class: "agent-bubble" }, h("span", { class: "coach-typing" }, [h("i"), h("i"), h("i")]))]));
  if (st.error) log.append(h("div", { class: "agent-msg is-coach is-error", role: "alert", "data-agent-error": "" }, [AgentAvatar(28, "agent-msg-avatar"), h("div", { class: "agent-bubble" }, [h("div", {}, st.error.text), h("button", { class: "agent-chip", type: "button", style: "margin-top:8px", onclick: () => { const t = st.error.retry; st.error = null; input.value = t; send(); } }, "Try again")])]));
  body.replaceChildren(log);
  log.scrollTop = log.scrollHeight;
}

// The agent serves each panel in its own terms: learning for learners, teaching for instructors, operations for admins.
const ROLE_SUB = { learner: "Your learning coach", instructor: "Your teaching assistant", admin: "Your LMS operations assistant" };
const ROLE_EMPTY_SUB = {
  learner: "Ask about your courses, progress and skills, or take a guided tour.",
  instructor: "Ask about your courses, reviews and learners, or take a guided tour.",
  admin: "Ask how to run your organisation's learning — people, courses, analytics, settings.",
};
const ROLE_PROMPTS = {
  instructor: ["What needs my review?", "How are my learners doing?", "How do I build and publish a course?", "How do skills and certificates work for my courses?"],
  admin: ["How is learning across the organisation?", "How do I add instructors and learners?", "How do certificates and the organisation logo work?", "What do the automation rules control?"],
};

function emptyState() {
  const user = getUser();
  const prompts = (st.lessonId ? LESSON_PROMPTS : ROLE_PROMPTS[user.role] || SUGGESTED_PROMPTS).slice(0, 4);
  const suggested = contextGuide(st.path, user.role);
  const tours = [suggested, ...guidesForRole(user.role).filter((g) => g.id !== suggested?.id)].filter(Boolean).slice(0, 3);
  return h("div", { class: "agent-empty", "data-agent-empty": "" }, [
    AgentAvatar(72, "agent-empty-avatar"),
    h("p", { class: "agent-empty-title" }, "What can I help with?"),
    h("p", { class: "agent-empty-sub" }, st.lessonId ? "Ask about the lesson you're on, or about your progress and skills." : ROLE_EMPTY_SUB[user.role] || ROLE_EMPTY_SUB.learner),
    h("div", { class: "agent-suggestions" }, prompts.map((p) => h("button", { class: "agent-suggestion", type: "button", "data-agent-prompt": "", onclick: () => { input.value = p; send(); } }, p))),
    tours.length > 0 && h("div", { class: "agent-tours" }, [
      h("div", { class: "agent-tours-label" }, "Guided tours"),
      ...tours.map((g) => h("button", { class: "agent-tour", type: "button", "data-agent-tour": g.id, onclick: () => { setOpen(false); guideEngine.open(g.id, { source: "agent" }); } }, [ico("help", 16), h("span", { class: "grow" }, g.title), h("span", { class: "agent-tour-meta" }, `${g.steps.length} steps`)])),
    ]),
  ]);
}

function bubble(m) {
  const user = m.role === "USER";
  const actions = (m.actions || []).map((a) => h("button", { class: ["agent-chip", (a.type === "CONTINUE_LESSON" || a.type === "START_PLAN") && "is-primary"], type: "button", "data-agent-action": a.type, onclick: () => act(a) }, a.label));
  return h("div", { class: ["agent-msg", user ? "is-user" : "is-coach"], "data-agent-msg": m.role }, [
    !user && AgentAvatar(28, "agent-msg-avatar"),
    h("div", { class: "agent-bubble-wrap" }, [
      h("div", { class: "agent-bubble" }, String(m.content || "").split("\n").map((line) => h("div", {}, line))),
      actions.length > 0 && h("div", { class: "agent-actions" }, actions),
      h("div", { class: "agent-time" }, timeAgo(new Date(m.at).getTime())),
    ]),
  ]);
}

async function act(a) {
  if (a.type === "START_PLAN") {
    try { await planAction(a.planId, "start"); toast("Plan started — your first item is ready", { type: "success" }); } catch (err) { toast(err.message, { type: "error" }); }
    return;
  }
  if (narrow()) setOpen(false);
  navigate(a.href);
}

async function send() {
  const text = input.value.trim();
  if (!text || st.sending) return;
  const userId = st.userId;
  st.error = null; st.sending = true; st.view = "chat";
  st.messages.push({ role: "USER", content: text, at: new Date().toISOString() });
  input.value = ""; input.style.height = "auto";
  render();
  try {
    let r;
    try { r = await sendCoachMessage({ conversationId: st.conversationId, text, lessonId: st.lessonId }); }
    catch (err) {
      // A lesson only in the offline demo, or one the user isn't enrolled in: answer without the lesson.
      if (err.status !== 403 || !st.lessonId) throw err;
      r = await sendCoachMessage({ conversationId: st.conversationId, text, lessonId: null });
    }
    if (st.userId !== userId) return;
    st.conversationId = r.conversationId;
    st.messages[st.messages.length - 1] = r.user; st.messages.push(r.coach);
    panel.dataset.agentState = "ready";
  } catch (err) {
    if (st.userId !== userId) return;
    st.error = { text: err.status === 503 ? "The assistant isn't available right now: no AI provider is configured. Your courses and recommendations still work." : err.message || "Something went wrong.", retry: text };
    panel.dataset.agentState = "error";
  } finally {
    if (st.userId === userId) { st.sending = false; render(); if (st.open) input.focus(); }
  }
}

function paintSend() { sendBtn.disabled = st.sending || !input.value.trim(); sendBtn.classList.toggle("is-ready", !sendBtn.disabled); }

// ---------- history ----------
async function drawHistory() {
  const list = h("div", { class: "agent-history", "data-agent-history-list": "" }, [
    h("button", { class: "agent-new", type: "button", onclick: () => newChat() }, [ico("plus", 16), "New conversation"]),
    h("p", { class: "agent-history-note" }, "Loading…"),
  ]);
  body.replaceChildren(list);
  let rows;
  try { rows = await loadConversations(); } catch (err) { list.lastChild.textContent = err.message || "Couldn't load your conversations."; return; }
  if (st.view !== "history" || !list.isConnected) return;
  list.lastChild.remove();
  if (!rows.length) { list.append(h("p", { class: "agent-history-note" }, "No conversations yet")); return; }
  list.append(...rows.map((c) => h("button", { class: ["agent-conv", c.id === st.conversationId && "is-active"], type: "button", "data-agent-conv": c.id, onclick: () => openConversation(c.id) }, [
    ico("message", 14), h("span", { class: "grow truncate" }, c.title || "Conversation"), h("span", { class: "agent-conv-time" }, timeAgo(new Date(c.updatedAt || c.createdAt).getTime())),
  ])));
}

async function openConversation(id) {
  try {
    const full = await loadConversation(id);
    st.conversationId = full.id; st.messages = full.messages || []; st.error = null; st.view = "chat";
    render(); input.focus();
  } catch (err) { toast(err.message || "Couldn't open that conversation.", { type: "error" }); }
}
