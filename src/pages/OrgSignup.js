// Self-serve company registration: pick a plan, register the organisation, get the administrator's one-time
// password-reset link (e-mailed when the server sends mail, shown once otherwise). Fully automated — no
// WorkEasy360 staff involved. Plans come live from the backend catalogue; nothing is hardcoded.
import { h, mount } from "../lib/dom.js";
import { ProductLogo } from "../components/Brand.js";
import { Button } from "../components/Button.js";
import { Field, Input } from "../components/Form.js";
import { api } from "../services/api.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const money = (cents, currency) => cents === 0 ? "Free trial" : `${currency === "INR" ? "₹" : currency + " "}${(cents / 100).toLocaleString()}`;

export function OrgSignupPage(root) {
  let planId = null;
  const plansHost = h("div", { class: "grid grid-3", style: "gap:12px" });
  const company = Input({ placeholder: "Your company name", required: true, "data-orgsignup-company": "" });
  const adminName = Input({ placeholder: "Your full name", autocomplete: "name", required: true, "data-orgsignup-name": "" });
  const adminEmail = Input({ type: "email", placeholder: "you@yourcompany.com", autocomplete: "username", required: true, "data-orgsignup-email": "" });
  const error = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true, "data-orgsignup-error": "" });
  const submit = Button({ label: "Create my organisation", variant: "primary", attrs: { type: "submit", "data-orgsignup-submit": "" } });
  const fail = (msg) => { error.textContent = msg; error.hidden = false; };

  function drawPlans(plans) {
    if (!planId && plans.length) planId = plans[0].id;
    plansHost.replaceChildren(...plans.map((p) => h("button", {
      type: "button", class: "card card-pad-sm", "data-orgsignup-plan": p.id,
      style: `text-align:left;cursor:pointer;border:2px solid ${p.id === planId ? "var(--c-primary)" : "transparent"}`,
      "aria-pressed": String(p.id === planId),
      onclick: () => { planId = p.id; drawPlans(plans); },
    }, [
      h("div", { class: "strong" }, p.name),
      h("div", { class: "xs muted", style: "margin:4px 0" }, p.description || ""),
      h("div", { class: "small strong" }, [money(p.priceCents, p.currency), p.priceCents > 0 && h("span", { class: "xs muted" }, p.billingPeriod === "ANNUAL" ? " / year" : " / month")]),
      h("div", { class: "xs muted", style: "margin-top:4px" },
        `${p.maxUsers == null ? "Unlimited" : "Up to " + p.maxUsers} people · ${p.maxCourses == null ? "unlimited" : "up to " + p.maxCourses} courses · ${p.trialDays}-day free trial`),
    ])));
  }
  api.publicPlans().then(drawPlans).catch(() => plansHost.replaceChildren(h("p", { class: "small muted" }, "Plans are unavailable right now — your organisation starts on the standard trial.")));

  function success(res) {
    mount(root, h("div", { class: "login login-auth" }, h("div", { class: "login-inner" }, [
      h("div", { class: "login-brand" }, ProductLogo({ tone: "dark", size: "lg" })),
      h("h1", { class: "center", id: "page-title", tabindex: "-1" }, `${res.organization} is ready`),
      h("div", { class: "card card-pad stack", style: "max-width:520px;margin:16px auto 0;text-align:left", "data-orgsignup-done": "" }, [
        h("p", { class: "small" }, [h("strong", {}, "Your workspace has been created"), ` on the ${res.status === "TRIAL" ? "free trial" : "selected plan"}. The administrator account is `, h("strong", {}, res.adminEmail), "."]),
        res.resetPath
          ? h("div", { class: "stack-sm" }, [
              h("p", { class: "small" }, "Set your administrator password with this one-time link (it works once, for 60 minutes):"),
              h("a", { class: "btn btn-primary", href: res.resetPath, "data-orgsignup-reset": "" }, "Set my password & sign in"),
            ])
          : h("p", { class: "small" }, "We've e-mailed you a one-time link to set your password. Open it to sign in."),
        h("p", { class: "xs muted" }, "First steps after signing in: set your organisation name and certificate logo under Settings, then add instructors and learners under People."),
      ]),
    ])));
  }

  const form = h("form", { class: "card card-pad stack", style: "max-width:560px;margin:0 auto;text-align:left", "aria-label": "Register your organisation", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); error.hidden = true;
    const c = company.value.trim(), n = adminName.value.trim(), m = adminEmail.value.trim();
    if (c.length < 2) return fail("Enter your company name.");
    if (n.length < 2) return fail("Enter your full name.");
    if (!EMAIL.test(m)) return fail("Enter a valid e-mail address.");
    submit.disabled = true;
    try {
      success(await api.registerOrganization({ company: c, adminName: n, adminEmail: m, planId }));
    } catch (err) {
      fail(err.status === 409 ? "An account with that e-mail already exists. Sign in instead, or use a different address."
        : err.status === 429 ? "Too many sign-up attempts. Please try again later."
        : err.status === 0 ? "Can't reach the server right now. Please try again in a moment."
        : err.message || "Could not create your organisation.");
      submit.disabled = false;
    }
  } }, [
    h("h2", { style: "font-size:18px" }, "Choose a plan"),
    plansHost,
    h("h2", { style: "font-size:18px;margin-top:8px" }, "Your company & administrator"),
    Field({ label: "Company name", control: company }),
    h("div", { class: "row" }, [h("div", { class: "grow" }, Field({ label: "Your name", control: adminName })), h("div", { class: "grow" }, Field({ label: "Work e-mail", control: adminEmail }))]),
    h("p", { class: "xs muted" }, "No password is sent anywhere: you'll receive a one-time link to set it yourself."),
    error, submit,
    h("p", { class: "small muted center", style: "margin:4px 0 0" }, ["Already using WorkEasyLMS? ", h("a", { href: "#/login" }, "Sign In")]),
  ]);

  mount(root, h("div", { class: "login login-auth" }, [
    h("div", { class: "login-inner" }, [
      h("div", { class: "login-brand" }, ProductLogo({ tone: "dark", size: "lg" })),
      h("h1", { class: "center", id: "page-title", tabindex: "-1" }, "Bring WorkEasyLMS to your company"),
      h("p", { class: "muted center", style: "margin:10px auto 24px;max-width:560px" }, "Your own private learning workspace, provisioned instantly — courses, people, certificates, analytics and the AI coach, isolated to your organisation."),
      form,
    ]),
  ]));
}
