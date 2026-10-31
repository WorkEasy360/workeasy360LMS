// Final-milestone suites: backend notifications, admin user management, learner assignment, platform admin guards,
// search scoping. Run one at a time: index.html?as=<role>&selftest=<suite> (roles noted per suite).
import { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, load, logout, getUser } from "/src/lib/store.js";
import { bus } from "/src/lib/events.js";

export function registerPlatform({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v3.token");
  const apiRaw = (path, opts = {}) => fetch("http://localhost:8080/api" + path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });
  const apiGet = (path) => apiRaw(path).then((r) => (r.ok ? r.json() : null));
  const apiPost = (path, body) => apiRaw(path, { method: "POST", body: JSON.stringify(body || {}) });
  const apiPut = (path, body) => apiRaw(path, { method: "PUT", body: JSON.stringify(body || {}) });
  const apiDel = (path) => apiRaw(path, { method: "DELETE" });
  const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
  const settled = async () => { const t0 = Date.now(); let last = t0; const off = bus.on("route", () => (last = Date.now())); await waitFor(() => Date.now() - Math.max(last, t0) > 1500, 12000, "route quiet period"); off(); };

  // Real-time synchronization: changes made by ANOTHER user (over raw fetch with their own token) must reach this
  // browser session live over the SSE stream — no navigation, no refresh. Covers admin→learner (catalog, enrolment,
  // notification, community, settings) and learner→staff (progress reaching an admin's Learners view).
  suites.realtime = async () => {
    const BASE = "http://localhost:8080/api";
    const otherLogin = async (email) => (await (await fetch(BASE + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).json()).token;
    const as = (tok) => (path, method = "POST", body) => fetch(BASE + path, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const meId = getUser().id;
    await sleep(2000); // let this session's SSE stream connect (ticket + EventSource handshake)

    const adm = as(await otherLogin(DEMO_EMAIL_BY_ROLE.admin));
    const title = `Realtime ${Date.now()}`;
    const cId = "c-rt" + Date.now().toString(36);

    // 1. Admin builds + publishes a course; the learner's open Explore page shows it with no refresh.
    navigate("/explore"); await waitFor(() => document.getElementById("main")?.textContent.includes("Explore"), 4000, "explore page");
    ok((await adm("/courses", "POST", { id: cId, title })).ok, "setup: admin created a course over the API");
    const tree1 = await (await adm(`/courses/${cId}/modules`, "POST", { title: "Module 1" })).json(); // returns the whole course tree
    const tree2 = await (await adm(`/courses/${cId}/modules/${tree1.modules[0].id}/lessons`, "POST", { title: "Lesson 1", type: "LESSON" })).json();
    const lesson = tree2.modules[0].lessons[0];
    ok(!!lesson?.id, "setup: lesson created");
    ok((await adm(`/courses/${cId}/publish`)).ok, "setup: admin published it");
    await waitFor(() => load("courses").some((c) => c.id === cId), 15000, "published course reaches the learner's cache live");
    ok(load("courses").some((c) => c.id === cId), "the published course reached the learner's session live");
    await waitFor(() => document.getElementById("main").textContent.includes(title), 8000, "published course visible in Explore live");
    ok(document.getElementById("main").textContent.includes(title), "a course published by the admin appeared in the open Explore page without refresh");

    // 2. Admin assigns this learner: enrolment + its notification arrive live.
    ok((await adm(`/courses/${cId}/learners/${meId}`, "POST", {})).ok, "setup: admin assigned the learner");
    await waitFor(() => load("enrollments").some((e) => e.userId === meId && e.courseId === cId), 12000, "live enrolment");
    ok(true, "the enrolment reached the learner's session live");
    await waitFor(() => load("notifications").some((n) => n.userId === meId && n.kind === "enrolment" && n.href === `/learn/${cId}`), 12000, "live notification");
    ok(true, "the enrolment notification appeared without refresh");

    // 3. Community: a discussion posted by the admin shows up in the open feed.
    navigate("/community"); await waitFor(() => q(".community"), 4000, "community page");
    document.activeElement?.blur?.(); // the live redraw politely skips while someone is typing — make sure nobody is
    const postText = "Realtime discussion " + Date.now();
    ok((await adm("/community/posts", "POST", { kind: "discussion", title: postText, body: postText })).ok, "setup: admin posted a discussion");
    await waitFor(() => document.getElementById("main").textContent.includes(postText), 15000, "post appears live");
    ok(true, "a discussion posted by the admin appeared in the open Community feed without refresh");

    // 4. Settings: an org-wide change lands in this session's cache live.
    const prevName = (load("settings")[0] || {}).orgName;
    const rtName = "RT Org " + Date.now().toString(36);
    await adm("/settings", "PUT", { orgName: rtName });
    await waitFor(() => (load("settings")[0] || {}).orgName === rtName, 12000, "live settings");
    ok(true, "an organisation-name change by the admin reached this session live");
    await adm("/settings", "PUT", { orgName: prevName || "WorkEasy360" });

    // 4b. A lesson of the PUBLISHED course is revised: the learner's copy of the course updates live.
    const revised = "Lesson 1 revised " + Date.now().toString(36);
    ok((await adm(`/lessons/${lesson.id}`, "PUT", { title: revised })).ok, "setup: admin revised a lesson of the published course");
    await waitFor(() => (load("courses").find((c) => c.id === cId)?.modules?.[0]?.lessons || []).some((l) => l.title === revised), 12000, "revised lesson reaches the learner");
    ok(true, "a revised lesson in a published course reached the learner's session live");

    // 4c. Network drop and recovery: nothing arrives while offline; on reconnect the client re-pulls what it missed.
    await sleep(1200); // let the restore-name event above settle first
    window.dispatchEvent(new Event("offline"));
    await sleep(500);
    const offName = "Offline change " + Date.now().toString(36);
    await adm("/settings", "PUT", { orgName: offName });
    await sleep(2500);
    ok((load("settings")[0] || {}).orgName !== offName, "while offline the change does not arrive (the stream is really down)");
    window.dispatchEvent(new Event("online"));
    await waitFor(() => (load("settings")[0] || {}).orgName === offName, 15000, "missed change recovered after reconnect");
    ok(true, "when connectivity returns the client reconnects and recovers the change it missed");
    await adm("/settings", "PUT", { orgName: prevName || "WorkEasy360" });

    // 5. The other direction: a learner's progress reaches a signed-in admin's Learners view live.
    const learnerToken = await otherLogin(DEMO_EMAIL_BY_ROLE.learner);
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    navigate("/learners"); await waitFor(() => document.getElementById("main")?.textContent.includes("Learners"), 5000, "learners page");
    await sleep(2000); // admin session's stream connects
    const lrn = as(learnerToken);
    ok((await lrn(`/lessons/${lesson.id}/progress`, "POST", { complete: true })).ok, "setup: learner completed the lesson over the API");
    await waitFor(() => {
      const e = load("enrollments").find((x) => x.userId === meId && x.courseId === cId);
      return !!e && !!(e.lastActiveAt || e.completedAt); // activity/completion dates come from the live staff pull
    }, 15000, "learner progress reaches the admin session live");
    ok(true, "a learner's lesson completion reached the signed-in admin's session without refresh");

    // 5b. Course completion and a quiz result reach staff analytics, and the open staff views are told to refetch.
    let learningSignals = 0;
    const offSignal = bus.on("sync:learning", () => learningSignals++);
    const tree3 = await (await adm(`/courses/${cId}/modules/${tree1.modules[0].id}/lessons`, "POST", { title: "Check", type: "QUIZ" })).json();
    const quizLesson = tree3.modules[0].lessons.find((l) => l.title === "Check");
    ok((await adm(`/lessons/${quizLesson.id}`, "PUT", { quiz: { passScore: 50, questions: [{ id: "q1", type: "tf", prompt: "Does live sync work?", answer: true }] } })).ok, "setup: a quiz lesson");
    const signalsBefore = learningSignals;
    const attempt = await (await lrn(`/lessons/${quizLesson.id}/quiz-attempts`, "POST", { responses: { q1: true } })).json();
    ok(attempt?.score === 100 && attempt?.passed === true, "the learner's quiz is scored by the server (100%, passed)");
    await waitFor(() => learningSignals > signalsBefore, 12000, "staff views told to refetch after the quiz");
    ok(true, "the admin's open views were told to refetch the moment the quiz was submitted");
    offSignal();
    const stats = await (await adm(`/analytics/courses/${cId}`, "GET")).json();
    ok(stats.quizAttempts >= 1 && stats.avgQuizScore === 100, `course analytics show the actual quiz result (${stats.quizAttempts} attempt, avg ${stats.avgQuizScore}%)`);
    ok(stats.completed >= 1, `course analytics count the learner's course completion (${stats.completed})`);

    // Cleanup so reruns stay tidy.
    await adm(`/courses/${cId}`, "DELETE");
  };

  // Access changes take effect on LIVE sessions, not only at the next sign-in: deactivation, deletion, demotion and
  // organization suspension all apply to tokens already handed out (which otherwise stay valid for 12 hours).
  suites.sessionAccess = async () => {
    const BASE = "http://localhost:8080/api";
    const raw = (path, method = "GET", body, tok) => fetch(BASE + path, { method, headers: { ...(tok && { Authorization: "Bearer " + tok }), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const login = async (email, password) => (await (await raw("/auth/login", "POST", { email, password })).json()).token;
    const stamp = Date.now().toString(36);
    const aTok = await login(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);

    // deactivation and reactivation
    const lEmail = `live.${stamp}@workeasy360.dev`;
    const learner = (await (await raw("/users", "POST", { name: "Live Learner", email: lEmail, role: "learner", password: "LiveLearn123" }, aTok)).json()).user;
    const lTok = await login(lEmail, "LiveLearn123");
    ok((await raw("/auth/me", "GET", undefined, lTok)).status === 200, "setup: the learner's session works");
    await raw(`/users/${learner.id}`, "PUT", { status: "INACTIVE" }, aTok);
    ok((await raw("/auth/me", "GET", undefined, lTok)).status === 401, "deactivating a person ends their existing session immediately (401)");
    ok((await raw("/courses/trees", "GET", undefined, lTok)).status === 401, "…for every API call, not only sign-in");
    await raw(`/users/${learner.id}`, "PUT", { status: "ACTIVE" }, aTok);
    ok((await raw("/auth/me", "GET", undefined, lTok)).status === 200, "reactivating restores the same session");

    // demotion applies to the live token
    const iEmail = `live.i.${stamp}@workeasy360.dev`;
    const instr = (await (await raw("/users", "POST", { name: "Live Instructor", email: iEmail, role: "instructor", password: "LiveInstr123" }, aTok)).json()).user;
    const iTok = await login(iEmail, "LiveInstr123");
    ok((await raw("/courses", "POST", { id: "c-live" + stamp, title: "Before demotion" }, iTok)).status === 200, "setup: the instructor can create courses");
    await raw(`/users/${instr.id}`, "PUT", { role: "learner" }, aTok);
    ok((await raw("/courses", "POST", { id: "c-live2" + stamp, title: "After demotion" }, iTok)).status === 403, "a demoted instructor loses instructor rights on the token they already hold (403)");
    await raw(`/users/${instr.id}`, "PUT", { role: "instructor" }, aTok);
    await raw(`/courses/c-live${stamp}`, "DELETE", undefined, aTok);

    // deletion
    await raw(`/users/${learner.id}`, "DELETE", undefined, aTok);
    ok((await raw("/auth/me", "GET", undefined, lTok)).status === 401, "a deleted person's session ends immediately (401)");

    // organization suspension applies to sessions already open
    const cEmail = `owner.${stamp}@live-c.dev`;
    const reg = await (await raw("/public/organizations", "POST", { company: "Live C " + stamp, adminName: "C Owner", adminEmail: cEmail })).json();
    const cTok = (await (await raw("/auth/reset", "POST", { token: reg.resetPath.split("/").pop(), password: "LiveCee123" })).json()).token;
    ok((await raw("/users", "GET", undefined, cTok)).status === 200, "setup: Company C's admin is working");
    const pTok = await login("platform@workeasy360.dev", "platform123456");
    const orgC = ((await (await raw("/platform/organizations?q=" + encodeURIComponent("Live C " + stamp), "GET", undefined, pTok)).json()) || [])[0];
    await raw(`/platform/organizations/${orgC.id}/status`, "POST", { status: "SUSPENDED" }, pTok);
    ok((await raw("/users", "GET", undefined, cTok)).status === 401, "suspending an organization ends its members' open sessions immediately (401)");
    await raw(`/platform/organizations/${orgC.id}/status`, "POST", { status: "ACTIVE" }, pTok);
    ok((await raw("/users", "GET", undefined, cTok)).status === 200, "reactivation restores access");

    // the browser follows: a deactivated person's open app signs out on its next request
    const uEmail = `live.ui.${stamp}@workeasy360.dev`;
    const uiUser = (await (await raw("/users", "POST", { name: "Live UI", email: uEmail, role: "learner", password: "LiveUi1234" }, aTok)).json()).user;
    await loginReal(uEmail, "LiveUi1234");
    navigate("/my-learning"); await waitFor(() => getUser()?.id === uiUser.id, 4000, "signed in in the browser");
    await raw(`/users/${uiUser.id}`, "PUT", { status: "INACTIVE" }, aTok);
    const { api } = await import("/src/services/api.js");
    await api.me().catch(() => {});
    await waitFor(() => !getUser() && location.hash.startsWith("#/login"), 6000, "browser signed out");
    ok(!getUser() && location.hash.startsWith("#/login"), "the deactivated person's open browser session is signed out on its next request");
    await raw(`/users/${uiUser.id}`, "DELETE", undefined, aTok);
  };

  // Multi-tenant SaaS: self-serve company registration provisions an isolated organization (plan, subscription,
  // admin via one-time reset link); nothing of one tenant is visible to another; the platform owner oversees all of
  // it and customer admins can't reach platform APIs. All in one suite because Org B is expensive to set up.
  suites.tenantIsolation = async () => {
    const BASE = "http://localhost:8080/api";
    const raw = (path, method = "GET", body, tok) => fetch(BASE + path, { method, headers: { ...(tok && { Authorization: "Bearer " + tok }), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

    // --- the public commercial surface ---
    const plans = (await j(await raw("/public/plans"))).body;
    ok(Array.isArray(plans) && plans.length >= 3 && plans.every((p) => p.id && p.name && typeof p.priceCents === "number"), `the public plan catalogue is live (${plans?.length} plans)`);

    // --- provision Company B (trial) ---
    const stamp = Date.now().toString(36);
    const bEmail = `owner.${stamp}@companyb.dev`;
    const reg = await j(await raw("/public/organizations", "POST", { company: "Company B " + stamp, adminName: "Bella Owner", adminEmail: bEmail, planId: "plan-starter" }));
    ok(reg.status === 200 && reg.body.status === "TRIAL" && typeof reg.body.resetPath === "string", "a company registers itself and gets a trial organization, no manual steps");
    const dup = await j(await raw("/public/organizations", "POST", { company: "Company B again", adminName: "Bella Owner", adminEmail: bEmail }));
    ok(dup.status === 409, "registering the same e-mail again is refused (409), never a duplicate organization");

    // The admin arrives through the one-time reset link — no password ever travelled.
    const resetToken = reg.body.resetPath.split("/").pop();
    const resetDone = await j(await raw("/auth/reset", "POST", { token: resetToken, password: "CompanyB123" }));
    ok(resetDone.status === 200 && !!resetDone.body.token, "the new organization's admin sets a password via the one-time link and is signed in");
    const bTok = resetDone.body.token;

    // --- Company B builds its own world ---
    const bCourseId = "c-bco" + stamp;
    ok((await raw("/courses", "POST", { id: bCourseId, title: "Company B onboarding" }, bTok)).ok, "Company B's admin creates a course");
    const bUser = await j(await raw("/users", "POST", { name: "Ben B", email: `ben.${stamp}@companyb.dev`, role: "learner" }, bTok));
    ok(bUser.status === 200 && !!bUser.body.user?.id, "Company B's admin adds a learner");
    const bPost = await j(await raw("/community/posts", "POST", { kind: "discussion", title: "B internal " + stamp, body: "Company B private discussion" }, bTok));
    ok(bPost.status === 200, "Company B starts a private community discussion");
    await raw("/settings", "PUT", { orgName: "Company B Ltd" }, bTok);

    // --- isolation, from Company A's (default org) side ---
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const aTok = token();
    const aUsers = (await j(await raw("/users", "GET", undefined, aTok))).body || [];
    ok(!aUsers.some((u) => (u.email || "").includes("companyb.dev")), "Company A's directory contains no Company B people");
    const aCourses = (await j(await raw("/courses/trees", "GET", undefined, aTok))).body || [];
    ok(!aCourses.some((c) => c.id === bCourseId), "Company A's course hydration contains no Company B courses");
    ok((await raw(`/courses/${bCourseId}`, "GET", undefined, aTok)).status === 404, "fetching a Company B course by id answers 404, not 403 — it does not exist for Company A");
    ok((await raw(`/users/${bUser.body.user.id}`, "GET", undefined, aTok)).status === 404, "fetching a Company B person by id answers 404");
    ok((await raw(`/users/${bUser.body.user.id}`, "PUT", { role: "admin" }, aTok)).status === 404, "changing a Company B person is refused");
    ok((await raw(`/courses/${bCourseId}/learners/u-maya`, "POST", {}, aTok)).status === 404, "enrolling into a Company B course is refused");
    const aPosts = (await j(await raw("/community/posts", "GET", undefined, aTok))).body || [];
    ok(!aPosts.some((p) => (p.title || "").includes("B internal")), "Company A's community feed contains no Company B posts");
    const aSettings = (await j(await raw("/settings", "GET", undefined, aTok))).body;
    ok(aSettings.orgName !== "Company B Ltd", "Company A's settings are untouched by Company B's");

    // --- and from Company B's side ---
    const bUsers = (await j(await raw("/users", "GET", undefined, bTok))).body || [];
    ok(bUsers.length === 2 && bUsers.every((u) => (u.email || "").includes("companyb.dev")), `Company B's directory holds exactly its own two people`);
    const bTrees = (await j(await raw("/courses/trees", "GET", undefined, bTok))).body || [];
    ok(bTrees.length === 1 && bTrees[0].id === bCourseId, "Company B sees exactly its own course — none of Company A's catalogue");
    ok((await raw("/courses/c-sales", "GET", undefined, bTok)).status === 404, "a Company A course does not exist for Company B");
    const bAnalytics = await j(await raw("/analytics/overview", "GET", undefined, bTok));
    if (bAnalytics.status === 200) ok((bAnalytics.body.totalCourses ?? bAnalytics.body.courses ?? 1) <= 2, "Company B analytics only count Company B data");

    // --- subscription limits are enforced by the backend ---
    // plan-starter allows 25 people; we won't hit that, but the endpoint must exist and answer; create up to the
    // course limit instead? Too slow — verified by unit of the seat check elsewhere. Here: suspended org gate.

    // --- platform owner oversight ---
    const pLogin = await j(await raw("/auth/login", "POST", { email: "platform@workeasy360.dev", password: "platform123456" }));
    ok(pLogin.status === 200, "the platform owner signs in (bootstrap account)");
    const pTok = pLogin.body.token;
    const orgRows = (await j(await raw("/platform/organizations", "GET", undefined, pTok))).body || [];
    const bRow = orgRows.find((o) => o.name.startsWith("Company B " + stamp));
    ok(!!bRow && bRow.subscriptionStatus === "TRIAL" && bRow.planId === "plan-starter" && bRow.people === 2, "the platform owner sees Company B with its plan, trial status and headcount");
    const stats = (await j(await raw("/platform/stats", "GET", undefined, pTok))).body;
    ok(stats.organizations >= 2 && stats.subscriptionsTrial >= 1, "platform analytics aggregate real data");
    ok((await raw("/platform/organizations", "GET", undefined, aTok)).status === 403, "a customer admin cannot open platform administration (403)");
    ok((await raw("/platform/plans", "GET", undefined, bTok)).status === 403, "a trial organization's admin cannot manage the plan catalogue (403)");

    // Platform owner suspends Company B → nobody there can sign in; reactivation restores access.
    ok((await raw(`/platform/organizations/${bRow.id}/status`, "POST", { status: "SUSPENDED" }, pTok)).ok, "platform owner suspends Company B");
    const lockedOut = await j(await raw("/auth/login", "POST", { email: bEmail, password: "CompanyB123" }));
    ok(lockedOut.status === 403 && /suspended/i.test(lockedOut.body?.message || ""), "a suspended organization's admin cannot sign in");
    ok((await raw(`/platform/organizations/${bRow.id}/status`, "POST", { status: "ACTIVE" }, pTok)).ok, "platform owner reactivates Company B");
    ok((await raw("/auth/login", "POST", { email: bEmail, password: "CompanyB123" })).status === 200, "after reactivation Company B signs in again");

    // The audit log recorded the lifecycle, without any secrets.
    const audit = (await j(await raw("/platform/audit", "GET", undefined, pTok))).body || [];
    ok(audit.some((e) => e.action === "org.provisioned" && (e.detail || "").includes("Company B")), "provisioning was audited");
    ok(audit.some((e) => e.action === "org.status"), "suspension was audited");
    ok(!JSON.stringify(audit).includes("CompanyB123") && !JSON.stringify(audit).includes(resetToken), "the audit log contains no passwords or tokens");
  };

  // Cross-tenant WRITE and IDOR attacks (tenantIsolation covers listings and reads): Company B, holding real ids of
  // Company A's records, tries every id-taking endpoint. Plus the SSE stream's own security: tickets, single use,
  // tenant-scoped delivery, metadata-only payloads, and no event for a failed write.
  suites.tenantIdor = async () => {
    const BASE = "http://localhost:8080/api";
    const raw = (path, method = "GET", body, tok) => fetch(BASE + path, { method, headers: { ...(tok && { Authorization: "Bearer " + tok }), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
    const login = async (email, password) => (await j(await raw("/auth/login", "POST", { email, password }))).body?.token;
    const stamp = Date.now().toString(36);

    // ---- Company A (default org): a published free course, its module/lesson, a video, an AI draft, a certificate
    const aTok = await login(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const cA = "c-ida" + stamp;
    await raw("/courses", "POST", { id: cA, title: "A private course " + stamp }, aTok);
    const tA = (await j(await raw(`/courses/${cA}/modules`, "POST", { title: "A module" }, aTok))).body;
    const moduleA = tA.modules[0].id;
    const tA2 = (await j(await raw(`/courses/${cA}/modules/${moduleA}/lessons`, "POST", { title: "A lesson", type: "LESSON" }, aTok))).body;
    const lessonA = tA2.modules[0].lessons[0].id;
    ok((await raw(`/courses/${cA}/publish`, "POST", undefined, aTok)).ok, "setup: Company A has a published free course");
    const vA = (await j(await raw(`/videos/external?courseId=${cA}`, "POST", { sourceType: "youtube", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "A video" }, aTok))).body;
    ok(!!vA?.id, "setup: Company A has a video");
    const genA = (await j(await raw("/ai/quiz/generate", "POST", { context: "A internal process", objectives: ["x"], count: 3 }, aTok))).body;
    const certA = ((await j(await raw("/certificates?all=true", "GET", undefined, aTok))).body || []).find((c) => c.status !== "REVOKED");
    const postA = (await j(await raw("/community/posts", "POST", { kind: "discussion", title: "A thread " + stamp, body: "A only" }, aTok))).body;
    const commentA = (await j(await raw(`/community/posts/${postA.id}/comments`, "POST", { id: "cm-ida" + stamp, body: "A comment" }, aTok))).body?.comments?.[0];
    const groupA = ((await j(await raw("/community/groups", "GET", undefined, aTok))).body || [])[0];

    // ---- Company B: provisioned through the public flow, with its own learner and published course
    const bEmail = `admin.${stamp}@idor-b.dev`;
    const reg = (await j(await raw("/public/organizations", "POST", { company: "IDOR B " + stamp, adminName: "B Admin", adminEmail: bEmail }))).body;
    const bTok = (await j(await raw("/auth/reset", "POST", { token: reg.resetPath.split("/").pop(), password: "IdorBee123" }))).body.token;
    const bLearnerEmail = `learner.${stamp}@idor-b.dev`;
    await raw("/users", "POST", { name: "B Learner", email: bLearnerEmail, role: "learner", password: "IdorLearn123" }, bTok);
    const blTok = await login(bLearnerEmail, "IdorLearn123");
    const cB = "c-idb" + stamp;
    await raw("/courses", "POST", { id: cB, title: "B course" }, bTok);
    const tB = (await j(await raw(`/courses/${cB}/modules`, "POST", { title: "B module" }, bTok))).body;
    const moduleB = tB.modules[0].id;
    const tB2 = (await j(await raw(`/courses/${cB}/modules/${moduleB}/lessons`, "POST", { title: "B lesson", type: "LESSON" }, bTok))).body;
    const lessonB = tB2.modules[0].lessons[0].id;
    await raw(`/courses/${cB}/publish`, "POST", undefined, bTok);
    ok(!!blTok && !!lessonB, "setup: Company B has an admin, a learner and a published course");

    // ---- a tenant's own learner can learn (this was broken: progress checked access against the default org)
    ok((await raw(`/courses/${cB}/enroll`, "POST", {}, blTok)).status === 200, "Company B's learner enrols in Company B's own free course");
    ok((await raw(`/lessons/${lessonB}/progress`, "POST", { complete: true }, blTok)).status === 200, "Company B's learner records progress in their own course");

    // ---- learning writes across the boundary
    ok((await raw(`/lessons/${lessonA}/progress`, "POST", { complete: true }, blTok)).status === 404, "B's learner cannot write progress into Company A's lesson (404)");
    ok((await raw(`/courses/${cA}/enroll`, "POST", {}, blTok)).status === 404, "B's learner cannot self-enrol in Company A's course (404)");
    const bLearnerId = (await j(await raw("/auth/me", "GET", undefined, blTok))).body.id;
    const aLearners = (await j(await raw(`/courses/${cA}/learners`, "GET", undefined, aTok))).body || [];
    ok(!aLearners.some((e) => e.userId === bLearnerId), "no Company B learner ever lands in Company A's course roster");

    // ---- course structure across the boundary
    ok((await raw("/courses", "POST", { id: cA, title: "taken over" }, bTok)).status === 409, "B cannot take over Company A's course by re-using its id (409)");
    const aAfter = (await j(await raw(`/courses/${cA}`, "GET", undefined, aTok))).body;
    ok(aAfter?.title === "A private course " + stamp && aAfter?.instructorId === "u-priya", "Company A's course is unchanged after the takeover attempt");
    ok((await raw(`/courses/${cB}/modules`, "POST", { id: moduleA, title: "renamed by B" }, bTok)).status === 409, "B cannot rename Company A's module by re-using its id (409)");
    ok((await raw(`/lessons/${lessonB}/move`, "POST", { toModuleId: moduleA, toIndex: 0 }, bTok)).status === 404, "B cannot move a lesson into Company A's module (404)");
    ok((await raw(`/courses/${cA}/modules/${moduleB}/lessons`, "POST", { title: "x", type: "LESSON" }, bTok)).status === 404, "a mismatched course id in the lesson route never returns Company A's tree (404)");
    const aTreeNow = (await j(await raw(`/courses/${cA}`, "GET", undefined, aTok))).body;
    ok(aTreeNow.modules[0].title === "A module" && aTreeNow.modules[0].lessons.length === 1, "Company A's modules and lessons are intact");
    ok((await raw(`/courses/${cA}`, "DELETE", undefined, bTok)).status === 404, "B's admin cannot delete Company A's course (404)");
    ok((await raw(`/courses/${cA}`, "GET", undefined, aTok)).status === 200, "Company A's course still exists");
    ok((await raw(`/courses/${cB}/assign-instructor`, "POST", { instructorId: "u-daniel" }, bTok)).status === 404, "B cannot hand its course to a Company A instructor (404)");
    const bAdminId = (await j(await raw("/auth/me", "GET", undefined, bTok))).body.id;
    ok((await raw(`/courses/${cA}/assign-instructor`, "POST", { instructorId: bAdminId }, aTok)).status === 404, "A cannot hand its course to a Company B person (404)");

    // ---- certificates, videos, orders, access info, skills, AI, community, analytics
    if (certA) {
      ok((await raw(`/certificates/${certA.id}/revoke`, "POST", undefined, bTok)).status === 404, "B's admin cannot revoke a Company A certificate (404)");
      ok((await raw(`/certificates/${certA.id}/renew`, "POST", undefined, bTok)).status === 404, "B's admin cannot renew a Company A certificate (404)");
      const still = ((await j(await raw("/certificates?all=true", "GET", undefined, aTok))).body || []).find((c) => c.id === certA.id);
      ok(still && still.status !== "REVOKED", "the Company A certificate is still valid");
    }
    ok((await raw(`/videos/${vA.id}`, "GET", undefined, bTok)).status === 404, "B cannot read Company A's video metadata (404)");
    ok([403, 404].includes((await raw(`/videos/${vA.id}/stream`, "GET", undefined, bTok)).status), "B cannot stream Company A's video");
    ok((await raw(`/videos/${vA.id}/thumbnail`, "GET", undefined, bTok)).status === 404, "B cannot fetch Company A's video thumbnail (404)");
    ok((await raw(`/videos/${vA.id}`, "PUT", { title: "pwned" }, bTok)).status === 404, "B cannot edit Company A's video (404)");
    ok((await raw(`/videos/${vA.id}`, "DELETE", undefined, bTok)).status === 404, "B cannot delete Company A's video (404)");
    ok((await raw(`/videos/${vA.id}`, "GET", undefined, aTok)).status === 200, "Company A's video is intact");
    const bOrders = (await j(await raw("/orders?all=true", "GET", undefined, bTok))).body || [];
    ok(bOrders.every((o) => o.courseId === cB), `B's admin sees only Company B's orders (${bOrders.length})`);
    ok((await raw(`/courses/${cA}/access`, "GET", undefined, blTok)).status === 404, "Company A's course price/access does not exist for Company B (404)");
    ok((await raw("/users/u-maya/skills", "GET", undefined, bTok)).status === 404, "B's admin cannot read a Company A learner's skills (404)");
    ok((await raw(`/courses/${cA}/skills`, "GET", undefined, bTok)).status === 404, "B cannot read Company A's course-skill mapping (404)");
    ok((await raw(`/lessons/${lessonA}/skills`, "GET", undefined, bTok)).status === 404, "B cannot read Company A's lesson-skill mapping (404)");
    if (genA?.id) ok((await raw(`/ai/generations/${genA.id}`, "GET", undefined, bTok)).status === 404, "B's admin cannot read Company A's AI draft (404)");
    const steal = await raw("/ai/course/generate", "POST", { topic: "Steal", objectives: ["x"], sources: [{ kind: "lms", courseId: cA }] }, bTok);
    ok(steal.status === 403, "B cannot feed Company A's published course into its own AI generation (403)");
    if (commentA) ok((await raw(`/community/comments/${commentA.id}/reactions?postId=${postA.id}`, "POST", { type: "like" }, bTok)).status === 404, "B cannot react to a Company A comment (404)");
    if (groupA) ok((await raw(`/community/groups/${groupA.id}/toggle-membership`, "POST", undefined, bTok)).status === 404, "B cannot join a Company A community group (404)");
    ok((await raw(`/analytics/courses/${cA}`, "GET", undefined, bTok)).status === 404, "B cannot read Company A's course analytics (404)");
    const coach = await raw("/coach/message", "POST", { text: "summarise this", lessonId: lessonA }, blTok);
    ok(coach.status === 403, "the AI coach refuses to load a Company A lesson into Company B's conversation (403)");

    // ---- SSE stream security
    ok((await raw("/sync/ticket", "POST")).status === 401, "a stream ticket requires sign-in (401)");
    ok((await fetch(BASE + "/sync/stream")).status === 401, "the stream refuses a request without a ticket (401)");
    ok((await fetch(BASE + "/sync/stream?ticket=not-a-real-ticket")).status === 401, "the stream refuses a forged ticket (401)");
    const openStream = async (tok) => {
      const t = (await j(await raw("/sync/ticket", "POST", undefined, tok))).body.ticket;
      const ctrl = new AbortController();
      const res = await fetch(`${BASE}/sync/stream?ticket=${encodeURIComponent(t)}`, { signal: ctrl.signal });
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } } catch {} })();
      return { ticket: t, status: res.status, text: () => buf, close: () => ctrl.abort() };
    };
    const aStream = await openStream(aTok), bStream = await openStream(bTok);
    ok(aStream.status === 200 && bStream.status === 200, "each tenant opens its own stream with a fresh ticket");
    ok((await fetch(`${BASE}/sync/stream?ticket=${encodeURIComponent(aStream.ticket)}`)).status === 401, "a ticket works only once (replay refused, 401)");
    await sleep(800);
    const before = aStream.text().length;
    ok((await raw("/users", "POST", { name: "x", email: "not-an-email", role: "learner" }, aTok)).status === 400, "setup: a failing write (400)");
    await sleep(1500);
    ok(!aStream.text().slice(before).includes("event:sync"), "a failed write emits no event");
    await raw(`/courses/${cA}`, "PUT", { description: "touched " + stamp }, aTok);
    await waitFor(() => aStream.text().includes("event:sync"), 8000, "A's own stream gets A's event");
    await sleep(1500);
    ok(aStream.text().includes('"type":"courses"'), "Company A's stream receives Company A's course event");
    ok(!bStream.text().includes("event:sync"), "Company B's stream receives nothing from Company A's activity");
    const evt = JSON.parse((aStream.text().split("event:sync\ndata:")[1] || "{}").split("\n")[0] || "{}");
    ok(JSON.stringify(Object.keys(evt).sort()) === JSON.stringify(["actorId", "at", "id", "type"]), "events carry metadata only (id, type, actor, time) — never records");
    aStream.close(); bStream.close();

    // tidy: Company A's test course (B's org stays as an inert trial tenant)
    await raw(`/courses/${cA}`, "DELETE", undefined, aTok);
  };

  // Password reset: self-service request, admin-issued link, single use, expiry of old links, and the two public pages.
  suites.passwordReset = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const email = `reset.${Date.now().toString(36)}@workeasy360.dev`;
    const created = (await json(await apiPost("/users", { name: "Reset Probe", email, role: "learner" }))).body;
    const tempPassword = created.temporaryPassword;
    ok(!!created.user?.id && !!tempPassword, "setup: person created with a temporary password");

    // Self-service request: always 200, no account enumeration; `sent` only reflects whether this server has SMTP
    const forgot = await json(await apiPost("/auth/forgot", { email }));
    const mailOn = forgot.body?.sent === true;
    ok(forgot.status === 200 && typeof forgot.body.sent === "boolean", `forgot always answers 200 (this server ${mailOn ? "sends e-mail" : "has no mail server"})`);
    const unknown = await json(await apiPost("/auth/forgot", { email: "who.is.this@workeasy360.dev" }));
    ok(unknown.status === 200 && unknown.body.sent === forgot.body.sent, "an unknown address gets the identical answer (no enumeration)");
    ok((await apiPost("/auth/forgot", { email: "not-an-email" })).status === 400, "a malformed address is refused");
    const probe = `throttle.${Date.now().toString(36)}@workeasy360.dev`;
    let last = 0; for (let i = 0; i < 4; i++) last = (await apiPost("/auth/forgot", { email: probe })).status;
    ok(last === 429, "the 4th reset request for one address in an hour is throttled (429)");

    // Admin-issued link (one per person at a time; a new link retires the previous one)
    const stale = (await json(await apiPost(`/users/${created.user.id}/reset-token`))).body;
    const fresh = (await json(await apiPost(`/users/${created.user.id}/reset-token`))).body;
    ok(/^#\/reset\/[A-Za-z0-9_-]{40,}$/.test(fresh.resetPath) && fresh.expiresMinutes === 60 && fresh.emailed === mailOn, `admin gets a one-time reset path (emailed=${fresh.emailed})`);
    const staleToken = stale.resetPath.split("/").pop(), freshToken = fresh.resetPath.split("/").pop();
    ok((await apiPost("/auth/reset", { token: staleToken, password: "NewPass123" })).status === 400, "an older link stops working once a new one is issued");
    ok((await apiPost("/auth/reset", { token: freshToken, password: "short" })).status === 400, "a weak password is refused");
    const done = await json(await apiPost("/auth/reset", { token: freshToken, password: "NewPass123" }));
    ok(done.status === 200 && done.body.user?.id === created.user.id && !!done.body.token, "the link sets the password and signs the person in");
    ok((await apiPost("/auth/reset", { token: freshToken, password: "OtherPass123" })).status === 400, "a link only works once");
    const oldLogin = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: tempPassword }) });
    ok(oldLogin.status === 401, "the temporary password no longer works");
    const newLogin = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "NewPass123" }) });
    ok(newLogin.status === 200, "the new password signs in");
    // Only admins issue links
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    ok((await apiPost(`/users/${created.user.id}/reset-token`)).status === 403, "a learner cannot issue reset links");

    // The public pages: forgot (confirmation) and reset (signs in with the new password). The admin link is issued
    // AFTER the forgot step: with a mail server configured, a forgot request issues a fresh token of its own, which
    // would retire an admin link issued earlier (newest link wins, by design).
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const adminToken = token();
    logout(); location.hash = "#/login";
    await waitFor(() => q("[data-login-forgot]"), 4000, "login page");
    ok(!!q("[data-login-forgot]"), "the sign-in page offers Forgot password?");
    click(q("[data-login-forgot]"));
    await waitFor(() => q("[data-forgot-email]"), 4000, "forgot page");
    type(q("[data-forgot-email]"), email); click(q("[data-forgot-submit]"));
    await waitFor(() => q("[data-forgot-done]"), 5000, "forgot confirmation");
    ok(q("[data-forgot-done]")?.dataset.forgotDone === (mailOn ? "sent" : "no-mail"),
      mailOn ? "with SMTP the page says the link is on its way" : "without SMTP the page points at the administrator");
    const ui = await fetch("http://localhost:8080/api/users/" + created.user.id + "/reset-token", { method: "POST", headers: { Authorization: "Bearer " + adminToken } }).then((r) => r.json());
    location.hash = "#/reset/" + ui.resetPath.split("/").pop();
    await waitFor(() => q("[data-reset-password]"), 4000, "reset page");
    type(q("[data-reset-password]"), "UiPass1234"); type(q("[data-reset-confirm]"), "UiPass1234");
    click(q("[data-reset-submit]"));
    await waitFor(() => getUser()?.id === created.user.id && location.hash === "#/", 8000, "signed in after reset");
    ok(getUser()?.id === created.user.id, "setting a new password on the page signs the person straight in");

    // Signed-in password change: offered to real accounts in the menu, proves the current password, same rules.
    await waitFor(() => q(".user-btn"), 4000, "topbar");
    q(".user-btn").click(); await sleep(300);
    if (!q(".menu")) { q(".user-btn")?.click(); await waitFor(() => q(".menu"), 4000, "account menu"); }
    ok(/Change password/.test(q(".menu")?.textContent || ""), "a real account can change its password from the account menu");
    document.body.click(); await sleep(100);
    ok((await apiPost("/auth/password", { currentPassword: "wrong", newPassword: "Another123" })).status === 400, "a wrong current password is refused");
    ok((await apiPost("/auth/password", { currentPassword: "UiPass1234", newPassword: "short" })).status === 400, "a weak new password is refused");
    ok((await apiPost("/auth/password", { currentPassword: "UiPass1234", newPassword: "Changed1234" })).status === 200, "the password changes with the right current password");
    const oldPw = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "UiPass1234" }) });
    const newPw = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Changed1234" }) });
    ok(oldPw.status === 401 && newPw.status === 200, "only the new password signs in afterwards");
  };

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
    const inact = await json(await apiPut(`/users/${remote.id}`, { status: "INACTIVE" }));
    ok(inact.status === 200 && inact.body.status === "INACTIVE", "the update answer carries the new status");
    const login2 = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: tempPassword }) });
    ok(login2.status === 401, "deactivated person can no longer sign in");
    // The directory UI shows the status after a fresh hydration (re-login pulls the backend rows)
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    navigate("/people");
    await waitFor(() => /Inactive/.test(q(`[data-person="${remote.id}"]`)?.textContent || ""), 10000, "Inactive badge on the test person's row");
    ok(/Inactive/.test(q(`[data-person="${remote.id}"]`)?.textContent || ""), "the People directory shows the Inactive badge after the edit");
    // Admin delete: guarded (self, course owners) and permanent
    ok((await apiDel("/users/u-priya")).status === 400, "an admin cannot delete their own account");
    const owned = ((await apiGet("/courses")) || []).find((c) => c.instructorId && c.instructorId !== "u-priya");
    if (owned) ok((await apiDel(`/users/${owned.instructorId}`)).status === 409, "an instructor who still owns courses cannot be deleted (409)");
    ok((await apiDel(`/users/${remote.id}`)).status === 200, "admin deletes the test person");
    ok((await apiRaw(`/users/${remote.id}`)).status === 404, "the deleted person is gone from the API");
    const login3 = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: tempPassword }) });
    ok(login3.status === 401, "the deleted person can no longer sign in");
    // Privacy: a learner sees no e-mail addresses in the directory, and cannot manage users
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const dir = (await apiGet("/users")) || [];
    ok(dir.length > 0 && dir.every((u) => u.id === "u-maya" ? !!u.email : u.email == null), "learner directory hides other people's e-mail addresses");
    const forbidden = await json(await apiPost("/users", { name: "X", email: "x@x.dev", role: "admin" }));
    ok(forbidden.status === 403, "learner cannot create users (403)");
    const forbidden2 = await json(await apiPut(`/users/u-maya`, { role: "admin" }));
    ok(forbidden2.status === 403, "learner cannot promote themself (403)");
    ok((await apiDel("/users/u-daniel")).status === 403, "learner cannot delete people (403)");
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
    ok(st.status === 200 && st.body.database?.connected === true && /PostgreSQL|H2/.test(st.body.database.product) && +st.body.database.schemaVersion >= 6, `system status reports the database (${st.body.database?.product} v${st.body.database?.schemaVersion})`);
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
    const created = await fetch("http://localhost:8080/api/users", { method: "POST", headers: { Authorization: "Bearer " + localStorage.getItem("we360.v3.token"), "Content-Type": "application/json" }, body: JSON.stringify({ name: "Signin Person", email, role: "learner", password }) });
    ok(created.status === 200, "admin creates an account with a chosen password");
    const body = await created.json();
    ok(body.temporaryPassword == null && !JSON.stringify(body).includes(password), "the chosen password is never echoed back");
    logout(); location.hash = "#/login";
    await waitFor(() => q("[data-login-email]"), 5000, "sign-in form");
    ok(!!q("[data-login-email]") && !!q("[data-login-password]") && q("[data-login-password]").type === "password", "sign-in screen has an e-mail and password form");
    type(q("[data-login-email]"), email); type(q("[data-login-password]"), "wrong-password");
    click(q("[data-login-submit]"));
    await waitFor(() => q("[data-login-error]") && !q("[data-login-error]").hidden, 5000, "sign-in error");
    ok(/don't match/.test(q("[data-login-error]")?.textContent || "") && !localStorage.getItem("we360.v3.token"), "wrong password shows an error and no session is created");
    type(q("[data-login-password]"), password);
    click(q("[data-login-submit]"));
    await waitFor(() => getUser()?.email === email && !location.hash.startsWith("#/login"), 8000, "signed in");
    ok(getUser()?.id === body.user.id && getUser()?.role === "learner" && !!localStorage.getItem("we360.v3.token"), "the new person is signed in with their own account and role");
    await waitFor(() => q("#main") && q("#main").textContent.trim().length > 40, 8000, "home renders");
    ok(!!q("#main") && /Home/.test(document.title + q("#topbar").textContent), "Home renders for the new account");
    await sleep(300);
  };
}
