// WorkEasy360 Platform Owner console: every customer organization, the commercial plan catalogue and the audit log.
// PLATFORM role only — customer administrators never see these pages (the backend refuses them anyway).
import { h, timeAgo, fmtDate } from "../lib/dom.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card, StatCard, SectionTitle } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { EmptyState, LoadingState, ErrorState } from "../components/States.js";
import { Field, Input, Select, SearchInput } from "../components/Form.js";
import { openModal, toast, confirmDialog } from "../components/Overlay.js";
import { api } from "../services/api.js";

const money = (cents, currency) => cents === 0 ? "Free" : `${currency === "INR" ? "₹" : currency + " "}${(cents / 100).toLocaleString()}`;
const subBadge = (s) => !s ? Badge("No subscription", "warning") :
  s === "ACTIVE" ? Badge("Active", "success") : s === "TRIAL" ? Badge("Trial", "info") :
  s === "PAST_DUE" ? Badge("Past due", "warning") : Badge(s[0] + s.slice(1).toLowerCase(), "danger");

export function PlatformOrgsPage() {
  let q = "";
  const stats = h("div", { class: "grid grid-auto" });
  const body = h("div");

  async function draw() {
    body.replaceChildren(LoadingState("Loading organizations…"));
    try {
      const [s, rows] = await Promise.all([api.platformStats(), api.platformOrgs(q)]);
      stats.replaceChildren(
        StatCard({ label: "Organizations", value: s.organizations, icon: "home" }),
        StatCard({ label: "Active", value: s.organizationsActive, icon: "check-circle", tone: "success" }),
        StatCard({ label: "Suspended", value: s.organizationsSuspended, icon: "alert", tone: s.organizationsSuspended ? "warning" : "" }),
        StatCard({ label: "Trials", value: s.subscriptionsTrial, icon: "clock" }),
        StatCard({ label: "Paid subscriptions", value: s.subscriptionsActive, icon: "award", tone: "success" }),
        StatCard({ label: "Learners", value: s.learners, icon: "users" }),
        StatCard({ label: "Courses", value: s.courses, icon: "layers" }),
      );
      body.replaceChildren(rows.length
        ? h("div", { class: "card table-wrap" }, h("table", { class: "table" }, [
          h("thead", {}, h("tr", {}, ["Organization", "Plan", "Subscription", "People", "Courses", "Created", "Status", ""].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows.map((o) => h("tr", { "data-platform-org": o.slug }, [
            h("td", {}, h("div", {}, [h("div", { class: "strong" }, o.name), h("div", { class: "xs muted" }, o.slug)])),
            h("td", { class: "small" }, o.planName || "—"),
            h("td", {}, [subBadge(o.subscriptionStatus), o.trialEndsAt && h("div", { class: "xs muted" }, `Trial ends ${fmtDate(new Date(o.trialEndsAt).getTime())}`), o.renewsAt && h("div", { class: "xs muted" }, `Renews ${fmtDate(new Date(o.renewsAt).getTime())}`)]),
            h("td", {}, String(o.people)), h("td", {}, String(o.coursesCount)),
            h("td", { class: "small muted" }, timeAgo(new Date(o.createdAt).getTime())),
            h("td", {}, o.status === "SUSPENDED" ? Badge("Suspended", "danger") : Badge("Active", "success")),
            h("td", {}, Button({
              label: o.status === "SUSPENDED" ? "Reactivate" : "Suspend", size: "sm",
              variant: o.status === "SUSPENDED" ? "primary" : "ghost",
              attrs: { "data-platform-org-toggle": o.slug },
              onClick: async () => {
                const suspending = o.status !== "SUSPENDED";
                const ok = await confirmDialog({
                  title: `${suspending ? "Suspend" : "Reactivate"} ${o.name}?`,
                  message: suspending
                    ? "Nobody in this organisation will be able to sign in until it is reactivated. Their data is kept."
                    : "People in this organisation will be able to sign in again.",
                  confirmLabel: suspending ? "Suspend organisation" : "Reactivate", danger: suspending,
                });
                if (!ok) return;
                try { await api.platformOrgStatus(o.id, suspending ? "SUSPENDED" : "ACTIVE"); toast(`${o.name} ${suspending ? "suspended" : "reactivated"}`); draw(); }
                catch (ex) { toast(ex.message || "Could not update the organisation", { type: "error" }); }
              },
            })),
          ]))),
        ]))
        : Card(EmptyState({ icon: "home", title: "No customer organizations yet", description: "Organizations appear here as companies register or purchase WorkEasyLMS." })));
    } catch (err) {
      body.replaceChildren(ErrorState({ description: err.message || "Could not load the platform overview.", onRetry: draw }));
    }
  }
  draw();

  return { title: "Organizations", crumbs: [{ label: "Platform" }, { label: "Organizations" }], el: h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Customer organizations", sub: "Every company running WorkEasyLMS — their plan, subscription and account standing." }),
    stats,
    h("div", { style: "width:min(320px,100%)" }, SearchInput({ placeholder: "Search organizations", onInput: (v) => { q = v; draw(); } })),
    body,
  ]) };
}

export function PlatformPlansPage() {
  const body = h("div");

  const edit = (p = {}) => {
    const name = Input({ value: p.name || "", placeholder: "Plan name" });
    const desc = Input({ value: p.description || "", placeholder: "One-line description" });
    const price = Input({ type: "number", value: p.priceCents != null ? String(p.priceCents / 100) : "", placeholder: "0" });
    const currency = Select({ options: ["INR", "USD", "EUR", "GBP"].map((v) => ({ value: v, label: v })), value: p.currency || "INR" });
    const period = Select({ options: [{ value: "MONTHLY", label: "Monthly" }, { value: "ANNUAL", label: "Annual" }], value: p.billingPeriod || "MONTHLY" });
    const maxUsers = Input({ type: "number", value: p.maxUsers ?? "", placeholder: "Unlimited" });
    const maxCourses = Input({ type: "number", value: p.maxCourses ?? "", placeholder: "Unlimited" });
    const trial = Input({ type: "number", value: p.trialDays ?? 14 });
    const status = Select({ options: [{ value: "ACTIVE", label: "Active (purchasable)" }, { value: "RETIRED", label: "Retired" }], value: p.status || "ACTIVE" });
    const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true });
    openModal({ title: p.id ? `Edit ${p.name}` : "New plan", size: "sm",
      content: h("div", { class: "stack" }, [
        Field({ label: "Name", control: name }), Field({ label: "Description", control: desc }),
        h("div", { class: "row" }, [h("div", { class: "grow" }, Field({ label: "Price (major units)", control: price })), h("div", {}, Field({ label: "Currency", control: currency })), h("div", {}, Field({ label: "Billing", control: period }))]),
        h("div", { class: "row" }, [h("div", { class: "grow" }, Field({ label: "Max people (0 = unlimited)", control: maxUsers })), h("div", { class: "grow" }, Field({ label: "Max courses (0 = unlimited)", control: maxCourses })), h("div", { class: "grow" }, Field({ label: "Trial days", control: trial }))]),
        Field({ label: "Status", control: status }), err]),
      footer: (close) => [Button({ label: "Cancel", onClick: close }), Button({ label: "Save plan", variant: "primary", onClick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api.platformUpsertPlan({ id: p.id || null, name: name.value.trim(), description: desc.value.trim(),
            priceCents: Math.round(Number(price.value || 0) * 100), currency: currency.value, billingPeriod: period.value,
            maxUsers: Number(maxUsers.value || 0), maxCourses: Number(maxCourses.value || 0), trialDays: Number(trial.value || 14), status: status.value });
          close(); toast("Plan saved"); draw();
        } catch (ex) { err.textContent = ex.message || "Could not save the plan."; err.hidden = false; e.currentTarget.disabled = false; }
      } })] });
  };

  async function draw() {
    body.replaceChildren(LoadingState("Loading plans…"));
    try {
      const rows = (await api.platformPlans()).sort((a, b) => (a.position || 0) - (b.position || 0));
      body.replaceChildren(h("div", { class: "card table-wrap" }, h("table", { class: "table" }, [
        h("thead", {}, h("tr", {}, ["Plan", "Price", "Billing", "People", "Courses", "Trial", "Status", ""].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map((p) => h("tr", { "data-platform-plan": p.id }, [
          h("td", {}, h("div", {}, [h("div", { class: "strong" }, p.name), h("div", { class: "xs muted" }, p.description || "")])),
          h("td", {}, money(p.priceCents, p.currency)), h("td", { class: "small" }, p.billingPeriod === "ANNUAL" ? "Annual" : "Monthly"),
          h("td", {}, p.maxUsers == null ? "Unlimited" : String(p.maxUsers)), h("td", {}, p.maxCourses == null ? "Unlimited" : String(p.maxCourses)),
          h("td", { class: "small" }, `${p.trialDays} days`),
          h("td", {}, p.status === "ACTIVE" ? Badge("Active", "success") : Badge("Retired", "")),
          h("td", {}, Button({ label: "Edit", icon: "edit", size: "sm", variant: "ghost", onClick: () => edit(p) })),
        ]))),
      ])));
    } catch (err) { body.replaceChildren(ErrorState({ description: err.message || "Could not load plans.", onRetry: draw })); }
  }
  draw();

  return { title: "Plans", crumbs: [{ label: "Platform" }, { label: "Plans" }], el: h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Plan catalogue", sub: "What companies can buy. The public site and sign-up read these live — nothing is hardcoded.", actions: [Button({ label: "New plan", icon: "plus", variant: "primary", onClick: () => edit() })] }),
    body,
  ]) };
}

export function PlatformAuditPage() {
  const body = h("div");
  async function draw() {
    body.replaceChildren(LoadingState("Loading audit log…"));
    try {
      const rows = await api.platformAudit();
      body.replaceChildren(rows.length
        ? h("div", { class: "card table-wrap" }, h("table", { class: "table" }, [
          h("thead", {}, h("tr", {}, ["When", "Action", "Organization", "Actor", "Detail", "Outcome"].map((t) => h("th", {}, t)))),
          h("tbody", {}, rows.map((e) => h("tr", {}, [
            h("td", { class: "small muted", style: "white-space:nowrap" }, timeAgo(new Date(e.at).getTime())),
            h("td", { class: "small strong" }, e.action),
            h("td", { class: "small" }, e.orgId || "—"),
            h("td", { class: "small" }, e.actorId || "system"),
            h("td", { class: "small", style: "max-width:380px;overflow-wrap:anywhere" }, e.detail || ""),
            h("td", {}, e.outcome === "OK" ? Badge("OK", "success") : Badge(e.outcome, "danger")),
          ]))),
        ]))
        : Card(EmptyState({ icon: "shield", title: "No audit events yet", description: "Sensitive administrative actions are recorded here." })));
    } catch (err) { body.replaceChildren(ErrorState({ description: err.message || "Could not load the audit log.", onRetry: draw })); }
  }
  draw();
  return { title: "Audit log", crumbs: [{ label: "Platform" }, { label: "Audit log" }], el: h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Audit log", sub: "Who did what, where, when — across the whole platform. Secrets are never recorded." }),
    body,
  ]) };
}
