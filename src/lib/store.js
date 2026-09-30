// Persisted collections (localStorage) with a clean seam for a future backend.
// load(key) returns the live in-memory object; call save(key) after mutating it.
import { bus } from "./events.js";
import { makeSeed } from "./mockData.js";
import { api, setToken, getToken, setUnauthorizedHandler } from "../services/api.js";

const PREFIX = "we360.v2.";
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
  bus.emit("session");
}

export const DEMO_USER_BY_ROLE = { learner: "u-maya", instructor: "u-daniel", admin: "u-priya" };
export const DEMO_EMAIL_BY_ROLE = { learner: "maya@workeasy360.dev", instructor: "daniel@workeasy360.dev", admin: "admin@workeasy360.dev" };
export const DEMO_PASSWORD = "password123";
// Demo entry points (one-click demo workspaces on the sign-in page, the `?as=<role>` shortcut) exist for local
// development and the test suites. A deployment that sets `window.WE360_API_BASE` hides them unless it also sets
// `window.WE360_DEMO = true`.
export const DEMO_ENABLED = typeof window === "undefined" ? true : window.WE360_DEMO ?? !window.WE360_API_BASE;

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
  registerSession(token, user);
  return user;
}

/** Stores a backend session (token + user) — used by sign-in and by self-registration. */
export function registerSession(token, user) {
  ++loginSeq;
  setToken(token);
  // Any account can sign in, not only the seeded demo people: make sure the directory cache knows this user.
  const people = load("users"), i = people.findIndex((u) => u.id === user.id), cur = i >= 0 ? people[i] : { joinedAt: Date.now(), base: {}, targets: {} };
  const row = { ...cur, id: user.id, name: user.name, email: user.email ?? cur.email ?? "", role: String(user.role).toLowerCase(), title: user.title ?? cur.title ?? "", dept: user.dept ?? cur.dept ?? "", hue: user.hue ?? cur.hue ?? 250, streak: user.streak ?? cur.streak ?? 0 };
  if (i >= 0) people[i] = row; else people.push(row);
  persist("users");
  login(user.id);
  return user;
}

export const isBackendOnline = () => !!getToken();

setUnauthorizedHandler(() => setToken(null));
