// People directory, notifications and organisation settings.
// With the backend online these are backend-authoritative: the directory, the signed-in user's notifications and the
// settings are pulled on login/refresh (hydrate*) and every change is pushed. The local store is the render cache —
// and the complete implementation when no backend is running (offline demo).
import { load, save, replace, isBackendOnline, getUser } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { uid } from "../lib/dom.js";
import { api } from "./api.js";

const warn = (what) => (err) => console.warn(`[people] ${what} failed:`, err.message);

export const users = () => load("users");
export const userById = (id) => users().find((u) => u.id === id) || null;
export const initials = (name = "") => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
export const avatarBg = (u) => `background: hsl(${u?.hue ?? 250} 55% 42%)`;
export const settings = () => load("settings")[0];

/** Backend user → local directory row (the backend omits e-mail for everyone but admins and the user themself). */
function toLocalUser(d, cur = {}) {
  return { ...cur, id: d.id, name: d.name, email: d.email ?? cur.email ?? "", role: String(d.role).toLowerCase(), title: d.title ?? cur.title ?? "", dept: d.dept ?? cur.dept ?? "", hue: d.hue ?? cur.hue ?? 250, streak: d.streak ?? cur.streak ?? 0, joinedAt: cur.joinedAt ?? Date.now(), base: cur.base || {}, targets: cur.targets || {} };
}

export async function hydrateUsers() {
  if (!isBackendOnline()) return;
  try {
    const rows = await api.users();
    const byId = new Map(users().map((u) => [u.id, u]));
    rows.forEach((d) => byId.set(d.id, toLocalUser(d, byId.get(d.id))));
    replace("users", [...byId.values()]);
  } catch (err) { warn("loading people")(err); }
}

/** Admin: create a person on the backend (returns the one-time temporary password when none was given). */
export async function createUser({ name, email, role, title, dept, password }) {
  if (!isBackendOnline()) {
    const u = { id: uid("u"), name, email, role, title: title || "New team member", dept: dept || "Unassigned", hue: Math.round(Math.random() * 360), joinedAt: Date.now(), streak: 0, base: {}, targets: {} };
    users().push(u); save("users");
    return { user: u, temporaryPassword: null, local: true };
  }
  const res = await api.createUser({ name, email, role, title, dept, password });
  users().push(toLocalUser(res.user)); save("users");
  return { user: userById(res.user.id), temporaryPassword: res.temporaryPassword, local: false };
}

/** Admin: issue a one-time password-reset link for a person (needs the backend; there is nothing to reset locally). */
export async function requestPasswordReset(id) {
  if (!isBackendOnline()) throw new Error("Password resets need the backend. Connect it and try again.");
  return api.userResetToken(id);
}

/** Admin: change a person's role / title / team / status. */
export async function updateUser(id, patch) {
  const u = userById(id);
  if (!u) throw new Error("Unknown user");
  if (isBackendOnline()) {
    const d = await api.updateUser(id, patch);
    Object.assign(u, toLocalUser(d, u));
  } else Object.assign(u, patch);
  save("users");
  return u;
}

// ---------- notifications ----------
export function notificationsFor(userId) {
  return load("notifications").filter((n) => n.userId === userId).sort((a, b) => b.at - a.at);
}
export const unreadCount = (userId) => notificationsFor(userId).filter((n) => !n.read).length;

let pullTimer = null;
/** Pulls the signed-in user's notifications from the backend (authoritative); other users' local rows are kept for offline demo sessions. */
export async function hydrateNotifications() {
  const me = getUser();
  if (!me || !isBackendOnline()) return;
  try {
    const rows = await api.notifications();
    const others = load("notifications").filter((n) => n.userId !== me.id);
    replace("notifications", [...rows.map((n) => ({ id: n.id, userId: me.id, kind: n.kind, title: n.title, body: n.body, href: n.href, read: !!n.read, at: new Date(n.at).getTime() })), ...others]);
  } catch (err) { warn("loading notifications")(err); }
}

/**
 * Domain event → notification. Online, the backend records the event itself (reply, review, certificate, enrolment)
 * as part of the same API call, so this only schedules a pull; offline it writes the local row.
 */
export function notify(userId, n) {
  if (isBackendOnline()) {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => hydrateNotifications(), 1500);
    return;
  }
  load("notifications").unshift({ id: uid("n"), userId, read: false, at: Date.now(), ...n });
  save("notifications");
}

export function markRead(userId, id) {
  load("notifications").forEach((n) => { if (n.userId === userId && (!id || n.id === id)) n.read = true; });
  save("notifications");
  if (isBackendOnline() && getUser()?.id === userId) (id ? api.markNotificationRead(id) : api.markAllNotificationsRead()).catch(warn("marking notifications read"));
}

// ---------- settings ----------
export const AUTOMATION_RULES = [
  { key: "enrolmentNotifications", name: "Enrolment notifications", when: "An instructor or admin enrols a learner", then: "Notify the learner with the course link and due date" },
  { key: "dueReminders", name: "Due-date reminders", when: "A course is due within 3 days or overdue (checked at sign-in)", then: "Remind the learner, at most once a day" },
  { key: "certificateExpiry", name: "Certificate expiry warnings", when: "A certificate expires within 60 days or has expired (checked at sign-in)", then: "Warn the holder, at most once a week" },
  { key: "reviewNotifications", name: "Assignment review notifications", when: "An instructor reviews a submission", then: "Send the learner the feedback" },
  { key: "discussionReplies", name: "Discussion replies", when: "Someone replies to a post or a comment", then: "Notify its author" },
];
export const automationRules = () => { const a = settings().automation || {}; return AUTOMATION_RULES.map((r) => ({ ...r, enabled: a[r.key] !== false })); };

function fromBackendSettings(s) {
  let automation = {};
  try { automation = s.automationJson ? JSON.parse(s.automationJson) : {}; } catch { automation = {}; }
  return { orgName: s.orgName, supportEmail: s.supportEmail, certExpiryDefault: s.certExpiryDefault, guidesEnabled: s.guidesEnabled, communityEnabled: s.communityEnabled, maxVideoMB: s.maxVideoMb, instructorPublish: s.instructorPublish, automation };
}

export async function hydrateSettings() {
  if (!isBackendOnline()) return;
  try {
    const s = await api.settings();
    Object.assign(settings(), fromBackendSettings(s));
    save("settings");
    bus.emit("settings.changed", {});
  } catch (err) { warn("loading settings")(err); }
}

export function updateSettings(patch) {
  Object.assign(settings(), patch);
  save("settings");
  bus.emit("settings.changed", patch);
  if (isBackendOnline() && getUser()?.role === "admin") {
    const { maxVideoMB, ...rest } = patch;
    api.updateSettings({ ...rest, ...(maxVideoMB !== undefined && { maxVideoMb: maxVideoMB }) })
      .then((s) => { Object.assign(settings(), fromBackendSettings(s)); save("settings"); })
      .catch(warn("saving settings"));
  }
}
