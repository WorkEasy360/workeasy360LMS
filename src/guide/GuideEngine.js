// Guide engine: state machine + action validation + persistence (GuideProgress) + analytics (GuideAnalytics).
// The panel and spotlight are pure views over `engine.state`.
import { bus } from "../lib/events.js";
import { load, save, getUser, isBackendOnline } from "../lib/store.js";
import { currentRoute, navigate } from "../router.js";
import { getCourse } from "../services/courses.js";
import { guides } from "./guides.js";
import { api } from "../services/api.js";

const bg = (label, promise) => { if (isBackendOnline()) promise?.catch((err) => console.warn(`[guide] ${label} sync failed:`, err.message)); };

const ADVANCE_STATE_MS = 650;
const ADVANCE_EVENT_MS = 1100;

class GuideEngine {
  constructor() {
    this.state = { open: false, guide: null, stepIndex: 0, stepDone: false, finished: false, misroute: false, summary: null };
    this.listeners = new Set();
    this.timer = null;
    this.suppressAuto = false;
    this.completed = new Set();
    this.started = false;
    this.recent = new Map(); // recent domain events, so an action taken just before a step becomes active still counts
  }

  // ---------- lifecycle ----------
  init() {
    if (this.started) return;
    this.started = true;
    bus.onAny((payload, event) => { if (!this.state.open) return; if (!event.startsWith("data")) this.recent.set(event, { ts: Date.now(), payload }); this._evaluate(event, payload); });
    bus.on("route", () => this.state.open && this._evaluate("route"));
    bus.on("session", () => { this._teardown(); this._restore(); });
    setInterval(() => this.state.open && !this.state.finished && this._evaluate("tick"), 700);
    this._restore();
  }

  _restore() {
    const user = getUser();
    const active = user && this._prog(user.id).active;
    if (active && guides[active]) this.open(active, { resume: true, silent: true });
  }

  ctx() {
    const route = currentRoute();
    const m = route.path.match(/^\/builder\/([^/]+)/);
    return { user: getUser(), route, course: m ? getCourse(m[1]) : null };
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this.state)); }

  get step() { return this.state.guide?.steps[this.state.stepIndex] || null; }
  isOpen() { return this.state.open; }

  // ---------- persistence ----------
  _prog(userId) {
    const all = load("guideProgress");
    return (all[userId] ||= { active: null, guides: {} });
  }
  _persist(patch) {
    const user = getUser();
    if (!user || !this.state.guide) return;
    const p = this._prog(user.id);
    Object.assign((p.guides[this.state.guide.id] ||= {}), {
      stepIndex: this.state.stepIndex, completedSteps: [...this.completed], updatedAt: Date.now(), ...patch,
    });
    save("guideProgress");
    bg("progress", api.updateGuideProgress(this.state.guide.id, { status: patch.status === "completed" ? "COMPLETED" : "IN_PROGRESS", stepIndex: this.state.stepIndex, completedSteps: [...this.completed] }));
  }
  _log(event, extra = {}) {
    const user = getUser();
    if (!user) return;
    const log = load("guideAnalytics");
    log.push({ guideId: this.state.guide?.id, event, userId: user.id, at: Date.now(), ...extra });
    if (log.length > 2000) log.splice(0, log.length - 2000);
    save("guideAnalytics");
    if (this.state.guide) bg("analytics", api.logGuideEvent(this.state.guide.id, { event, step: extra.step ?? null, durationMs: extra.durationMs ?? null }));
  }
  progressFor(guideId) {
    const user = getUser();
    return user ? this._prog(user.id).guides[guideId] || null : null;
  }

  // ---------- public actions ----------
  open(guideId, { source = "manual", restart = false, resume = false, silent = false } = {}) {
    const guide = guides[guideId];
    const user = getUser();
    if (!guide || !user) return;
    if (this.state.open && this.state.guide.id !== guideId) this._teardown(true);
    const p = this._prog(user.id);
    const prev = p.guides[guideId];
    const canResume = !restart && prev?.status === "in_progress";
    this.state = { open: true, guide, stepIndex: canResume ? Math.min(prev.stepIndex || 0, guide.steps.length - 1) : 0, stepDone: false, finished: false, misroute: false, summary: null };
    this.completed = new Set(canResume ? prev.completedSteps || [] : []);
    this.suppressAuto = false;
    document.body.classList.add("guide-open");
    this.recent.clear();
    p.active = guideId;
    if (!canResume) {
      p.guides[guideId] = { status: "in_progress", stepIndex: 0, completedSteps: [], startedAt: Date.now(), runStartedAt: Date.now() };
      this._log("guide.started", { source });
    }
    if (!silent) this._log("guide.opened", { source });
    if (source === "help-menu") this._log("help.requested");
    this._persist({});
    this._emit();
    bus.emit("guide.opened", { guideId });
    this._evaluate("open");
  }

  close() {
    if (!this.state.open) return;
    if (!this.state.finished) this._log("guide.abandoned", { step: this.state.stepIndex + 1 });
    const user = getUser();
    if (user) { this._prog(user.id).active = null; save("guideProgress"); }
    this._teardown();
  }

  _teardown(silent) {
    clearTimeout(this.timer);
    this.timer = null;
    this.state = { ...this.state, open: false };
    document.body.classList.remove("guide-open", "sheet-min");
    if (!silent) this._emit();
    else this._emit();
  }

  restart() {
    const id = this.state.guide?.id;
    if (!id) return;
    if (!this.state.finished) this._log("guide.abandoned", { step: this.state.stepIndex + 1, restarted: true });
    this.open(id, { restart: true, source: "restart" });
  }

  next() { if (this.state.stepDone) this._advance(); }

  back() {
    if (this.state.stepIndex === 0 || this.state.finished) return;
    clearTimeout(this.timer);
    this.state = { ...this.state, stepIndex: this.state.stepIndex - 1, stepDone: false };
    this.suppressAuto = true;
    this._persist({});
    this._emit();
    this._evaluate("back");
  }

  skipStep() {
    if (this.state.finished) return;
    this._log("step.skipped", { step: this.state.stepIndex + 1, stepId: this.step.id });
    this._advance(true);
  }

  goToStep(i) {
    if (i > this.state.stepIndex || i < 0 || this.state.finished) return;
    clearTimeout(this.timer);
    this.state = { ...this.state, stepIndex: i, stepDone: false };
    this.suppressAuto = true;
    this._persist({});
    this._emit();
    this._evaluate("jump");
  }

  goToStepRoute() {
    const r = this.step?.route;
    if (r) navigate(r.go(this.ctx()));
  }

  // ---------- validation ----------
  _evaluate(event, payload) {
    const s = this.state;
    if (!s.open || s.finished) return;
    const step = this.step;
    if (!step) return;
    const ctx = this.ctx();
    const misroute = !!step.route && !step.route.match.test(ctx.route.path);
    const c = step.completion || {};
    const eventHit = c.events?.includes(event);
    let satisfied = false;
    try {
      let recentPayload;
      const recentHit = !eventHit && !!c.events?.some((ev) => { const r = this.recent.get(ev); if (r && Date.now() - r.ts < 4000) { recentPayload = r.payload; return true; } return false; });
      satisfied = (eventHit && (!c.check || c.check(ctx, payload))) || (recentHit && (!c.check || c.check(ctx, recentPayload))) || (!!c.check && c.check(ctx, payload));
    } catch (err) { console.warn("[guide] check failed", err); }

    let changed = false;
    if (misroute !== s.misroute) { s.misroute = misroute; changed = true; }

    if (satisfied) {
      if (!s.stepDone) {
        s.stepDone = true;
        this.completed.add(step.id);
        this._log("step.completed", { step: s.stepIndex + 1, stepId: step.id });
        this._persist({});
        changed = true;
      }
      if (!this.suppressAuto) {
        const restartTimer = eventHit && step.settleMs;
        if (!this.timer || restartTimer) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this._advance(), restartTimer ? step.settleMs : eventHit ? ADVANCE_EVENT_MS : ADVANCE_STATE_MS);
        }
      }
    } else if (s.stepDone && this.timer && c.check) {
      // e.g. the user cleared the field again before we advanced
      clearTimeout(this.timer); this.timer = null;
      s.stepDone = false; this.completed.delete(step.id);
      changed = true;
    }
    if (changed) this._emit();
  }

  _advance() {
    clearTimeout(this.timer);
    this.timer = null;
    const s = this.state;
    if (!s.open || s.finished) return;
    if (s.stepIndex >= s.guide.steps.length - 1) return this._finish();
    this.state = { ...s, stepIndex: s.stepIndex + 1, stepDone: false, misroute: false };
    this.suppressAuto = false;
    this._persist({});
    this._emit();
    this._evaluate("step");
  }

  _finish() {
    const s = this.state;
    const user = getUser();
    const prog = this.progressFor(s.guide.id) || {};
    const durationMs = Date.now() - (prog.runStartedAt || Date.now());
    this.state = { ...s, finished: true, stepDone: true, summary: { durationMs, steps: s.guide.steps.length, done: this.completed.size } };
    this._log("guide.completed", { durationMs });
    this._persist({ status: "completed", completedAt: Date.now(), durationMs });
    if (user) this._prog(user.id).active = s.guide.id;
    this._emit();
    bus.emit("guide.completed", { guideId: s.guide.id });
  }
}

export const guideEngine = new GuideEngine();
