// Learner acquisition + course commerce: public sign-up, free access, paid-course locking, purchases (mock provider),
// My Learning. Run one at a time: index.html?as=learner&selftest=<suite>. Needs PAYMENTS_PROVIDER=mock + PAYMENTS_MOCK_ALLOWED=true.
import { loginReal, logout, getUser, load, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD } from "/src/lib/store.js";
import { bus } from "/src/lib/events.js";

export function registerCommerce({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const API = "http://localhost:8080/api";
  const token = () => localStorage.getItem("we360.v3.token");
  const raw = (path, opts = {}, tok = token()) => fetch(API + path, { ...opts, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json", ...(opts.headers || {}) } });
  const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
  const post = (path, body, tok) => raw(path, { method: "POST", body: JSON.stringify(body || {}) }, tok);
  const put = (path, body, tok) => raw(path, { method: "PUT", body: JSON.stringify(body || {}) }, tok);
  const get = (path, tok) => raw(path, {}, tok);
  const settled = async () => { let last = Date.now(); const off = bus.on("route", () => (last = Date.now())); await waitFor(() => Date.now() - last > 1500, 12000, "route quiet period"); off(); };
  const localCourse = (id) => load("courses").find((c) => c.id === id);

  /** Registers a brand-new learner through the public API and returns its credentials (no UI). */
  async function newLearner(tag = "learner") {
    const email = `${tag}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.com`, password = "Learn" + Math.random().toString(36).slice(2, 8) + "9";
    const r = await json(await post("/auth/register", { name: "Test " + tag, email, password }, null));
    ok(r.status === 200 && r.body?.user?.role === "LEARNER" && !!r.body?.token, `API sign-up creates a LEARNER (${email})`);
    return { email, password, id: r.body?.user?.id, token: r.body?.token };
  }
  /** Instructor builds and publishes a one-lesson course through the API; priceCents > 0 makes it paid. */
  async function publishedCourse(priceCents, title) {
    const it = (await json(await post("/auth/login", { email: DEMO_EMAIL_BY_ROLE.instructor, password: DEMO_PASSWORD }, null))).body.token;
    const c = (await json(await post("/courses", { title: title || `${priceCents ? "Paid" : "Free"} course ${Date.now().toString(36)}` }, it))).body;
    const m = (await json(await post(`/courses/${c.id}/modules`, { title: "Module 1" }, it))).body;
    const modId = m.modules[0].id;
    const t = (await json(await post(`/courses/${c.id}/modules/${modId}/lessons`, { title: "Lesson 1", type: "LESSON" }, it))).body;
    const lessonId = t.modules[0].lessons[0].id;
    await put(`/lessons/${lessonId}`, { content: [{ id: "b1", type: "text", text: "Secret paid-course content: the answer is 42." }], duration: 5 }, it);
    await put(`/courses/${c.id}`, { description: "Created by the commerce selftest.", priceCents: priceCents || 0, currency: "INR" }, it);
    const pub = await json(await post(`/courses/${c.id}/publish`, {}, it));
    const after = (await json(await get(`/courses/${c.id}`, it))).body;
    ok(pub.status === 200 && pub.body.status === "PUBLISHED" && after.priceCents === (priceCents || 0), `instructor published a ${priceCents ? "paid (₹" + priceCents / 100 + ")" : "free"} course ${c.id}`);
    return { courseId: c.id, lessonId, title: c.title };
  }
  const signInAs = async (l, courseId) => { await loginReal(l.email, l.password); await waitFor(() => (courseId ? localCourse(courseId) : load("courses").length > 3), 15000, "catalogue hydrated (" + courseId + ")"); await settled(); };

  // 1–7. Public sign-up (UI + API), validation, role safety, existing logins.
  suites.signup = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD); // let the `?as=` boot sign-in settle before signing out
    logout(); location.hash = "#/signup";
    await waitFor(() => !q("#auth-root").hidden && q("[data-signup-email]"), 5000, "sign-up form");
    ok(!!q("[data-signup-name]") && !!q("[data-signup-password]") && !!q("[data-signup-confirm]") && !q("[data-signup-role]"), "sign-up form has name, e-mail, password, confirm — and no role picker");
    const email = `student.${Date.now().toString(36)}@example.com`;
    const err = () => (q("[data-signup-error]") && !q("[data-signup-error]").hidden ? q("[data-signup-error]").textContent : "");
    type(q("[data-signup-name]"), "Sam Student"); type(q("[data-signup-email]"), "not-an-email"); type(q("[data-signup-password]"), "Learn1234"); type(q("[data-signup-confirm]"), "Learn1234");
    click(q("[data-signup-submit]")); await sleep(150);
    ok(/valid e-mail/i.test(err()), "invalid e-mail is rejected: " + err());
    type(q("[data-signup-email]"), email); type(q("[data-signup-password]"), "short"); type(q("[data-signup-confirm]"), "short");
    click(q("[data-signup-submit]")); await sleep(150);
    ok(/at least 8/i.test(err()), "weak password is rejected: " + err());
    type(q("[data-signup-password]"), "Learn1234"); type(q("[data-signup-confirm]"), "Learn1235");
    click(q("[data-signup-submit]")); await sleep(150);
    ok(/don't match/i.test(err()), "password mismatch is rejected: " + err());
    ok(!token() && !getUser(), "no session was created by the rejected attempts");
    type(q("[data-signup-confirm]"), "Learn1234");
    click(q("[data-signup-submit]"));
    await waitFor(() => getUser()?.email === email && !location.hash.startsWith("#/signup"), 10000, "signed in after sign-up");
    ok(getUser()?.email === email && getUser()?.role === "learner" && !!token(), "successful sign-up signs the new learner in");
    await waitFor(() => q("#main") && q("#main").textContent.trim().length > 40, 8000, "home");
    ok(!!q("#main") && !!q(".sidebar") && /My Learning/.test(q(".sidebar").textContent), "learner Home renders with the learner navigation");
    // Demo tooling must not exist for a real account: no "View as" role switcher, no demo reset — only Sign out.
    // (The post-signup hydration can re-render the topbar and close the dropdown: open it again if that happened.)
    q(".user-btn").click(); await sleep(300);
    if (!q(".menu")) { q(".user-btn")?.click(); await waitFor(() => q(".menu"), 4000, "account menu"); }
    const menuText = q(".menu")?.textContent || "";
    ok(!/View as/.test(menuText) && !/Reset demo data/.test(menuText) && /Sign out/.test(menuText), "a real account's menu offers Sign out only — no demo role switcher");
    document.body.click(); await sleep(100);
    ok(!q(".sidebar .nav-cta"), "a learner gets no Create Course button");
    const dup = await json(await post("/auth/register", { name: "Sam Again", email, password: "Learn1234" }, null));
    ok(dup.status === 409 && /already exists/i.test(dup.body?.message || ""), "duplicate e-mail is refused with 409 and a clear message");
    const evil = await json(await post("/auth/register", { name: "Evil", email: "evil." + Date.now().toString(36) + "@example.com", password: "Learn1234", role: "ADMIN" }, null));
    ok(evil.status === 200 && evil.body.user.role === "LEARNER", "a role sent by the public client is ignored: always LEARNER");
    ok(!JSON.stringify(evil.body).includes("Learn1234") && !("passwordHash" in (evil.body.user || {})), "registration response carries no password material");
    // UI duplicate: sign out and try the same e-mail on the form
    logout(); location.hash = "#/signup"; await waitFor(() => !q("#auth-root").hidden && q("[data-signup-email]") && !q("[data-signup-email]").value, 5000, "sign-up form again");
    type(q("[data-signup-name]"), "Sam Student"); type(q("[data-signup-email]"), email); type(q("[data-signup-password]"), "Learn1234"); type(q("[data-signup-confirm]"), "Learn1234");
    click(q("[data-signup-submit]")); await waitFor(() => err(), 6000, "duplicate error");
    ok(/already exists/i.test(err()), "form explains the duplicate e-mail");
    ok(!!q("[data-signup-signin]") && q("[data-signup-signin]").getAttribute("href") === "#/login", "sign-up page links to Sign In");
    // learner can sign in after sign-up; existing demo accounts still work
    const me = await loginReal(email, "Learn1234"); ok(me.role === "LEARNER" && getUser()?.id === me.id, "new learner signs in with their credentials");
    for (const r of ["admin", "instructor", "learner"]) { const u = await loginReal(DEMO_EMAIL_BY_ROLE[r], DEMO_PASSWORD); ok(u.role === r.toUpperCase(), `existing ${r} login still works`); }
    logout(); location.hash = "#/login"; await waitFor(() => !q("#auth-root").hidden && q("[data-login-signup]"), 5000, "login page");
    ok(q("[data-login-signup]")?.getAttribute("href") === "#/signup", "login page offers Create Account");
  };

  // 8. Free published course: accessible to a signed-in learner without payment, end to end.
  suites.freeCourseAccess = async () => {
    const { courseId, lessonId } = await publishedCourse(0);
    const learner = await newLearner("free");
    await signInAs(learner, courseId);
    const a = (await json(await get(`/courses/${courseId}/access`))).body;
    ok(a.free === true && a.canAccess === true && a.entitled === false, "access: free course is open before enrolment");
    navigate(`/explore/${courseId}`); await waitFor(() => T("course.start") && q('[data-course-access="free"]'), 8000, "course detail");
    ok(/FREE/.test(q("#main").textContent) && /Enrol & start/.test(T("course.start").textContent), "detail page shows FREE and 'Enrol & start'");
    click(T("course.start")); await waitFor(() => location.hash.includes(`/learn/${courseId}`) && q(".prose, .block-card, [data-guide-target='player.complete']"), 8000, "player");
    ok(/the answer is 42/.test(q("#main").textContent), "player shows the lesson content");
    const p = await json(await post(`/lessons/${lessonId}/progress`, { complete: true, percentage: 100 }));
    ok(p.status === 200 && p.body.courseCompleted === true && !!p.body.certificateId, "completing the lesson completes the course and issues a certificate");
    const e = ((await json(await get("/me/courses"))).body || []).find((x) => x.courseId === courseId);
    ok(!!e && e.source === "FREE", "enrolment recorded with source FREE");
  };

  // 9–10 + 18. Paid course stays locked until entitlement; the API enforces it; orders are private.
  suites.paidCourseLock = async () => {
    const { courseId, lessonId } = await publishedCourse(49900);
    const a1 = await newLearner("lockA"), a2 = await newLearner("lockB");
    await signInAs(a1, courseId);
    const a = (await json(await get(`/courses/${courseId}/access`))).body;
    ok(a.free === false && a.canAccess === false && a.entitled === false && a.canPurchase === true && a.priceCents === 49900, "access: paid course is locked and purchasable");
    const tree = (await json(await get(`/courses/${courseId}`))).body;
    ok(tree.locked === true && tree.modules[0].lessons[0].content.length === 0 && tree.modules[0].lessons[0].quiz == null && !JSON.stringify(tree).includes("answer is 42"), "course tree is redacted: titles only, no lesson content");
    ok((await get(`/lessons/${lessonId}`)).status === 402, "lesson endpoint refuses with 402 Payment Required");
    ok((await post(`/lessons/${lessonId}/progress`, { complete: true })).status === 402, "progress endpoint refuses with 402");
    ok((await post(`/courses/${courseId}/enroll`, {})).status === 402, "self-enrolment refuses with 402");
    ok((await post(`/lessons/${lessonId}/quiz-attempts`, { responses: {}, score: 100, passed: true })).status === 402, "quiz attempt refuses with 402");
    ok((await post(`/lessons/${lessonId}/submissions`, { body: "x" })).status === 402, "assignment submission refuses with 402");
    const trees = (await json(await get("/courses/trees"))).body.find((t) => t.id === courseId);
    ok(!!trees && trees.locked === true && !JSON.stringify(trees).includes("answer is 42"), "hydration payload is redacted too");
    navigate(`/explore/${courseId}`); await waitFor(() => q('[data-course-access="locked"]'), 8000, "locked detail");
    ok(/PAID · ₹499/.test(q("#main").textContent) && !!q("[data-course-buy]") && !!q("[data-course-locked-note]"), "detail page shows the price, Buy button and locked note");
    ok(!/answer is 42/.test(q("#main").textContent), "no lesson content leaks into the page");
    navigate(`/learn/${courseId}`); await waitFor(() => q("[data-player-locked]"), 6000, "locked player");
    ok(!!q("[data-player-locked]") && /locked/i.test(q("#main").textContent), "player shows the locked state instead of lessons");
    // IDOR: learner B cannot see or drive learner A's order
    const o = (await json(await post("/orders", { courseId }))).body;
    ok(o.order.status === "PENDING" && o.mode === "mock", "learner A opens a pending order");
    ok((await get(`/orders/${o.order.id}`, a2.token)).status === 403, "learner B cannot read learner A's order (403)");
    ok((await post(`/orders/${o.order.id}/mock-outcome`, { outcome: "success" }, a2.token)).status === 403, "learner B cannot complete learner A's order (403)");
    ok(((await json(await get("/orders", a2.token))).body || []).length === 0, "learner B's order list does not contain it");
    ok((await get("/orders?all=true", a2.token)).status === 403, "a learner cannot list all orders");
    ok((await get(`/courses/${courseId}/access`, a2.token)).status === 200 && (await json(await get(`/courses/${courseId}/access`, a2.token))).body.canAccess === false, "learner B is still locked out");
    await post(`/orders/${o.order.id}/cancel`, {});
  };

  // 11–14 + 17. Mock purchase success unlocks the course through the UI; appears in My Learning; no duplicate purchase.
  suites.purchaseFlow = async () => {
    const { courseId, lessonId } = await publishedCourse(129900);
    const learner = await newLearner("buyer");
    await signInAs(learner, courseId);
    navigate(`/explore/${courseId}`); await waitFor(() => q("[data-course-buy]"), 8000, "Buy button");
    click(q("[data-course-buy]"));
    await waitFor(() => location.hash.startsWith("#/checkout/") && q("[data-checkout-pay]"), 10000, "checkout page");
    ok(/₹1,299/.test(q("#main").textContent) && /Awaiting payment/.test(q("#main").textContent), "checkout shows the order summary awaiting payment");
    const orderId = location.hash.split("/")[2];
    click(q("[data-checkout-pay]"));
    await waitFor(() => q('[data-checkout="success"]') && q("[data-checkout-start]"), 12000, "success state");
    ok(/course unlocked/i.test(q("#main").textContent) && !!q("[data-checkout-start]"), "success state with Start Learning");
    const order = (await json(await get(`/orders/${orderId}`))).body;
    ok(order.status === "SUCCESS" && !!order.paidAt, "order is SUCCESS on the server");
    const a = (await json(await get(`/courses/${courseId}/access`))).body;
    ok(a.entitled === true && a.source === "PURCHASE" && a.canAccess === true && a.canPurchase === false, "entitlement granted with source PURCHASE");
    ok((await get(`/lessons/${lessonId}`)).status === 200, "lesson endpoint now returns the content");
    const pays = (await json(await get(`/orders/${orderId}/payments`))).body;
    ok(Array.isArray(pays) && pays.length === 1 && pays[0].status === "SUCCESS", "one SUCCESS payment recorded for the order");
    click(q("[data-checkout-start]"));
    await waitFor(() => location.hash.includes(`/learn/${courseId}`) && /answer is 42/.test(q("#main")?.textContent || ""), 10000, "player after purchase");
    ok(/answer is 42/.test(q("#main").textContent), "purchased course opens in the player with its content");
    navigate("/my-learning"); await waitFor(() => q("#main") && /Purchased/.test(q("#main").textContent), 6000, "My Learning");
    const tab = [...document.querySelectorAll('[role="tab"], .tab')].find((t) => /Purchased/.test(t.textContent));
    tab?.click(); await sleep(300);
    ok(!!tab && /Lesson 1|Paid course/.test(q("#main").textContent) && /Purchased/.test(q("#main").textContent), "purchased course appears under My Learning → Purchased");
    const dup = await json(await post("/orders", { courseId }));
    ok(dup.status === 409, "buying again is refused (409) while the entitlement exists");
    navigate(`/explore/${courseId}`); await waitFor(() => q('[data-course-access="unlocked"]'), 8000, "unlocked detail");
    ok(!q("[data-course-buy]") && /Purchased/.test(q("#main").textContent) && /Start learning|Continue learning/.test(T("course.start")?.textContent || ""), "detail page shows Purchased and Start learning instead of Buy");
  };

  // 15–17. Failed and cancelled payments never unlock; retry works; settled orders are immutable.
  suites.purchaseFailures = async () => {
    const { courseId, lessonId } = await publishedCourse(79900);
    const learner = await newLearner("retry");
    await signInAs(learner, courseId);
    navigate(`/explore/${courseId}`); await waitFor(() => q("[data-course-buy]"), 8000, "Buy button");
    click(q("[data-course-buy]")); await waitFor(() => q("[data-checkout-fail]"), 10000, "checkout");
    const first = location.hash.split("/")[2];
    click(q("[data-checkout-fail]")); await waitFor(() => q('[data-checkout="failed"]'), 10000, "failed state");
    ok(/Payment failed/.test(q("#main").textContent) && !!q("[data-checkout-retry]"), "failed payment shows a clear retry option");
    ok((await json(await get(`/courses/${courseId}/access`))).body.canAccess === false && (await get(`/lessons/${lessonId}`)).status === 402, "failed payment leaves the course locked");
    click(q("[data-checkout-retry]")); await waitFor(() => location.hash.startsWith("#/checkout/") && location.hash.split("/")[2] !== first && q("[data-checkout-cancel]"), 10000, "new order");
    const second = location.hash.split("/")[2];
    click(q("[data-checkout-cancel]")); await waitFor(() => q('[data-checkout="cancelled"]'), 10000, "cancelled state");
    ok(/cancelled/i.test(q("#main").textContent) && (await json(await get(`/orders/${second}`))).body.status === "CANCELLED", "cancelled checkout is recorded and the course stays locked");
    ok((await json(await get(`/courses/${courseId}/access`))).body.canAccess === false, "no entitlement after cancel");
    ok((await json(await post(`/orders/${first}/mock-outcome`, { outcome: "success" }))).body.status === "FAILED", "a settled (failed) order cannot be flipped to success");
    ok(((await json(await get("/me/courses"))).body || []).every((e) => e.courseId !== courseId), "no enrolment row was created by the failed/cancelled attempts");
    // retry → success
    click(q("[data-checkout-retry]")); await waitFor(() => q("[data-checkout-pay]"), 10000, "third checkout");
    click(q("[data-checkout-pay]")); await waitFor(() => q('[data-checkout="success"]'), 12000, "success");
    const orders = (await json(await get("/orders"))).body.filter((o) => o.courseId === courseId);
    ok(orders.length === 3 && orders.filter((o) => o.status === "SUCCESS").length === 1, `three orders for the course, exactly one SUCCESS (${orders.map((o) => o.status).join(",")})`);
    ok((await json(await get(`/courses/${courseId}/access`))).body.source === "PURCHASE", "the successful retry granted the entitlement");
    // instructor/admin retain access regardless of price
    const it = (await json(await post("/auth/login", { email: DEMO_EMAIL_BY_ROLE.instructor, password: DEMO_PASSWORD }, null))).body.token;
    ok((await get(`/lessons/${lessonId}`, it)).status === 200, "the course's instructor still reads paid content without purchasing");
    const at = (await json(await post("/auth/login", { email: DEMO_EMAIL_BY_ROLE.admin, password: DEMO_PASSWORD }, null))).body.token;
    ok((await get(`/lessons/${lessonId}`, at)).status === 200 && (await get("/orders?all=true", at)).status === 200, "admin reads paid content and can list all orders");
  };
}
