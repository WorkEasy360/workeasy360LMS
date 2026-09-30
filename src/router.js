// Hash router: route("/learn/:courseId/:lessonId?", handler, opts)
import { bus } from "./lib/events.js";

const routes = [];
let current = { path: "/", params: {}, query: {}, route: null };
let dispatch = () => {};
let notFoundRoute = null;

export function route(pattern, handler, opts = {}) {
  const names = [];
  const src = pattern.replace(/\/:([^/?]+)(\?)?/g, (_, n, opt) => {
    names.push(n);
    return opt ? "(?:/([^/]+))?" : "/([^/]+)";
  });
  routes.push({ pattern, regex: new RegExp("^" + src + "/?$"), names, handler, opts });
}

export const notFound = (handler, opts = {}) => (notFoundRoute = { pattern: "*", names: [], handler, opts });
export const currentRoute = () => current;

export function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs = ""] = raw.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", "#" + path);
  else if (location.hash.slice(1) !== path) location.hash = path;
  else resolve();
  if (replace) resolve();
}

export function href(path) { return "#" + path; }

function resolve() {
  const { path, query } = parseHash();
  let match = null;
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.names.forEach((n, i) => { if (m[i + 1] != null) params[n] = decodeURIComponent(m[i + 1]); });
      match = { path, params, query, route: r };
      break;
    }
  }
  current = match || { path, params: {}, query, route: notFoundRoute };
  bus.emit("route", current);
  dispatch(current);
}

export function startRouter(fn) {
  dispatch = fn;
  window.addEventListener("hashchange", resolve);
  resolve();
}

export const refreshRoute = () => resolve();
