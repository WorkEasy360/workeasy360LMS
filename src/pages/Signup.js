// Public self-registration: always a LEARNER account (the server ignores any role a client might send).
import { h, mount } from "../lib/dom.js";
import { ProductLogo } from "../components/Brand.js";
import { Button } from "../components/Button.js";
import { Field, Input } from "../components/Form.js";
import { api } from "../services/api.js";
import { registerSession } from "../lib/store.js";
import { navigate } from "../router.js";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const strong = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

export function SignupPage(root) {
  const name = Input({ placeholder: "Your full name", autocomplete: "name", required: true, "data-signup-name": "" });
  const email = Input({ type: "email", placeholder: "name@company.com", autocomplete: "username", required: true, "data-signup-email": "" });
  const password = Input({ type: "password", placeholder: "At least 8 characters, letters and numbers", autocomplete: "new-password", required: true, "data-signup-password": "" });
  const confirm = Input({ type: "password", placeholder: "Repeat your password", autocomplete: "new-password", required: true, "data-signup-confirm": "" });
  const error = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true, "data-signup-error": "" });
  const submit = Button({ label: "Create Account", variant: "primary", attrs: { type: "submit", "data-signup-submit": "" } });
  const fail = (msg) => { error.textContent = msg; error.hidden = false; };
  const form = h("form", { class: "card card-pad stack", style: "max-width:440px;margin:0 auto;text-align:left", "aria-label": "Create your account", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); error.hidden = true;
    const n = name.value.trim(), m = email.value.trim(), p = password.value, c = confirm.value;
    if (n.length < 2) return fail("Enter your full name.");
    if (!EMAIL.test(m)) return fail("Enter a valid e-mail address.");
    if (!strong(p)) return fail("Use a password of at least 8 characters with at least one letter and one number.");
    if (p !== c) return fail("The two passwords don't match.");
    submit.disabled = true;
    try {
      const res = await api.register(n, m, p);
      registerSession(res.token, res.user); // signed in as the new learner
      password.value = confirm.value = "";
      navigate("/");
    } catch (err) {
      fail(err.status === 409 ? "An account with that e-mail already exists. Sign in instead." : err.status === 0 ? "Can't reach the server right now. Please try again in a moment." : err.message || "Could not create your account.");
    } finally { submit.disabled = false; }
  } }, [
    h("h2", { style: "font-size:18px" }, "Create your account"),
    h("p", { class: "small muted" }, "Learn at your own pace: free courses are open right away, paid courses unlock after purchase."),
    Field({ label: "Full name", control: name }), Field({ label: "E-mail", control: email }),
    Field({ label: "Password", hint: "At least 8 characters with a letter and a number.", control: password }), Field({ label: "Confirm password", control: confirm }),
    error, submit,
    h("p", { class: "small muted center", style: "margin:4px 0 0" }, ["Already have an account? ", h("a", { href: "#/login", "data-signup-signin": "" }, "Sign In")]),
  ]);
  mount(root, h("div", { class: "login login-auth" }, [
    h("div", { class: "login-inner" }, [
      h("div", { class: "login-brand" }, ProductLogo({ tone: "dark", size: "lg" })),
      h("h1", { class: "center", id: "page-title", tabindex: "-1" }, "Start learning today"),
      h("p", { class: "muted center", style: "margin:10px auto 24px;max-width:520px" }, "Create a free learner account to explore the catalogue."),
      form,
    ]),
  ]));
}
