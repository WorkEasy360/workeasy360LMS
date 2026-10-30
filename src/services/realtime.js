// Real-time synchronization: one Server-Sent-Events stream per signed-in tab. The backend announces "this kind of
// data changed" after every committed write (its own tenant and audience rules decide who hears it); this module
// re-pulls the affected data through the normal authorized endpoints and the store's data:* events re-render any
// mounted page. The merge guards in courseSync keep a course that is dirty or open in the Builder from being
// clobbered, exactly as during login hydration.
//
// Connection lifecycle: starts on sign-in, stops on sign-out, reconnects with backoff after network interruptions,
// and re-hydrates everything after each reconnect so nothing announced during the gap is missed.
import { api, API_BASE, getToken } from "./api.js";
import { bus } from "../lib/events.js";
import { getUser, isBackendOnline } from "../lib/store.js";
import { hydrateMyCourses, hydrateCatalog } from "./courseSync.js";
import { hydrateMyLearning } from "./learningSync.js";
import { hydrateCommunity } from "./communitySync.js";
import { hydrateSkills } from "./skillsSync.js";
import { hydrateUsers, hydrateNotifications, hydrateSettings } from "./people.js";

let source = null;
let startedForToken = null;
let retryMs = 2000;
let retryTimer = null;
const DEBOUNCE_MS = 700;
const pending = new Map(); // type -> timer

const hydrateCourses = () => (getUser()?.role === "learner" ? hydrateCatalog() : hydrateMyCourses());

const HANDLERS = {
  courses: hydrateCourses,
  community: hydrateCommunity,
  users: hydrateUsers,
  settings: hydrateSettings,
  skills: hydrateSkills,
  notifications: hydrateNotifications,
  // Learning state changed somewhere relevant to me: my own enrolments/progress/certificates re-pull here; staff
  // pages that fetch their own data (review queue, analytics, course learners) listen for sync:learning and refetch.
  learning: async () => { await hydrateMyLearning(); bus.emit("sync:learning", {}); },
};

function schedule(type) {
  const run = HANDLERS[type];
  if (!run) return;
  clearTimeout(pending.get(type));
  pending.set(type, setTimeout(() => {
    pending.delete(type);
    if (!getUser()) return;
    Promise.resolve(run()).catch((err) => console.warn(`[realtime] refreshing ${type} failed:`, err.message));
  }, DEBOUNCE_MS));
}

/** After a reconnect, anything could have changed while we were away: re-pull everything for this role. */
async function revalidateAll() {
  if (!getUser()) return;
  try {
    await hydrateCourses();
    await Promise.all([hydrateMyLearning(), hydrateCommunity(), hydrateUsers(), hydrateNotifications(), hydrateSettings(), hydrateSkills()]);
    bus.emit("sync:learning", {});
  } catch (err) { console.warn("[realtime] revalidation failed:", err.message); }
}

async function connect() {
  if (!getUser() || !getToken() || !isBackendOnline()) return;
  const token = getToken();
  let ticket;
  try { ticket = (await api.syncTicket()).ticket; } catch (err) { scheduleRetry(); return; }
  if (getToken() !== token || !getUser()) return; // signed out while fetching the ticket

  const es = new EventSource(`${API_BASE}/sync/stream?ticket=${encodeURIComponent(ticket)}`);
  source = es;
  startedForToken = token;
  let everOpen = false;

  es.addEventListener("hello", () => {
    everOpen = true;
    const hadGap = retryMs > 2000; // this connection follows at least one failed attempt
    retryMs = 2000;
    if (hadGap) revalidateAll();
  });
  es.addEventListener("sync", (e) => {
    try { schedule(JSON.parse(e.data).type); } catch { /* malformed event: ignore */ }
  });
  es.onerror = () => {
    es.close();
    if (source === es) source = null;
    if (getUser() && getToken()) scheduleRetry();
  };
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (!source) connect(); }, retryMs);
  retryMs = Math.min(retryMs * 2, 30000);
}

export function stopRealtime() {
  clearTimeout(retryTimer);
  pending.forEach((t) => clearTimeout(t));
  pending.clear();
  if (source) { source.close(); source = null; }
  startedForToken = null;
  retryMs = 2000;
}

export function startRealtime() {
  const token = getToken();
  if (!getUser() || !token || !isBackendOnline()) { stopRealtime(); return; }
  if (source && startedForToken === token) return; // already streaming for this session
  stopRealtime();
  connect();
}

// Follow the session: sign-in starts the stream, sign-out (or account switch) drops it and its queued refreshes.
bus.on("session", startRealtime);
startRealtime();
