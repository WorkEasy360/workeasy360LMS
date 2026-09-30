// Admin pages: People, Automation, Integrations (platform status), Settings.
import { h, timeAgo } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card } from "../components/Card.js";
import { Badge, Avatar } from "../components/Badge.js";
import { Progress } from "../components/Progress.js";
import { EmptyState, LoadingState, ErrorState } from "../components/States.js";
import { Field, Input, Select, SearchInput, Switch } from "../components/Form.js";
import { openModal, toast, confirmDialog } from "../components/Overlay.js";
import { resetAll, logout, isBackendOnline } from "../lib/store.js";
import { users, settings, updateSettings, createUser, updateUser, automationRules } from "../services/people.js";
import { enrollmentsFor, courseProgress } from "../services/learning.js";
import { api } from "../services/api.js";
import { guideEngine } from "../guide/GuideEngine.js";

const ROLE_OPTIONS = [{ value: "learner", label: "Learner" }, { value: "instructor", label: "Instructor" }, { value: "admin", label: "Admin" }];
const roleBadge = (role) => Badge(role[0].toUpperCase() + role.slice(1), role === "admin" ? "danger" : role === "instructor" ? "info" : "");

export function PeoplePage(ctx) {
  let q = "", role = "all";
  const body = h("div");
  const draw = () => {
    const rows = users().filter((u) => (role === "all" || u.role === role) && (!q || `${u.name} ${u.dept} ${u.title} ${u.email || ""}`.toLowerCase().includes(q.toLowerCase())));
    body.replaceChildren(rows.length ? h("div", { class: "card table-wrap" }, h("table", { class: "table" }, [
      h("thead", {}, h("tr", {}, ["Person", "Role", "Team", "Courses", "Avg. progress", "Last active", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.map((u) => {
        const es = enrollmentsFor(u.id);
        const avg = es.length ? Math.round(es.reduce((n, e) => n + courseProgress(u.id, e.courseId).pct, 0) / es.length) : 0;
        const last = Math.max(0, ...es.map((e) => e.lastActiveAt || 0));
        return h("tr", { "data-person": u.id }, [
          h("td", {}, h("div", { class: "row-sm" }, [Avatar(u, "sm"), h("div", {}, [h("div", { class: "strong" }, [u.name, u.status === "INACTIVE" ? Badge("Inactive", "", null) : null]), h("div", { class: "xs muted" }, u.email || "")])])),
          h("td", {}, roleBadge(u.role)), h("td", { class: "small" }, `${u.dept} · ${u.title}`), h("td", {}, String(es.length)),
          h("td", { style: "min-width:130px" }, es.length ? h("div", { class: "row-sm" }, [h("div", { style: "flex:1" }, Progress(avg, { size: "sm" })), h("span", { class: "xs strong" }, `${avg}%`)]) : h("span", { class: "muted small" }, "—")),
          h("td", { class: "small muted" }, last ? timeAgo(last) : "—"),
          h("td", {}, Button({ label: "Edit", icon: "edit", variant: "ghost", size: "sm", attrs: { "data-people-edit": u.id, "aria-label": `Edit ${u.name}` }, onClick: () => edit(u) })),
        ]);
      })),
    ])) : Card(EmptyState({ icon: "users", title: "No people match", description: "Try another search or filter." })));
  };
  draw();

  const invite = () => {
    const name = Input({ placeholder: "Full name", "data-people-name": "" }), email = Input({ type: "email", placeholder: "name@company.com", "data-people-email": "" });
    const roleSel = Select({ options: ROLE_OPTIONS, value: "learner", attrs: { "data-people-role": "" } });
    const title = Input({ placeholder: "Job title (optional)" }), dept = Input({ placeholder: "Team (optional)" });
    const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true });
    const online = isBackendOnline();
    openModal({ title: "Add a person", size: "sm",
      content: h("div", { class: "stack" }, [Field({ label: "Name", control: name }), Field({ label: "Email", control: email }), Field({ label: "Role", control: roleSel }), h("div", { class: "row" }, [h("div", { class: "grow" }, Field({ label: "Title", control: title })), h("div", { class: "grow" }, Field({ label: "Team", control: dept }))]), err,
        h("p", { class: "xs muted" }, online ? "The account is created on the server with a temporary password, shown once for you to pass on. No e-mail is sent." : "The backend is not connected: the person is only added to this browser's demo data.")]),
      footer: (close) => [Button({ label: "Cancel", onClick: close }), Button({ label: "Add person", variant: "primary", attrs: { "data-people-submit": "" }, onClick: async (e) => {
        if (name.value.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email.value)) { err.textContent = "Enter a name and a valid email address."; err.hidden = false; return; }
        const btn = e.currentTarget; btn.disabled = true;
        try {
          const res = await createUser({ name: name.value.trim(), email: email.value.trim(), role: roleSel.value, title: title.value.trim(), dept: dept.value.trim() });
          close(); draw(); toast(`${res.user.name} added`);
          if (res.temporaryPassword) openModal({ title: "Share the temporary password", size: "sm",
            content: h("div", { class: "stack-sm" }, [h("p", { class: "small" }, [`${res.user.name} can sign in with `, h("strong", {}, res.user.email), " and this temporary password:"]), h("code", { class: "strong", style: "font-size:18px;letter-spacing:1px;user-select:all", "data-temp-password": "" }, res.temporaryPassword), h("p", { class: "xs muted" }, "It is shown only once and is never stored in clear text.")]),
            footer: (c2) => [Button({ label: "Done", variant: "primary", onClick: c2 })] });
        } catch (ex) { err.textContent = ex.message || "Could not add this person."; err.hidden = false; btn.disabled = false; }
      } })] });
  };

  const edit = (u) => {
    const roleSel = Select({ options: ROLE_OPTIONS, value: u.role, attrs: { "data-people-role": "" } });
    const title = Input({ value: u.title || "" }), dept = Input({ value: u.dept || "" });
    const status = Select({ options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive (cannot sign in)" }], value: u.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" });
    const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true });
    const self = ctx?.user?.id === u.id;
    openModal({ title: `Edit ${u.name}`, size: "sm",
      content: h("div", { class: "stack" }, [Field({ label: "Role", hint: self ? "You can't change your own role." : null, control: roleSel }), Field({ label: "Title", control: title }), Field({ label: "Team", control: dept }), !self && Field({ label: "Status", control: status }), err]),
      footer: (close) => [Button({ label: "Cancel", onClick: close }), Button({ label: "Save", variant: "primary", attrs: { "data-people-save": "" }, onClick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try {
          await updateUser(u.id, { ...(self ? {} : { role: roleSel.value, status: status.value }), title: title.value.trim() || u.title, dept: dept.value.trim() || u.dept });
          close(); draw(); toast("Saved");
        } catch (ex) { err.textContent = ex.message || "Could not save."; err.hidden = false; btn.disabled = false; }
      } })] });
    if (self) roleSel.disabled = true;
  };

  return { title: "People", crumbs: [{ label: "People" }], el: h("div", { class: "stack-lg" }, [
    PageHeader({ title: "People", sub: `${users().length} people across your organisation.`, actions: [Button({ label: "Add person", icon: "plus", variant: "primary", attrs: { "data-people-add": "" }, onClick: invite })] }),
    h("div", { class: "row-between wrap" }, [h("div", { style: "width:min(320px,100%)" }, SearchInput({ placeholder: "Search people", onInput: (v) => { q = v; draw(); } })), Select({ options: [{ value: "all", label: "All roles" }, ...ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label + "s" }))], value: role, onChange: (v) => { role = v; draw(); }, attrs: { "aria-label": "Role filter", style: "width:auto" } })]),
    body,
  ]) };
}

export function AutomationPage() {
  const list = h("div");
  const draw = () => list.replaceChildren(Card(automationRules().map((r) => h("div", { class: "list-row", "data-automation-rule": r.key }, [
    h("span", { class: "icon-tile" }, ico("workflow", 20)),
    h("div", { class: "grow" }, [h("div", { class: "strong" }, r.name), h("div", { class: "small muted" }, `When: ${r.when} → ${r.then}`)]),
    Switch({ checked: r.enabled, label: `${r.name} enabled`, onChange: (v) => { updateSettings({ automation: { ...(settings().automation || {}), [r.key]: v } }); toast(`${r.name}: ${v ? "on" : "off"}`, { type: "info", duration: 1600 }); draw(); } }),
  ])), { pad: false, cls: "list-card" }));
  draw();
  return { title: "Automation", crumbs: [{ label: "Automation" }], el: h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Automation", sub: "Rules that keep learning on track without manual work." }),
    h("div", { class: "callout" }, [ico("workflow", 18), h("div", {}, [h("strong", {}, "How rules run. "), "Event rules fire on the server as things happen (an enrolment, a review, a reply, a completion). Reminder rules are evaluated when a person signs in and never repeat within their window. All notifications are in-app; no e-mail is sent."])]),
    list,
  ]) };
}

export function IntegrationsPage() {
  const body = h("div", { class: "stack-lg" });
  const kv = (rows) => h("div", { class: "stack-sm small" }, rows.filter(Boolean).map(([k, v]) => h("div", { class: "row-between", style: "gap:12px;align-items:flex-start" }, [h("span", { class: "muted nowrap" }, k), h("strong", { style: "text-align:right;overflow-wrap:anywhere;min-width:0" }, String(v))])));
  const draw = async () => {
    if (!isBackendOnline()) { body.replaceChildren(Card(EmptyState({ icon: "plug", title: "Backend not connected", description: "Sign in against the backend to see what this deployment is connected to." }))); return; }
    body.replaceChildren(LoadingState("Checking platform status…"));
    try {
      const [s, ai] = await Promise.all([api.systemStatus(), api.aiStatus().catch(() => null)]);
      const aiState = !s.ai.enabled ? Badge("Mock provider", "", "info") : s.ai.configured ? Badge("Connected", "success", "check") : Badge("Not configured", "danger", "alert");
      body.replaceChildren(
        h("div", { class: "grid grid-auto", "data-system-status": s.profile }, [
          h("div", { class: "card card-pad stack-sm" }, [h("div", { class: "row-between" }, [h("span", { class: "icon-tile" }, ico("layers", 20)), s.database.connected ? Badge("Connected", "success", "check") : Badge("Unavailable", "danger", "alert")]), h("h3", {}, "Database"), kv([["Engine", `${s.database.product} ${s.database.version || ""}`], ["Schema version", s.database.schemaVersion ? `V${s.database.schemaVersion} · ${s.database.lastMigration}` : "—"], ["Profile", s.profile]])]),
          h("div", { class: "card card-pad stack-sm" }, [h("div", { class: "row-between" }, [h("span", { class: "icon-tile" }, ico("video", 20)), Badge("Local files", "", null)]), h("h3", {}, "Video storage"), kv([["Kind", s.storage.kind], ["Root", s.storage.root], ["Videos stored", s.storage.videos]]), h("p", { class: "xs muted" }, "Streams are served by the backend with a permission check; the root folder is set with FILE_STORAGE_PATH.")]),
          h("div", { class: "card card-pad stack-sm" }, [h("div", { class: "row-between" }, [h("span", { class: "icon-tile teal" }, ico("sparkles", 20)), aiState]), h("h3", {}, "AI provider"), kv([["Provider", s.ai.provider], ["Model", s.ai.model || (s.ai.mock ? "deterministic mock" : "—")], ["Used by", "Course Builder, Quiz Generator, Learning Coach"], ai && ["Limits", `${ai.maxQuestions ?? "—"} questions · ${ai.maxInputChars ?? "—"} chars`]]), h("p", { class: "xs muted" }, "Set AI_ENABLED, AI_PROVIDER, AI_MODEL and AI_API_KEY in the backend environment. Keys never leave the server.")]),
          h("div", { class: "card card-pad stack-sm" }, [h("div", { class: "row-between" }, [h("span", { class: "icon-tile" }, ico("shield", 20)), Badge("JWT + BCrypt", "", null)]), h("h3", {}, "Access"), kv([["Allowed origins", s.cors], ["People", s.counts.users], ["Courses", s.counts.courses], ["Notifications sent", s.counts.notifications]]), h("p", { class: "xs muted" }, "Single sign-on, HRIS sync and messaging connectors are not part of this release; accounts are managed under People.")]),
        ]),
      );
    } catch (err) { body.replaceChildren(ErrorState({ title: "Status unavailable", description: err.message, onRetry: draw })); }
  };
  draw();
  return { title: "Integrations", crumbs: [{ label: "Integrations" }], el: h("div", { class: "stack-lg" }, [PageHeader({ title: "Integrations", sub: "What this deployment is connected to." }), body]) };
}

export function SettingsPage() {
  const s = settings();
  const name = Input({ value: s.orgName }), email = Input({ type: "email", value: s.supportEmail });
  const expiry = Select({ options: ["0", "6", "12", "24"].map((v) => ({ value: v, label: v === "0" ? "Never expires" : `${v} months` })), value: String(s.certExpiryDefault) });
  const maxMB = Input({ type: "number", min: "10", max: "5000", value: s.maxVideoMB || 200 });
  const saved = h("span", { class: "save-indicator saved", hidden: true }, "Saved");
  const el = h("div", { class: "stack-lg", style: "max-width:760px" }, [
    PageHeader({ title: "Settings", sub: "Organisation preferences and platform behaviour." }),
    Card(h("form", { class: "stack", onsubmit: (e) => { e.preventDefault(); updateSettings({ orgName: name.value.trim() || s.orgName, supportEmail: email.value.trim(), certExpiryDefault: +expiry.value, maxVideoMB: Math.max(10, +maxMB.value || 200) }); saved.hidden = false; toast("Settings saved"); } }, [
      h("h3", {}, "Organisation"), Field({ label: "Organisation name", control: name }), Field({ label: "Support email", control: email }),
      Field({ label: "Default certificate validity", hint: "Used for new courses.", control: expiry }),
      Field({ label: "Maximum video upload size (MB)", hint: "Applies to Upload Video in the Course Builder.", control: maxMB }),
      h("div", { class: "row" }, [Button({ label: "Save changes", variant: "primary", attrs: { type: "submit" } }), saved]),
    ])),
    Card(h("div", { class: "stack" }, [
      h("h3", {}, "Platform"),
      h("label", { class: "row-between" }, [h("span", {}, [h("strong", { class: "small" }, "In-product guides"), h("span", { class: "hint", style: "display:block" }, "Show “Guide me” across the platform.")]), Switch({ checked: s.guidesEnabled, label: "In-product guides", onChange: (v) => updateSettings({ guidesEnabled: v }) })]),
      h("label", { class: "row-between" }, [h("span", {}, [h("strong", { class: "small" }, "Instructors can publish"), h("span", { class: "hint", style: "display:block" }, "Off: instructors submit courses for admin review before they go live.")]), Switch({ checked: s.instructorPublish !== false, label: "Instructors can publish", onChange: (v) => updateSettings({ instructorPublish: v }) })]),
      h("label", { class: "row-between" }, [h("span", {}, [h("strong", { class: "small" }, "Community"), h("span", { class: "hint", style: "display:block" }, "Let learners discuss courses and lessons.")]), Switch({ checked: s.communityEnabled, label: "Community", onChange: (v) => updateSettings({ communityEnabled: v }) })]),
    ])),
    Card(h("div", { class: "stack-sm" }, [h("h3", {}, "Local demo data"), h("p", { class: "small muted" }, "Clears this browser's cached data and signs you out. Data saved on the server is not affected."), Button({ label: "Reset local data", icon: "refresh", variant: "danger", cls: "align-self-start", onClick: async () => { if (await confirmDialog({ title: "Reset this browser's data?", message: "Cached courses, progress and settings in this browser are cleared; the server keeps everything.", confirmLabel: "Reset", danger: true })) { guideEngine.close(); resetAll(); logout(); location.hash = "#/login"; location.reload(); } } })])),
  ]);
  return { title: "Settings", crumbs: [{ label: "Settings" }], el };
}
