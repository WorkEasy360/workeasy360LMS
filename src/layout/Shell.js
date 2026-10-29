// Persistent application shell: sidebar + topbar are built once and updated on navigation (the guide panel never remounts).
import { h, mount, debounce } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { navByRole, ROLE_LABEL, activeNavPath } from "./navConfig.js";
import { Breadcrumb } from "../components/Tabs.js";
import { Dropdown } from "../components/Menu.js";
import { Button } from "../components/Button.js";
import { Badge } from "../components/Badge.js";
import { openDrawer, openModal, confirmDialog, toast } from "../components/Overlay.js";
import { Field, Input } from "../components/Form.js";
import { api } from "../services/api.js";
import { EmptyState } from "../components/States.js";
import { getUser, login, logout, resetAll, DEMO_USER_BY_ROLE, DEMO_ENABLED } from "../lib/store.js";
import { unreadCount, notificationsFor, markRead, initials } from "../services/people.js";
import { ProductLogo, ProductMark } from "../components/Brand.js";
import { initAgent, updateAgent } from "../components/Agent.js";
import { search } from "../services/search.js";
import { navigate } from "../router.js";
import { canCreateCourse } from "../services/permissions.js";
import { guidesForRole, contextGuide } from "../guide/guides.js";
import { guideEngine } from "../guide/GuideEngine.js";
import { timeAgo } from "../lib/dom.js";
import { bus } from "../lib/events.js";

const $ = (id) => document.getElementById(id);

// Collapsed (icon-only) sidebar on desktop, remembered per browser — as in WorkEasy360 Booking.
const NAV_COLLAPSED_KEY = "we360.v3.navCollapsed";
function setNavCollapsed(on) {
  document.body.classList.toggle("nav-collapsed", on);
  try { localStorage.setItem(NAV_COLLAPSED_KEY, on ? "1" : "0"); } catch {}
  $("sidebar").querySelector(on ? "[data-nav-expand]" : "[data-nav-collapse]")?.focus();
}

export function renderSidebar(path) {
  const user = getUser();
  const active = activeNavPath(path, user.role);
  const nav = h("nav", { class: "nav", "aria-label": "Main" }, navByRole[user.role].flatMap((sec) => [
    h("div", { class: "nav-label" }, sec.section),
    ...sec.items.map((it) => {
      const count = it.count === "notifications" ? unreadCount(user.id) : 0;
      return h("a", { class: "nav-item", href: "#" + it.path, "aria-current": it.path === active ? "page" : undefined, title: it.label, "data-guide-target": "nav" + (it.path === "/" ? ".home" : it.path.replace(/\//g, ".")) }, [
        ico(it.icon, 20), h("span", { class: "nav-text" }, it.label), count ? h("span", { class: "nav-count", "aria-label": `${count} unread` }, String(count)) : null,
      ]);
    }),
  ]));
  mount($("sidebar"),
    h("div", { class: "brand" }, [
      h("a", { class: "brand-link", href: "#/", "aria-label": "WorkEasy360 LMS home" }, [ProductLogo({ tone: "dark", layout: "stacked", size: "md", decorative: true }), ProductMark(32, "", "brand-compact")]),
      h("button", { class: "sidebar-toggle", type: "button", "aria-label": "Collapse sidebar", title: "Collapse sidebar", "data-nav-collapse": "", onclick: () => setNavCollapsed(true) }, ico("chevron-left", 16)),
    ]),
    canCreateCourse(user) ? h("div", { class: "nav-cta" }, h("a", { class: "btn btn-primary", href: "#/builder/new", title: "Create Course", "data-guide-target": "nav.create-course" }, [ico("plus", 18), h("span", { class: "cta-label" }, "Create Course")])) : null,
    nav,
    h("div", { class: "sidebar-expand" }, h("button", { class: "sidebar-toggle", type: "button", "aria-label": "Expand sidebar", title: "Expand sidebar", "data-nav-expand": "", onclick: () => setNavCollapsed(false) }, ico("chevron-right", 16))),
    h("div", { class: "sidebar-foot" }, h("div", { class: "sidebar-user" }, [
      h("span", { class: "brand-avatar", "aria-hidden": "true" }, initials(user.name)),
      h("div", { class: "grow" }, [h("div", { class: "sidebar-user-name truncate" }, user.name), h("div", { class: "sidebar-user-role" }, ROLE_LABEL[user.role])]),
    ]))
  );
}

export function renderTopbar(pageMeta = {}, path = "/") {
  const user = getUser();
  const crumbs = pageMeta.crumbs || [{ label: pageMeta.title || "" }];

  const searchBox = SearchBox(user);
  const guides = () => {
    const ctxG = contextGuide(path, user.role);
    const list = guidesForRole(user.role).sort((a, b) => (b.id === ctxG?.id) - (a.id === ctxG?.id));
    return [
      { group: "Guide me" },
      ...list.map((g) => {
        const p = guideEngine.progressFor(g.id);
        return { label: g.title, icon: "help", desc: `${g.steps.length} steps · ~${g.estimatedMinutes} min`, badge: p?.status === "completed" ? Badge("Done", "success") : p?.status === "in_progress" ? Badge("In progress", "primary") : g.id === ctxG?.id ? Badge("Suggested", "teal") : null, onClick: () => guideEngine.open(g.id, { source: "help-menu" }) };
      }),
    ];
  };

  const bell = h("button", { class: "btn btn-ghost btn-icon", type: "button", "aria-label": `Notifications${unreadCount(user.id) ? `, ${unreadCount(user.id)} unread` : ""}`, style: "position:relative", onclick: () => openNotifications() }, [ico("bell", 20), unreadCount(user.id) ? h("span", { class: "notif-dot" }) : null]);

  // "View as" and "Reset demo data" are DEMO tooling: they switch the local demo session between the seeded demo
  // people. They exist only in demo mode AND only for the demo accounts themselves — a real account (self-registered
  // or admin-created) must never be offered another role's workspace, even though the backend refuses every
  // privileged call anyway (the role lives in the signed JWT, not in this menu).
  const isDemoUser = DEMO_ENABLED && Object.values(DEMO_USER_BY_ROLE).includes(user.id);
  const userMenu = Dropdown({
    align: "right", items: () => [
      ...(isDemoUser ? [
        { group: "View as" },
        ...Object.keys(ROLE_LABEL).map((r) => ({ label: ROLE_LABEL[r], icon: r === user.role ? "check" : "user", onClick: () => { if (r !== user.role) { login(DEMO_USER_BY_ROLE[r]); navigate("/", { replace: true }); } } })),
        "sep",
        { label: "Reset demo data", icon: "refresh", onClick: async () => { if (await confirmDialog({ title: "Reset demo data?", message: "This restores all courses, progress, posts and guides to their original state.", confirmLabel: "Reset", danger: true })) { resetAll(); logout(); location.hash = "#/login"; location.reload(); } } },
      ] : [
        // Real accounts manage their own password here; demo accounts share a published one, so they don't.
        { label: "Change password", icon: "shield", onClick: () => changePasswordDialog() },
        "sep",
      ]),
      { label: "Sign out", icon: "logout", onClick: () => { guideEngine.close(); logout(); navigate("/login"); } },
    ],
    renderTrigger: ({ onClick }) => h("button", { class: "user-btn", type: "button", onclick: onClick, "aria-label": `Account menu for ${user.name}` }, [
      h("span", { class: "brand-avatar", "aria-hidden": "true" }, initials(user.name)),
      h("span", { class: "user-name" }, [h("span", { class: "small strong" }, user.name.split(" ")[0]), h("span", { class: "user-role" }, ROLE_LABEL[user.role])]),
      ico("chevron-down", 14),
    ]),
  });

  mount($("topbar"),
    h("button", { class: "btn btn-ghost btn-icon menu-toggle", type: "button", "aria-label": "Open navigation", onclick: () => document.body.classList.add("nav-open") }, ico("menu", 20)),
    h("div", { class: "grow", style: "min-width:0" }, Breadcrumb(crumbs)),
    searchBox,
    Dropdown({ label: "Guide me", icon: "help", variant: "soft", items: guides, align: "right", attrs: { "data-guide-target": "help.guide-me" } }),
    bell, userMenu
  );
}

function SearchBox(user) {
  const input = h("input", { class: "input", type: "search", placeholder: "Search courses, people, skills…", "aria-label": "Search", role: "combobox", "aria-expanded": "false", "aria-controls": "search-results", autocomplete: "off" });
  const wrap = h("div", { class: "topbar-search" }, [ico("search", 18), input, h("span", { class: "kbd" }, "/")]);
  let panel = null, hits = [], idx = -1;
  const close = () => { panel?.remove(); panel = null; input.setAttribute("aria-expanded", "false"); idx = -1; };
  const go = (hit) => { close(); input.value = ""; navigate(hit.href); };
  const paint = () => hits.forEach((el, i) => el.setAttribute("aria-selected", String(i === idx)));
  const run = debounce(() => {
    const groups = search(input.value, user);
    close();
    if (input.value.trim().length < 2) return;
    hits = [];
    panel = h("div", { class: "search-results", id: "search-results", role: "listbox" },
      groups.length
        ? groups.flatMap((g) => [h("div", { class: "search-group" }, g.label), ...g.items.map((it) => {
          const el = h("a", { class: "search-hit", role: "option", href: "#" + it.href, "aria-selected": "false", onclick: (e) => { e.preventDefault(); go(it); } }, [h("span", { class: "icon-tile", style: "width:32px;height:32px;border-radius:9px" }, ico(it.icon, 16)), h("span", { class: "grow truncate" }, [h("span", { class: "strong", style: "display:block" }, it.title), h("span", { class: "xs muted" }, it.subtitle || "")])]);
          el._hit = it; hits.push(el); return el;
        })])
        : h("div", { class: "state", style: "padding:24px" }, [h("p", {}, `No results for “${input.value}”`)]));
    wrap.appendChild(panel);
    input.setAttribute("aria-expanded", "true");
  }, 120);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); input.blur(); }
    else if (e.key === "ArrowDown" && hits.length) { e.preventDefault(); idx = (idx + 1) % hits.length; paint(); hits[idx].scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp" && hits.length) { e.preventDefault(); idx = (idx - 1 + hits.length) % hits.length; paint(); }
    else if (e.key === "Enter" && (hits[idx] || hits[0])) { e.preventDefault(); go((hits[idx] || hits[0])._hit); } // Enter with no highlight opens the first result
  });
  document.addEventListener("mousedown", (e) => { if (!wrap.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) { e.preventDefault(); input.focus(); } });
  return wrap;
}

function changePasswordDialog() {
  const current = Input({ type: "password", autocomplete: "current-password", placeholder: "Current password", "data-pw-current": "" });
  const next = Input({ type: "password", autocomplete: "new-password", placeholder: "At least 8 characters, letters and numbers", "data-pw-new": "" });
  const confirm = Input({ type: "password", autocomplete: "new-password", placeholder: "Repeat the new password", "data-pw-confirm": "" });
  const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true, "data-pw-error": "" });
  openModal({
    title: "Change password", size: "sm",
    content: h("div", { class: "stack" }, [Field({ label: "Current password", control: current }), Field({ label: "New password", hint: "At least 8 characters with a letter and a number.", control: next }), Field({ label: "Confirm new password", control: confirm }), err]),
    footer: (close) => [Button({ label: "Cancel", onClick: close }), Button({ label: "Change password", variant: "primary", attrs: { "data-pw-submit": "" }, onClick: async (e) => {
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      err.hidden = true;
      if (next.value.length < 8 || !/[A-Za-z]/.test(next.value) || !/\d/.test(next.value)) return fail("Use a password of at least 8 characters with at least one letter and one number.");
      if (next.value !== confirm.value) return fail("The two passwords don't match.");
      const btn = e.currentTarget; btn.disabled = true;
      try { await api.changePassword(current.value, next.value); close(); toast("Password changed"); }
      catch (ex) { fail(ex.message || "Could not change the password."); btn.disabled = false; }
    } })],
  });
}

function openNotifications() {
  const user = getUser();
  const items = notificationsFor(user.id);
  openDrawer({
    title: "Notifications",
    content: () => items.length
      ? h("div", { class: "stack-sm" }, [
        ...items.map((n) => h("a", { class: "card card-pad-sm card-link", href: "#" + n.href, style: "display:flex;gap:12px;" + (n.read ? "" : "border-color:var(--c-primary);background:var(--c-primary-soft)"), onclick: (e) => { e.currentTarget.closest(".scrim")?.remove(); } }, [
          h("span", { class: "icon-tile" }, ico({ due: "clock", reply: "message", achievement: "award", submission: "upload", expiry: "shield", insight: "chart", review: "clipboard", enrolment: "book" }[n.kind] || "bell", 18)),
          h("div", { class: "grow" }, [h("div", { class: "strong small" }, n.title), h("div", { class: "small muted" }, n.body), h("div", { class: "xs muted", style: "margin-top:4px" }, timeAgo(n.at))]),
        ])),
        Button({ label: "Mark all as read", variant: "ghost", size: "sm", onClick: () => { markRead(user.id); toast("All caught up", { type: "info" }); refreshChrome(); } }),
      ])
      : EmptyState({ icon: "bell", title: "You're all caught up", description: "New notifications will show up here." }),
  });
}

let chromePath = "/", chromeMeta = {};
export function refreshChrome() { renderSidebar(chromePath); renderTopbar(chromeMeta, chromePath); }

export function setPage(page, path) {
  chromePath = path; chromeMeta = page;
  renderSidebar(path);
  renderTopbar(page, path);
  document.title = `${page.title ? page.title + " · " : ""}WorkEasy360`;
  const main = $("main");
  main.classList.toggle("bleed", !!page.bleed);
  mount(main, h("div", { class: "page-inner" }, page.el));
  main.scrollTop = 0;
  document.body.classList.remove("nav-open");
  // Navigating away closes any open modal or drawer: a dialog from the previous page must never sit on top of the
  // next one (a certificate modal was surviving onto Community, covering the composer).
  $("overlay-root")?.querySelectorAll(".scrim").forEach((s) => s.remove());
  updateAgent(path);
  const target = main.querySelector("#page-title, h1") || main;
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

export function initShell() {
  $("sidebar-scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));
  document.addEventListener("keydown", (e) => e.key === "Escape" && document.body.classList.remove("nav-open"));
  bus.on("data:notifications", () => getUser() && refreshChrome());
  try { document.body.classList.toggle("nav-collapsed", localStorage.getItem(NAV_COLLAPSED_KEY) === "1"); } catch {}
  initAgent($("app"));
}
