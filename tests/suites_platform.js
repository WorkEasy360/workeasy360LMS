// Final-milestone suites: backend notifications, admin user management, learner assignment, platform admin guards,
// search scoping. Run one at a time: index.html?as=<role>&selftest=<suite> (roles noted per suite).
import { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, load } from "/src/lib/store.js";
import { bus } from "/src/lib/events.js";

export function registerPlatform({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v2.token");
  const apiRaw = (path, opts = {}) => fetch("http://localhost:8080/api" + path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });
  const apiGet = (path) => apiRaw(path).then((r) => (r.ok ? r.json() : null));
  const apiPost = (path, body) => apiRaw(path, { method: "POST", body: JSON.stringify(body || {}) });
  const apiPut = (path, body) => apiRaw(path, { method: "PUT", body: JSON.stringify(body || {}) });
  const apiDel = (path) => apiRaw(path, { method: "DELETE" });
  const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
  const settled = async () => { const t0 = Date.now(); let last = t0; const off = bus.on("route", () => (last = Date.now())); await waitFor(() => Date.now() - Math.max(last, t0) > 1500, 12000, "route quiet period"); off(); };

  /** A published course owned by the instructor with one text lesson (created through the real Builder + backend sync). */
  async function publishedCourse() {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/builder/new"); await waitFor(() => location.hash.startsWith("#/builder/c-") && T("course.name"), 4000, "builder");
    const courseId = location.hash.split("/")[2];
    type(T("course.name"), `Platform test ${Date.now()}`);
    click(T("course.add-module")); await sleep(200);
    click(T("course.add-lesson")); await sleep(300);
    click(T("course.publish")); await sleep(300);
    const { flushSyncNow } = await import("/src/services/courseSync.js");
    await flushSyncNow(courseId);
    const lessonId = load("courses").find((c) => c.id === courseId).modules[0].lessons[0].id;
    const remote = await apiGet(`/courses/${courseId}`);
    ok(!!remote && remote.status === "PUBLISHED", `test course published on the backend (${courseId}) status=${remote?.status}`);
    return { courseId, lessonId };
  }

  // 1. Admin creates a person on the backend (temporary password shown once), edits their role; e-mail privacy for non-admins.
  suites.adminUsers = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    navigate("/people"); await waitFor(() => q("[data-people-add]"), 4000, "people page");
    await settled();
    const before = document.querySelectorAll("[data-person]").length;
    ok(before >= 3, `directory lists people from the backend (${before})`);
    click(q("[data-people-add]")); await waitFor(() => q("[data-people-name]"), 2000, "add-person modal");
    const email = `selftest.${Date.now().toString(36)}@workeasy360.dev`;
    type(q("[data-people-name]"), "Selftest Person"); type(q("[data-people-email]"), email);
    q("[data-people-role]").value = "instructor"; q("[data-people-role]").dispatchEvent(new Event("change", { bubbles: true }));
    click(q("[data-people-submit]"));
    const pw = await waitFor(() => q("[data-temp-password]"), 5000, "temporary password");
    ok(!!pw && pw.textContent.length >= 12, "temporary password shown once after creation");
    const tempPassword = pw?.textContent;
    const remote = ((await apiGet("/users")) || []).find((u) => u.email === email);
    ok(!!remote && remote.role === "INSTRUCTOR", "person exists on the backend with the chosen role");
    // Duplicate e-mail is refused
    const dup = await json(await apiPost("/users", { name: "Dup", email, role: "learner" }));
    ok(dup.status === 409, "duplicate e-mail refused with 409");
    // Edit role via API and see the UI reflect it
    const upd = await json(await apiPut(`/users/${remote.id}`, { role: "learner", title: "QA", dept: "Quality" }));
    ok(upd.status === 200 && upd.body.role === "LEARNER" && upd.body.title === "QA", "admin can change role/title/team");
    const self = await json(await apiPut(`/users/u-priya`, { role: "learner" }));
    ok(self.status === 400, "admin cannot remove their own admin role");
    // New account can sign in with the temporary password; deactivated accounts cannot
    const login = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: tempPassword }) });
    ok(login.status === 200, "new person signs in with the temporary password");
    await apiPut(`/users/${remote.id}`, { status: "INACTIVE" });
    const login2 = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: tempPassword }) });
    ok(login2.status === 401, "deactivated person can no longer sign in");
    // Privacy: a learner sees no e-mail addresses in the directory, and cannot manage users
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const dir = (await apiGet("/users")) || [];
    ok(dir.length > 0 && dir.every((u) => u.id === "u-maya" ? !!u.email : u.email == null), "learner directory hides other people's e-mail addresses");
    const forbidden = await json(await apiPost("/users", { name: "X", email: "x@x.dev", role: "admin" }));
    ok(forbidden.status === 403, "learner cannot create users (403)");
    const forbidden2 = await json(await apiPut(`/users/u-maya`, { role: "admin" }));
    ok(forbidden2.status === 403, "learner cannot promote themself (403)");
  };

  // 2. Instructor assigns a learner (with due date) → enrolment + notification on the backend; learner sees it after sign-in.
  suites.assignLearner = async () => {
    const { courseId } = await publishedCourse();
    const dueAt = Date.now() + 2 * 24 * 3600 * 1000; // due in 2 days → also triggers the sign-in reminder
    const r = await json(await apiPost(`/courses/${courseId}/learners/u-maya`, { dueAt }));
    ok(r.status === 200 && r.body.userId === "u-maya" && r.body.courseId === courseId && !!r.body.dueAt, "instructor enrols a learner with a due date");
    const again = await json(await apiPost(`/courses/${courseId}/learners/u-maya`, { dueAt }));
    ok(again.status === 200 && again.body.id === r.body.id, "assigning twice is idempotent");
    const learners = (await apiGet(`/courses/${courseId}/learners`)) || [];
    ok(learners.some((e) => e.userId === "u-maya"), "learner appears in the course's enrolment list");
    const missing = await json(await apiPost(`/courses/${courseId}/learners/u-nobody`, {}));
    ok(missing.status === 404, "unknown learner → 404");
    // Learner: the enrolment notification exists and the sign-in reminder was created once
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    let mine = (await apiGet("/notifications")) || [];
    const enrolNote = mine.find((n) => n.kind === "enrolment" && n.href === `/learn/${courseId}`);
    ok(!!enrolNote && !enrolNote.read, "learner received the enrolment notification with the course link");
    const due = mine.filter((n) => n.kind === "due" && n.href === `/learn/${courseId}`);
    ok(due.length === 1 && /due in 2 days|due in 1 day|due today/.test(due[0].title), "sign-in created one due-date reminder: " + due[0]?.title);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    mine = (await apiGet("/notifications")) || [];
    ok(mine.filter((n) => n.kind === "due" && n.href === `/learn/${courseId}`).length === 1, "signing in again does not duplicate the reminder");
    // Learner cannot assign or see other learners' progress
    const l = await json(await apiPost(`/courses/${courseId}/learners/u-omar`, {}));
    ok(l.status === 403, "learner cannot enrol other people (403)");
    const p = await apiRaw(`/courses/${courseId}/progress?userId=u-omar`);
    ok(p.status === 403, "learner cannot read another learner's progress (403)");
    // UI: the Notifications page shows the backend rows after hydration
    navigate("/notifications"); await waitFor(() => q("[data-notifications-page]"), 4000, "notifications page");
    await waitFor(() => q('[data-notification="enrolment"]'), 8000, "backend notification rendered");
    ok(!!q('[data-notification="enrolment"]'), "Notifications page renders the backend enrolment notification");
    // Mark all read → persisted
    click([...document.querySelectorAll("button")].find((b) => /Mark all read/.test(b.textContent)));
    await sleep(800);
    mine = (await apiGet("/notifications")) || [];
    ok(mine.length > 0 && mine.every((n) => n.read), "mark-all-read is persisted on the backend");
  };

  // 3. Event notifications: review feedback → learner; discussion reply → post author; IDOR guards; automation rules.
  suites.notificationsBackend = async () => {
    const { courseId, lessonId } = await publishedCourse();
    // Learner posts a discussion and completes progress; instructor replies
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const postId = "p-" + Date.now().toString(36);
    const cp = await json(await apiPost("/community/posts", { id: postId, kind: "discussion", title: "Platform test question", body: "Does the reply notify me?", courseId }));
    ok(cp.status === 200, "learner creates a discussion post");
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    const rc = await json(await apiPost(`/community/posts/${postId}/comments`, { id: "cm-" + Date.now().toString(36), body: "Yes — this reply should notify you." }));
    ok(rc.status === 200, "instructor replies");
    const rc2 = await json(await apiPost(`/community/posts/${postId}/comments`, { id: "cm2-" + Date.now().toString(36), body: "Second reply within the dedupe window." }));
    ok(rc2.status === 200, "second reply saved");
    // Instructor pins (allowed), learner cannot
    const pin = await json(await apiPost(`/community/posts/${postId}/pin`));
    ok(pin.status === 200 && pin.body.pinned === true, "instructor can pin a discussion");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const pinL = await json(await apiPost(`/community/posts/${postId}/pin`));
    ok(pinL.status === 403, "learner cannot pin (403)");
    let mine = (await apiGet("/notifications")) || [];
    const replies = mine.filter((n) => n.kind === "reply" && n.href === `/community?post=${postId}`);
    ok(replies.length === 1 && /replied to/.test(replies[0].title), "post author got exactly one reply notification (deduped within the window): " + replies[0]?.title);
    // Instructor's own reply must not notify the instructor
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    const instr = (await apiGet("/notifications")) || [];
    ok(!instr.some((n) => n.kind === "reply" && n.href === `/community?post=${postId}`), "replying does not notify the replier");
    // Course completion → certificate notification for the learner
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const done = await json(await apiPost(`/lessons/${lessonId}/progress`, { complete: true, percentage: 100 }));
    ok(done.status === 200 && done.body.courseCompleted === true && !!done.body.certificateId, "completing the only lesson completes the course and issues a certificate");
    mine = (await apiGet("/notifications")) || [];
    const ach = mine.find((n) => n.kind === "achievement" && n.href === "/certificates" && n.body.includes(done.body.certificateId));
    ok(!!ach, "learner notified about the new certificate");
    // IDOR: learner cannot read someone else's notification
    const other = ((await apiGet("/notifications")) || [])[0];
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    const idor = await json(await apiPost(`/notifications/${other.id}/read`));
    ok(idor.status === 403, "marking another user's notification read is refused (403)");
    const missing = await json(await apiPost(`/notifications/n-does-not-exist/read`));
    ok(missing.status === 404, "unknown notification → 404");
    // Automation rules: admin turns off discussion replies → no notification for new replies; then restores
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const off = await json(await apiPut("/settings", { automation: { discussionReplies: false } }));
    ok(off.status === 200 && JSON.parse(off.body.automationJson).discussionReplies === false && JSON.parse(off.body.automationJson).dueReminders === true, "admin toggles one automation rule; others keep their value");
    const rc3 = await json(await apiPost(`/community/posts/${postId}/comments`, { id: "cm3-" + Date.now().toString(36), body: "Reply while the rule is off." }));
    ok(rc3.status === 200, "reply saved while rule is off");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    mine = (await apiGet("/notifications")) || [];
    ok(mine.filter((n) => n.kind === "reply" && n.href === `/community?post=${postId}`).length === 1, "no reply notification while the rule is off");
    const learnerSettings = await json(await apiPut("/settings", { automation: { discussionReplies: true } }));
    ok(learnerSettings.status === 403, "learner cannot change automation rules (403)");
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const on = await json(await apiPut("/settings", { automation: { discussionReplies: true } }));
    ok(on.status === 200 && JSON.parse(on.body.automationJson).discussionReplies === true, "rule restored");
    // Admin UI: automation page lists the five rules with persisted state
    navigate("/automation"); await waitFor(() => q('[data-automation-rule="discussionReplies"]'), 4000, "automation page");
    await settled();
    ok(document.querySelectorAll("[data-automation-rule]").length === 5, "Automation page shows the five server-side rules");
    ok(!q("button[disabled][title*='coming soon' i]") && !/Foundation only/.test(document.body.textContent), "no placeholder 'coming soon' controls on the Automation page");
  };

  // 4. Platform admin guards: course delete guard, system status, coach analytics (admin only), integrations page honesty.
  suites.platformAdmin = async () => {
    const { courseId } = await publishedCourse();
    await apiPost(`/courses/${courseId}/learners/u-maya`, {});
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const del = await json(await apiDel(`/courses/${courseId}`));
    ok(del.status === 409 && /archive/i.test(del.body?.message || ""), "deleting a course with enrolled learners is refused (409, archive instead)");
    const arch = await json(await apiPost(`/courses/${courseId}/archive`));
    ok(arch.status === 200 && arch.body.status === "ARCHIVED", "archiving keeps the course and its enrolments");
    const st = await json(await apiRaw("/system/status"));
    ok(st.status === 200 && st.body.database?.connected === true && /PostgreSQL|H2/.test(st.body.database.product) && st.body.database.schemaVersion >= "6", `system status reports the database (${st.body.database?.product} v${st.body.database?.schemaVersion})`);
    const s = JSON.stringify(st.body).toLowerCase();
    ok(!s.includes("password") && !s.includes("apikey") && !s.includes("secret") && !s.includes("api_key"), "system status exposes no secrets");
    ok(st.body.ai?.provider === "mock" && st.body.ai?.enabled === false, "system status reports the AI provider (mock, disabled)");
    const coach = await json(await apiRaw("/analytics/coach"));
    ok(coach.status === 200 && typeof coach.body.conversations === "number" && typeof coach.body.recommendationsByStatus === "object" && !("messagesContent" in coach.body), "coach analytics are aggregate counts");
    ok(!JSON.stringify(coach.body).includes("u-maya"), "coach analytics carry no per-user rows");
    // Admin analytics overview shows the coach card
    navigate("/analytics"); await waitFor(() => q("[data-analytics-coach]"), 10000, "coach adoption card");
    ok(!!q("[data-analytics-coach]"), "Analytics overview shows the Coach & AI adoption card for admins");
    // Integrations page shows real platform status, no fake connectors
    navigate("/integrations"); await waitFor(() => q("[data-system-status]"), 8000, "integrations status");
    ok(!!q("[data-system-status]") && /PostgreSQL|H2/.test(q("[data-system-status]").textContent), "Integrations page shows the real database status");
    ok(![...document.querySelectorAll("button")].some((b) => /^Connect$/.test(b.textContent.trim())), "no demo Connect buttons");
    // Learner / instructor are refused
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    ok((await apiRaw("/system/status")).status === 403, "instructor cannot read system status (403)");
    ok((await apiRaw("/analytics/coach")).status === 403, "instructor cannot read coach analytics (403)");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    ok((await apiRaw("/system/status")).status === 403, "learner cannot read system status (403)");
    ok((await apiDel(`/courses/${courseId}`)).status === 403, "learner cannot delete courses (403)");
  };

  // 5. Search respects publication state (learner) and includes journeys; the Builder menu has no disabled placeholders.
  suites.searchScope = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/builder/new"); await waitFor(() => location.hash.startsWith("#/builder/c-") && T("course.name"), 4000, "builder");
    const draftTitle = `Unpublished draft ${Date.now().toString(36)}`;
    type(T("course.name"), draftTitle); await sleep(800);
    const { search } = await import("/src/services/search.js");
    ok(search(draftTitle.slice(0, 18), { id: "u-daniel", role: "instructor" }).some((g) => g.label === "Courses" && g.items.some((i) => i.title === draftTitle)), "instructor search finds their draft");
    // block menu has no "Coming soon" group
    click(T("course.add-module")); await sleep(200); click(T("course.add-lesson")); await sleep(300);
    const dd = T("block.add"); if (dd) { dd.click(); await sleep(150); }
    ok(!/Coming soon/.test(document.body.textContent) && ![...document.querySelectorAll(".menu-item")].some((i) => i.disabled), "Builder block menu has no disabled 'Coming soon' placeholders");
    document.body.click(); await sleep(100);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    await settled();
    const groups = search(draftTitle.slice(0, 18), { id: "u-maya", role: "learner" });
    ok(!groups.some((g) => g.items.some((i) => i.title === draftTitle)), "learner search does not surface unpublished drafts");
    const j = search("sales", { id: "u-maya", role: "learner" });
    ok(j.some((g) => g.label === "Journeys" && g.items.every((i) => i.href === "/journeys")), "learner search includes matching journeys");
    ok(j.some((g) => g.label === "Courses" && g.items.every((i) => i.href.startsWith("/explore/"))), "learner course results link to the catalogue");
    // Courses page has no placeholder AI card
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/courses"); await waitFor(() => T("courses.ai"), 4000, "courses page");
    ok(!!T("courses.ai") && !/Generate draft/.test(document.body.textContent), "Courses page offers the real AI builder and no 'coming soon' card");
  };
}

// 6. Responsive: key pages render without horizontal overflow at phone width (390px), measured inside a same-origin
// iframe so the check is independent of the test browser's window size.
export function registerResponsive({ suites, log, ok, sleep, waitFor }) {
  suites.responsive = async () => {
    const { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD } = await import("/src/lib/store.js");
    const W = 390, H = 844;
    const frame = document.createElement("iframe");
    frame.setAttribute("title", "responsive check");
    frame.style.cssText = `width:${W}px;height:${H}px;border:0;position:fixed;top:0;left:0;z-index:9999;background:#fff`;
    document.body.appendChild(frame);
    const scrolls = (win, el) => { for (let p = el.parentElement; p && p !== win.document.body; p = p.parentElement) { const o = win.getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
    const check = async (route, label) => {
      frame.src = "about:blank"; await sleep(80);
      frame.src = "/#" + route;
      const doc = await waitFor(() => { const d = frame.contentDocument; const m = d && d.querySelector("#main"); return m && m.textContent.trim().length > 60 && !d.querySelector(".skeleton") ? d : null; }, 15000, "page " + route);
      if (!doc) { ok(false, `${label}: page did not render in the ${W}px frame`); return; }
      await sleep(1500);
      const win = frame.contentWindow, w = win.innerWidth;
      const main = doc.querySelector("#main");
      // Offenders: boxes whose right edge passes the viewport, plus boxes whose own text/content spills past their box
      // (text overflow does not widen the element's rect but does widen the page's scrollWidth).
      const all = [...doc.querySelectorAll(".topbar *, #main *")].filter((el) => {
        const r = el.getBoundingClientRect(), cs = win.getComputedStyle(el);
        if (!(r.width > 0) || cs.position === "fixed" || cs.visibility === "hidden" || el.closest("[hidden]") || scrolls(win, el)) return false;
        const spills = !(el instanceof win.SVGElement) && cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 2 && r.left + el.scrollWidth > w + 1; // SVG nodes report bogus scrollWidth
        return r.right > w + 1 || spills;
      });
      const set = new Set(all);
      const tag = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : ""}`;
      const bad = all.filter((el) => !el.closest("svg *") && ![...el.children].some((c) => set.has(c) && !(c instanceof win.SVGElement))).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 3).map((el) => { const r = el.getBoundingClientRect(); return `${tag(el.parentElement.parentElement)} > ${tag(el.parentElement)} > ${tag(el)}[${Math.round(r.left)}..${Math.round(r.right)}${el.scrollWidth > el.clientWidth + 2 ? " text→" + Math.round(r.left + el.scrollWidth) : ""}] «${el.outerHTML.replace(/\s+/g, " ").slice(0, 90)}»`; });
      // widest content box in the page (text spill included) — the element that sets the page's scrollWidth
      let widest = null, ext = 0;
      for (const el of doc.querySelectorAll("#main *")) { const r = el.getBoundingClientRect(); const e = Math.max(r.right, !(el instanceof win.SVGElement) && win.getComputedStyle(el).overflowX === "visible" ? r.left + el.scrollWidth : 0); if (e > ext && r.width > 0 && !scrolls(win, el)) { ext = e; widest = el; } }
      if (widest && ext > w + 1) {
        const chain = []; for (let p = widest, i = 0; p && p !== main && i < 7; p = p.parentElement, i++) { const r = p.getBoundingClientRect(); chain.unshift(`${tag(p)}[${Math.round(r.left)}..${Math.round(r.right)}${p.scrollWidth > p.clientWidth + 2 ? " sw" + p.scrollWidth : ""}]`); }
        bad.push(`widest ${chain.join(" > ")} «${widest.outerHTML.replace(/\s+/g, " ").slice(0, 100)}»`);
      }
      const scrollOk = doc.documentElement.scrollWidth <= w + 1 && main.scrollWidth <= main.clientWidth + 1;
      ok(scrollOk && !bad.length, `${label} fits ${w}px without horizontal overflow${bad.length ? " — offenders: " + bad.join(", ") : ""}${scrollOk ? "" : ` (scrollWidth ${doc.documentElement.scrollWidth}/${main.scrollWidth})`}`);
    };
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    for (const [r, l] of [["/", "Home"], ["/coach", "Coach"], ["/learn/c-crm", "Player"], ["/community", "Community"], ["/skills", "Skills"], ["/explore", "Explore"], ["/journeys", "Journeys"], ["/progress", "My progress"]]) await check(r, l);
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    for (const [r, l] of [["/courses", "Courses"], ["/analytics", "Analytics"], ["/builder/c-crm", "Builder"], ["/builder/ai", "AI builder"], ["/learners", "Learners"]]) await check(r, l);
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    for (const [r, l] of [["/people", "People"], ["/integrations", "Integrations"], ["/automation", "Automation"], ["/settings", "Settings"], ["/certifications", "Certifications"]]) await check(r, l);
    frame.remove();
  };
}

// 7. Account sign-in: a person created by an admin signs in through the sign-in form (not a demo workspace).
export function registerAccountLogin({ suites, ok, sleep, q, click, type, waitFor }) {
  suites.accountLogin = async () => {
    const { loginReal, logout, getUser, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD } = await import("/src/lib/store.js");
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const email = `signin.${Date.now().toString(36)}@workeasy360.dev`, password = "Sign-in-" + Math.random().toString(36).slice(2, 12);
    const created = await fetch("http://localhost:8080/api/users", { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("we360.v2.token"), "Content-Type": "application/json" }, body: JSON.stringify({ name: "Signin Person", email, role: "learner", password }) });
    ok(created.status === 200, "admin creates an account with a chosen password");
    const body = await created.json();
    ok(body.temporaryPassword == null && !JSON.stringify(body).includes(password), "the chosen password is never echoed back");
    logout(); location.hash = "#/login";
    await waitFor(() => q("[data-login-email]"), 5000, "sign-in form");
    ok(!!q("[data-login-email]") && !!q("[data-login-password]") && q("[data-login-password]").type === "password", "sign-in screen has an e-mail and password form");
    type(q("[data-login-email]"), email); type(q("[data-login-password]"), "wrong-password");
    click(q("[data-login-submit]"));
    await waitFor(() => q("[data-login-error]") && !q("[data-login-error]").hidden, 5000, "sign-in error");
    ok(/don't match/.test(q("[data-login-error]")?.textContent || "") && !localStorage.getItem("we360.v2.token"), "wrong password shows an error and no session is created");
    type(q("[data-login-password]"), password);
    click(q("[data-login-submit]"));
    await waitFor(() => getUser()?.email === email && !location.hash.startsWith("#/login"), 8000, "signed in");
    ok(getUser()?.id === body.user.id && getUser()?.role === "learner" && !!localStorage.getItem("we360.v2.token"), "the new person is signed in with their own account and role");
    await waitFor(() => q("#main") && q("#main").textContent.trim().length > 40, 8000, "home renders");
    ok(!!q("#main") && /Home/.test(document.title + q("#topbar").textContent), "Home renders for the new account");
    await sleep(300);
  };
}
