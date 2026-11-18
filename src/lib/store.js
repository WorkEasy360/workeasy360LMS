// Persisted collections (localStorage) with a clean seam for a future backend.
// load(key) returns the live in-memory object; call save(key) after mutating it.
import { bus } from "./events.js";
import { makeSeed } from "./mockData.js";
import { api, setToken, getToken, getSessionKey, hasWorkeasy360Session, setWorkeasy360Session, setUnauthorizedHandler } from "../services/api.js";

const PREFIX = "we360.v3.";
const cache = {};
let seedCache;

function seed() {
  return (seedCache ||= makeSeed());
}

export function load(key) {
  if (key in cache) return cache[key];
  let value;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) value = JSON.parse(raw);
  } catch {}
  if (value === undefined) {
    value = structuredClone(seed()[key] ?? []);
    cache[key] = value;
    persist(key);
  }
  cache[key] = value;
  return value;
}

function persist(key) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(cache[key]));
  } catch (err) {
    console.warn("[store] could not persist", key, err);
  }
}

export function save(key) {
  persist(key);
  bus.emit("data:" + key);
  bus.emit("data");
}

export function replace(key, value) {
  cache[key] = value;
  save(key);
}

export function resetAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch {}
  Object.keys(cache).forEach((k) => delete cache[k]);
  seedCache = null;
  bus.emit("data:reset");
}

// ---- session (mock authentication) ----
const SESSION_KEY = PREFIX + "session";

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

export function getUser() {
  const s = getSession();
  if (!s) return null;
  return load("users").find((u) => u.id === s.userId) || null;
}

export function login(userId) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId })); } catch {}
  bus.emit("session");
}

export function logout() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
  setToken(null);
  setWorkeasy360Session(false);
  bus.emit("session");
}

/**
 * Signs out of WorkEasyLMS. A WorkEasy360 session is ended on the server first (POST /api/auth/logout, which also
 * leaves the "signed out" marker so nothing starts a new sign-in by itself); a password session only drops its token,
 * as before. With `workeasy360: true` the browser then goes on to WorkEasy360's own sign-out.
 */
export async function signOut({ workeasy360 = false } = {}) {
  const wasW360 = hasWorkeasy360Session();
  if (wasW360) { try { await api.logoutSession(); } catch (err) { console.warn("[auth] server sign-out failed:", err.message); } }
  logout();
  if (wasW360 && workeasy360) { location.href = api.workeasy360LogoutUrl(); return true; }
  return false;
}

export const DEMO_USER_BY_ROLE = { learner: "u-maya", instructor: "u-daniel", admin: "u-priya" };
export const DEMO_EMAIL_BY_ROLE = { learner: "maya@workeasy360.dev", instructor: "daniel@workeasy360.dev", admin: "admin@workeasy360.dev" };
export const DEMO_PASSWORD = "password123";
// Demo tooling (one-click demo workspaces on the sign-in page, the `?as=<role>` shortcut, "View as") exists for the
// automated test suites and for explicit demos ONLY. It activates when the test runner's query parameters are present
// (`?as=` / `?selftest=`, which hash navigation preserves for the whole session) or when a page sets
// `window.WE360_DEMO = true`. Plain browsing — any environment, localhost included — is real-accounts only.
export const DEMO_ENABLED = typeof window === "undefined"
  ? false
  : window.WE360_DEMO ?? (!window.WE360_API_BASE && /(^|[?&])(as|selftest)=/.test(window.location.search));

// ---- real backend auth ----
// Signs in against the Java backend (backend/) and keeps the existing localStorage session in lock-step, using
// the SAME user id on both sides (see backend DataSeeder), so every existing getUser()-based call site keeps
// working unchanged whether or not the backend happens to be reachable — this only adds a real JWT on top.
let loginSeq = 0;
export async function loginReal(email, password) {
  const seq = ++loginSeq;
  const { token, user } = await api.login(email, password);
  // Only the most recent sign-in may apply: a slower earlier request (e.g. the demo `?as=` boot login) resolving
  // after a newer one must not clobber the newer token — every later API call would silently run as the wrong user.
  if (seq !== loginSeq) return user;
  // A WorkEasy360 session this browser may still hold is ended: one person, one session.
  if (hasWorkeasy360Session()) api.logoutSession().catch(() => {});
  registerSession(token, user);
  return user;
}

/** Stores a backend session (token + user) — used by sign-in and by self-registration. */
export function registerSession(token, user) {
  ++loginSeq;
  setWorkeasy360Session(false);
  setToken(token);
  return rememberUser(user);
}

/** A WorkEasy360 session: the server holds it behind an httpOnly cookie, so nothing secret is stored here. */
export function registerWorkeasy360Session(user) {
  ++loginSeq;
  setToken(null);
  setWorkeasy360Session(true);
  return rememberUser(user);
}

function rememberUser(user) {
  // Any account can sign in, not only the seeded demo people: make sure the directory cache knows this user.
  const people = load("users"), i = people.findIndex((u) => u.id === user.id), cur = i >= 0 ? people[i] : { joinedAt: Date.now(), base: {}, targets: {} };
  const row = { ...cur, id: user.id, name: user.name, email: user.email ?? cur.email ?? "", role: String(user.role).toLowerCase(), title: user.title ?? cur.title ?? "", dept: user.dept ?? cur.dept ?? "", hue: user.hue ?? cur.hue ?? 250, streak: user.streak ?? cur.streak ?? 0 };
  if (i >= 0) people[i] = row; else people.push(row);
  persist("users");
  login(user.id);
  return user;
}

export const isBackendOnline = () => !!getSessionKey();

/**
 * On a page load without a password token: does this browser hold a WorkEasy360 session (the httpOnly cookie, which
 * script cannot see)? Asks the server once, bounded, so an unreachable backend never holds the page up.
 */
export async function restoreWorkeasy360Session({ timeoutMs = 4000 } = {}) {
  if (getToken()) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  try {
    const answer = await Promise.race([api.session(), timeout]);
    if (answer === "timeout" || !answer) return null;
    if (answer.method === "workeasy360" && answer.user) {
      const known = hasWorkeasy360Session() && getUser()?.id === answer.user.id;
      if (!known) registerWorkeasy360Session(answer.user);
      return answer;
    }
  } catch (err) {
    if (err.status === 401 && hasWorkeasy360Session()) logout(); // the server ended it (expired, or signed out elsewhere)
  }
  return null;
}

// An expired or revoked token: end the session cleanly and return to sign-in, instead of leaving the person on a
// page where every save quietly fails. api.js only calls this for a 401 on the token that is still current, and
// never for /auth/login itself (a wrong password during re-login must not end the session in use).
setUnauthorizedHandler(() => {
  setToken(null);
  setWorkeasy360Session(false);
  if (getUser()) { logout(); location.hash = "#/login"; }
});
