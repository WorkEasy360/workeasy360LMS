// Sign-in: e-mail + password against the backend, plus one-click demo workspaces (seeded demo accounts).
import { h, mount } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { ProductLogo } from "../components/Brand.js";
import { Avatar } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { Field, Input } from "../components/Form.js";
import { login, DEMO_USER_BY_ROLE, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, DEMO_ENABLED, loginReal } from "../lib/store.js";
import { userById } from "../services/people.js";
import { navigate } from "../router.js";

const ROLES = [
  { role: "learner", icon: "cap", title: "Learner", desc: "Continue courses, build skills, join the community.", perks: ["Personal dashboard", "Learning journeys", "Certificates"] },
  { role: "instructor", icon: "layers", title: "Instructor", desc: "Create courses and assessments, coach learners.", perks: ["Visual course builder", "Guided creation", "Learner insights"] },
  { role: "admin", icon: "settings", title: "Administrator", desc: "See the whole picture: people, skills, compliance.", perks: ["Org analytics", "Certifications", "Automation"] },
];

export function LoginPage(root) {
  const cards = ROLES.map((r) => {
    const user = userById(DEMO_USER_BY_ROLE[r.role]);
    const go = async () => {
      // Real backend login when it's reachable (same seeded user id both sides); falls back to the local-only
      // demo session if the backend isn't running, so the app never gets stuck on this screen.
      try { await loginReal(DEMO_EMAIL_BY_ROLE[r.role], DEMO_PASSWORD); }
      catch (err) { console.warn("[login] backend unavailable, continuing in local-only demo mode:", err.message); login(user.id); }
      navigate("/");
    };
    return h("button", { class: "card card-hover role-card", type: "button", onclick: go, "data-role": r.role }, [
      h("div", { class: "row" }, [h("span", { class: "icon-tile" }, ico(r.icon, 22)), h("div", { style: "text-align:left" }, [h("h3", {}, r.title), h("div", { class: "xs muted" }, `Sign in as ${user.name}`)]), h("span", { class: "grow" }), Avatar(user)]),
      h("p", { class: "muted small", style: "text-align:left;margin:12px 0" }, r.desc),
      h("ul", { class: "stack-sm small", style: "text-align:left" }, r.perks.map((p) => h("li", { class: "row-sm" }, [ico("check", 16), p]))),
      h("div", { class: "row-sm strong small", style: "margin-top:16px;color:var(--c-primary-ink)" }, ["Continue", ico("arrow-right", 16)]),
    ]);
  });

  // Account sign-in (people created under Admin → People, or any non-demo deployment).
  const email = Input({ type: "email", autocomplete: "username", placeholder: "name@company.com", required: true, "data-login-email": "" });
  const password = Input({ type: "password", autocomplete: "current-password", placeholder: "Password", required: true, "data-login-password": "" });
  const error = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true, "data-login-error": "" });
  const submit = Button({ label: "Sign in", variant: "primary", attrs: { type: "submit", "data-login-submit": "" } });
  const form = h("form", { class: "card card-pad stack", style: "max-width:420px;margin:0 auto 32px;text-align:left", "aria-label": "Sign in", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim()) || !password.value) { error.textContent = "Enter your e-mail address and password."; error.hidden = false; return; }
    submit.disabled = true;
    try { await loginReal(email.value.trim(), password.value); password.value = ""; navigate("/"); }
    catch (err) { error.textContent = err.status === 401 ? "That e-mail and password don't match an active account." : err.message || "Sign-in is unavailable right now."; error.hidden = false; }
    finally { submit.disabled = false; }
  } }, [
    h("h2", { style: "font-size:18px" }, "Sign in"),
    Field({ label: "E-mail", control: email }), Field({ label: "Password", control: password }), error, submit,
    h("p", { class: "small muted center", style: "margin:4px 0 0" }, [h("a", { href: "#/forgot", "data-login-forgot": "" }, "Forgot password?"), " · Don't have an account? ", h("a", { href: "#/signup", "data-login-signup": "" }, "Create Account")]),
    h("p", { class: "small muted center", style: "margin:2px 0 0" }, ["New company? ", h("a", { href: "#/signup-org", "data-login-org-signup": "" }, "Start your organisation")]),
  ]);

  mount(root, h("div", { class: "login login-auth" }, [
    h("div", { class: "login-inner" }, [
      h("div", { class: "login-brand" }, ProductLogo({ tone: "dark", size: "lg" })),
      h("h1", { class: "center", id: "page-title", tabindex: "-1" }, "What should you do next?"),
      h("p", { class: "muted center", style: "margin:10px auto 24px;max-width:520px" }, DEMO_ENABLED ? "A learning platform that guides you. Sign in with your account, or explore a demo workspace." : "A learning platform that guides you. Sign in with your account."),
      form,
      // Demo workspaces only where demo mode is on (local development, tests) — never on a production deployment.
      DEMO_ENABLED && h("p", { class: "eyebrow center", style: "margin-bottom:12px" }, "Demo workspaces"),
      DEMO_ENABLED && h("div", { class: "grid grid-3 login-grid", "data-demo-workspaces": "" }, cards),
      DEMO_ENABLED && h("p", { class: "xs muted center", style: "margin-top:24px" }, "Demo workspaces use the seeded demo accounts; they are unavailable where demo data is not installed."),
    ]),
  ]));
}
