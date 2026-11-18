// Sign in with WorkEasy360 Accounts (backend docs/workeasy360-sso.md), the browser's side of it.
//
// The browser never holds a WorkEasy360 token: the backend runs the whole OpenID Connect flow and keeps the session
// behind an httpOnly cookie. All the app does is send the person to /api/auth/workeasy360/start, show why a sign-in
// failed (?sso_error=<code>), and, only when WorkEasyLMS is SSO-only, start a sign-in by itself for a page that needs
// one (integration guide section 6b) - never on the sign-in page, never right after a sign-out, never in a loop.
import { api } from "./api.js";

let config = null;
const AUTO_START_KEY = "we360.v3.w360autostart";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ssoConfig = () => config;
export const isUuid = (value) => typeof value === "string" && UUID.test(value);

/** What the sign-in page offers (public, cached). Never throws: no answer = WorkEasy360 sign-in not offered. */
export async function loadSsoConfig({ timeoutMs = 4000 } = {}) {
  if (config) return config;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try { config = (await Promise.race([api.ssoConfig(), timeout])) || null; } catch { config = null; }
  return config;
}

/** Sends the browser to WorkEasy360 (through the backend). `next` is a hash route such as "/courses". */
export function startWorkeasy360SignIn({ next, organization } = {}) {
  try { sessionStorage.setItem(AUTO_START_KEY, String(Date.now())); } catch {}
  location.href = api.workeasy360StartUrl({ next: next && next !== "/" ? next : undefined, organization });
}

/** Set by both sign-outs, cleared by a sign-in. Over https only the __Host- cookie counts (a sibling site cannot plant it). */
export function signedOutMarked() {
  const name = config?.signedOutMarker;
  if (!name) return false;
  if (location.protocol === "https:" && !name.startsWith("__Host-")) return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith(name + "=1"));
}

/** SSO-only, no session, not after a sign-out, and not again within a minute (a dropped cookie must not loop). */
export function shouldAutoStart() {
  if (!config?.enabled || !config.ssoOnly || signedOutMarked()) return false;
  let last = 0;
  try { last = Number(sessionStorage.getItem(AUTO_START_KEY) || 0); } catch {}
  return Date.now() - last > 60_000;
}

export function clearAutoStart() { try { sessionStorage.removeItem(AUTO_START_KEY); } catch {} }

// One sentence per code of the shared sso_error vocabulary.
export const SSO_ERROR_MESSAGES = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long or was already used. Please try again.",
  unavailable: "WorkEasy360 sign-in is unavailable right now. Please try again in a few minutes.",
  refused: "WorkEasy360 sign-in didn't complete. Please try again.",
  rate_limited: "Too many sign-in attempts. Please wait a minute and try again.",
  not_entitled: "Your organization doesn't have WorkEasyLMS yet. An owner can add it in WorkEasy360.",
  no_seat: "You don't have a WorkEasyLMS seat yet. Ask an administrator for one.",
  provider_membership_inactive: "Your membership of that organization isn't active. Ask an administrator.",
  organization_inactive: "That organization isn't active. Contact your administrator or WorkEasy360 support.",
  access_policy: "Your organization's sign-in policy didn't allow this sign-in.",
  email_missing: "WorkEasy360 didn't share your e-mail address, which WorkEasyLMS needs.",
  email_unverified: "Verify your e-mail address in WorkEasy360, then sign in again.",
  account_conflict: "Your e-mail address already belongs to a WorkEasyLMS account that isn't linked to this WorkEasy360 sign-in. Ask your WorkEasyLMS administrator to link your account.",
  account_disabled: "Your WorkEasyLMS account has been deactivated. Ask an administrator.",
  membership_inactive: "Your access has ended. Ask an administrator.",
  wrong_product: "That sign-in was meant for another product. Please try again from WorkEasyLMS.",
  wrong_organization: "You signed in to a different organization than the one you chose. Please try again.",
};
export const ssoErrorMessage = (code) => (code ? SSO_ERROR_MESSAGES[code] || SSO_ERROR_MESSAGES.refused : null);
