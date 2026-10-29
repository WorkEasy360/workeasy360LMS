// Forgot-password (request a reset link) and reset (set a new password from a link). Both are public pages in the
// sign-in style. Self-service needs the server to have e-mail configured; without it the page points at the
// administrator, who can hand over a reset link from People.
import { h, mount } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Field, Input } from "../components/Form.js";
import { api } from "../services/api.js";
import { registerSession } from "../lib/store.js";
import { navigate } from "../router.js";
import { ProductLogo } from "../components/Brand.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const strong = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

const page = (root, heading, sub, body) => mount(root, h("div", { class: "login login-auth" }, [
  h("div", { class: "login-inner" }, [
    h("div", { class: "login-brand" }, ProductLogo({ tone: "dark", size: "lg" })),
    h("h1", { class: "center", id: "page-title", tabindex: "-1" }, heading),
    h("p", { class: "muted center", style: "margin:10px auto 24px;max-width:520px" }, sub),
    body,
  ]),
]));

export function ForgotPage(root) {
  const email = Input({ type: "email", autocomplete: "username", placeholder: "name@company.com", required: true, "data-forgot-email": "" });
  const error = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true, "data-forgot-error": "" });
  const submit = Button({ label: "Send reset link", variant: "primary", attrs: { type: "submit", "data-forgot-submit": "" } });
  const form = h("form", { class: "card card-pad stack", style: "max-width:440px;margin:0 auto;text-align:left", "aria-label": "Reset your password", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); error.hidden = true;
    const m = email.value.trim();
    if (!EMAIL.test(m)) { error.textContent = "Enter the e-mail address you sign in with."; error.hidden = false; return; }
    submit.disabled = true;
    try {
      const r = await api.forgotPassword(m);
      form.replaceChildren(h("div", { class: "stack-sm center", role: "status", "data-forgot-done": r.sent ? "sent" : "no-mail", style: "padding:8px 0" }, [
        h("span", { class: "icon-tile", style: "margin:0 auto" }, ico(r.sent ? "check-circle" : "info", 22)),
        h("h2", { style: "font-size:18px" }, r.sent ? "Check your e-mail" : "Ask your administrator"),
        h("p", { class: "small muted" }, r.sent
          ? `If an account exists for ${m}, a reset link is on its way. It works for 60 minutes.`
          : "This server doesn't send e-mail yet. An administrator can hand you a password-reset link from the People page."),
        h("a", { href: "#/login" }, "Back to sign in"),
      ]));
    } catch (err) {
      error.textContent = err.status === 429 ? err.message : err.status === 0 ? "Can't reach the server right now. Please try again in a moment." : err.message || "Could not request a reset.";
      error.hidden = false; submit.disabled = false;
    }
  } }, [
    h("h2", { style: "font-size:18px" }, "Forgot your password?"),
    h("p", { class: "small muted" }, "Enter your e-mail address and we'll send you a link to set a new one."),
    Field({ label: "E-mail", control: email }), error, submit,
    h("p", { class: "small muted center", style: "margin:4px 0 0" }, [h("a", { href: "#/login" }, "Back to sign in")]),
  ]);
  page(root, "Reset your password", "We'll get you back into your account.", form);
}

export function ResetPage(root, token) {
  const password = Input({ type: "password", placeholder: "At least 8 characters, letters and numbers", autocomplete: "new-password", required: true, "data-reset-password": "" });
  const confirm = Input({ type: "password", placeholder: "Repeat your new password", autocomplete: "new-password", required: true, "data-reset-confirm": "" });
  const error = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true, "data-reset-error": "" });
  const submit = Button({ label: "Set new password", variant: "primary", attrs: { type: "submit", "data-reset-submit": "" } });
  const fail = (msg) => { error.textContent = msg; error.hidden = false; };
  const form = h("form", { class: "card card-pad stack", style: "max-width:440px;margin:0 auto;text-align:left", "aria-label": "Choose a new password", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); error.hidden = true;
    if (!strong(password.value)) return fail("Use a password of at least 8 characters with at least one letter and one number.");
    if (password.value !== confirm.value) return fail("The two passwords don't match.");
    submit.disabled = true;
    try {
      const res = await api.resetPassword(token, password.value);
      registerSession(res.token, res.user); // the new password works: signed in straight away
      password.value = confirm.value = "";
      navigate("/");
    } catch (err) {
      fail(err.status === 0 ? "Can't reach the server right now. Please try again in a moment." : err.message || "Could not set the new password.");
      if (err.status === 400) form.append(h("p", { class: "small center", style: "margin-top:8px" }, h("a", { href: "#/forgot" }, "Request a new reset link")));
    } finally { submit.disabled = false; }
  } }, [
    h("h2", { style: "font-size:18px" }, "Choose a new password"),
    Field({ label: "New password", hint: "At least 8 characters with a letter and a number.", control: password }),
    Field({ label: "Confirm new password", control: confirm }),
    error, submit,
  ]);
  page(root, "Choose a new password", "The reset link signs you in once your new password is set.", form);
}
