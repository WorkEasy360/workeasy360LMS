// Learning Coach + recommendations + learning plans (run one at a time: index.html?as=learner&selftest=<suite>).
// Runs against the backend's deterministic mock provider (AI_ENABLED=false); the recommendation engine itself never
// uses AI.
import { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, load } from "/src/lib/store.js";
import { bus } from "/src/lib/events.js";

export function registerCoach({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v2.token");
  const apiRaw = (path, opts = {}) => fetch("http://localhost:8080/api" + path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });
  const apiGet = (path) => apiRaw(path).then((r) => (r.ok ? r.json() : null));
  const apiPost = (path, body) => apiRaw(path, { method: "POST", body: JSON.stringify(body || {}) });
  const ask = async (text, lessonId, conversationId) => { const r = await apiPost("/coach/message", { text, lessonId, conversationId }); return { status: r.status, body: await r.json().catch(() => null) }; };
  // After sign-in the app hydrates courses → learning → skills and then re-renders list pages (Home). Wait for that
  // to land before interacting with Home, exactly as a real session does.
  let lastRoute = 0; bus.on("route", () => (lastRoute = Date.now()));
  const settled = async () => {
    await waitFor(() => load("userSkills").some((r) => r.userId === "u-maya"), 10000, "post-login hydration");
    const t0 = Date.now(); // the post-hydration re-render (a route dispatch) can trail the last hydration step slightly
    await waitFor(() => Date.now() - Math.max(lastRoute, t0) > 1500, 10000, "route quiet period");
  };
  /** Waits until the page's main content element has not been replaced for `quietMs` (i.e. no re-mount is pending). */
  const stable = async (quietMs = 1500) => { let el = q("#main")?.firstElementChild, since = Date.now(); await waitFor(() => { const cur = q("#main")?.firstElementChild; if (cur !== el) { el = cur; since = Date.now(); } return Date.now() - since > quietMs; }, 12000, "stable page"); };

  // Context: compact, bounded, own data only, no secrets.
  suites.coachContext = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const c = await apiGet("/coach/context");
    ok(!!c && c.learner?.id === "u-maya" && Array.isArray(c.courses) && Array.isArray(c.skills) && Array.isArray(c.journeys) && Array.isArray(c.recommendations), "context assembles learner, courses, skills, journeys and recommendations");
    ok(c.courses.length <= 12 && c.availableCourses.length <= 8 && c.recentActivity.length <= 6 && c.skills.length <= 10, "context lists are bounded");
    const s = JSON.stringify(c).toLowerCase();
    ok(!s.includes("password") && !s.includes("token") && !s.includes("apikey") && !s.includes("u-omar") && !s.includes("u-sam"), "context carries no credentials and no other learner's data");
    const inProg = c.courses.find((x) => x.status === "in-progress");
    ok(!!inProg && inProg.nextLesson?.lessonId && typeof inProg.pct === "number" && inProg.done <= inProg.total, "in-progress course carries progress numbers and its next lesson: " + inProg?.title);
    ok(c.skills.every((k) => k.name && k.level && typeof k.gapPct === "number"), "skills carry level labels and gaps from the Skills Engine");
    ok(c.aiProvider === "mock" && c.aiAvailable === true, "context reports the AI provider (mock) availability");
  };

  // Deterministic recommendations on Home: one next step + explained cards, without AI.
  suites.recommendations = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const recs = await apiGet("/recommendations");
    ok(Array.isArray(recs) && recs.length >= 1 && recs.length <= 5, `backend returns ${recs?.length} recommendations (max 5)`);
    ok(recs.every((r) => r.title && r.reason && r.type && r.href && Array.isArray(r.facts)), "every recommendation has a title, type, reason, facts and a link");
    ok(recs.every((r) => /\d/.test(r.reason) || /available|published|journey|expir/i.test(r.reason)), "reasons cite concrete learner facts (numbers, lessons, journeys)");
    ok(!recs.some((r) => "priority" in r || "signals" in r || "score" in r), "no unexplained numeric score is exposed to the learner");
    const cont = recs.find((r) => r.type === "CONTINUE_COURSE" || r.type === "COMPLETE_LESSON" || r.type === "ASSESSMENT" || r.type === "PRACTICE");
    ok(!!cont && /\/learn\/[^/]+\/l-/.test(cont.href) && /of \d+ lessons|One lesson left|next step/.test(cont.reason), "an incomplete course yields a Continue-style recommendation pointing at the exact next lesson");
    const c = await apiGet("/coach/context");
    const course = c.courses.find((x) => x.courseId === cont.courseId);
    ok(course && course.nextLesson.lessonId === cont.lessonId, "the Continue recommendation targets the learner's real next lesson (" + course?.nextLesson?.title + ")");
    const gap = recs.find((r) => r.type === "SKILL_GAP");
    if (gap) ok(gap.skillName && gap.courseId && /proficiency is|target/.test(gap.reason), "skill-gap recommendation names the skill, its level and a matching course: " + gap.title);
    else log("NOTE: no SKILL_GAP card in the top 5 for this learner right now (" + recs.map((r) => r.type).join(",") + ")");
    await settled();
    navigate("/"); await waitFor(() => q('[data-home-recs="backend"]') && T("home.next-step"), 8000, "home next step"); await stable();
    await waitFor(() => q('[data-home-recs="backend"]') && T("home.next-step"), 8000, "home next step after the page settled"); // a post-login re-mount reloads the card asynchronously
    ok(T("home.next-step")?.dataset.recId === recs[0].id, "Home's “Your next step” is the top-ranked recommendation: " + recs[0].title);
    ok(/Why:/.test(T("home.next-step").textContent) && !!T("rec.reason"), "next step shows the human-readable reason");
    const cards = document.querySelectorAll("[data-rec-card]").length;
    ok(cards === Math.min(4, recs.length - 1) && cards <= 4, `“Recommended for you” shows ${cards} cards (never more than 5 recommendations in total)`);
    click(T("rec.cta")); await sleep(500);
    ok(location.hash === "#" + recs[0].href, "primary CTA opens the recommendation's target (" + recs[0].href + ")");
  };

  // Feedback: dismissed recommendation is not shown again; helpful is recorded.
  suites.recommendationFeedback = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD); await settled();
    navigate("/"); await waitFor(() => q('[data-home-recs="backend"]') && q("[data-rec-card]"), 8000, "home cards"); await stable();
    await waitFor(() => q("[data-rec-card]"), 8000, "home cards after settle");
    const card = q("[data-rec-card]"); const id = card.dataset.recCard;
    click(card.querySelector('[data-rec-feedback="HELPFUL"]')); await sleep(400);
    let recs = await apiGet("/recommendations");
    ok(recs.find((r) => r.id === id)?.feedback === "HELPFUL", "Helpful feedback is persisted on the recommendation");
    click(card.querySelector('[data-rec-feedback="DISMISSED"]')); await waitFor(() => !q(`[data-rec-card="${id}"]`), 4000, "card removed");
    ok(!q(`[data-rec-card="${id}"]`), "dismissed card leaves the list (card: " + (q(`[data-rec-card="${id}"]`)?.className || "gone") + "; connected: " + card.isConnected + "; toasts: " + [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim().slice(0, 60)).join(" | ") + ")");
    recs = await apiGet("/recommendations");
    ok(!recs.some((r) => r.id === id), "dismissed recommendation is not recommended again on the next refresh");
    navigate("/skills"); await sleep(300); navigate("/"); await waitFor(() => q('[data-home-recs="backend"]'), 8000, "home again");
    ok(!q(`[data-rec-card="${id}"]`) && T("home.next-step")?.dataset.recId !== id, "still hidden after navigating away and back");
    const other = await apiPost(`/recommendations/${id}/feedback`, { value: "WHATEVER" });
    ok(other.status === 400, "invalid feedback value is rejected (400)");
  };

  // Coach: grounded answers with verified actions; a plan request yields a structured, persisted plan.
  suites.coachConversation = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate("/coach"); await waitFor(() => q('[data-coach-state="ready"]') && T("coach.input"), 8000, "coach page");
    ok(!!T("coach.snapshot") && !!T("coach.recommendation"), "coach shows a progress snapshot and the primary recommendation");
    [...document.querySelectorAll("button")].find((b) => /New chat/.test(b.textContent)).click(); await sleep(100); // start fresh (earlier conversations are restored by default)
    ok(document.querySelectorAll("[data-coach-prompt]").length >= 4, "suggested prompts are offered");
    type(T("coach.input"), "What should I learn next?"); click(T("coach.send"));
    await waitFor(() => document.querySelectorAll('[data-coach-msg="COACH"]').length >= 1, 15000, "coach reply");
    const recs = await apiGet("/recommendations");
    const reply = q('[data-coach-msg="COACH"]').textContent;
    ok(reply.includes(recs[0].title), "reply is grounded in the top deterministic recommendation: " + recs[0].title);
    ok(!!q('[data-coach-action="CONTINUE_LESSON"], [data-coach-action="VIEW_COURSE"]'), "reply offers a structured action button");
    type(T("coach.input"), "Create a 20-minute learning plan."); click(T("coach.send"));
    await waitFor(() => document.querySelectorAll('[data-coach-msg="COACH"]').length >= 2, 15000, "plan reply");
    ok(/20-minute plan/.test(document.querySelectorAll('[data-coach-msg="COACH"]')[1].textContent) && !!q('[data-coach-action="START_PLAN"]'), "coach returns a structured 20-minute plan with a Start action");
    const plans = await apiGet("/learning-plans");
    const plan = plans[0];
    ok(plan && plan.minutes === 20 && plan.source === "COACH" && plan.items.length >= 1 && plan.items.every((i) => i.kind && i.minutes > 0 && i.title), "plan is persisted with typed items and minutes");
    const c = await apiGet("/coach/context");
    ok(plan.items.filter((i) => i.lessonId).every((i) => c.courses.some((x) => x.courseId === i.courseId)), "plan items reference the learner's own courses/lessons only");
    click(q('[data-coach-action="START_PLAN"]')); await waitFor(() => q('[data-plan-status="ACTIVE"]'), 6000, "active plan card");
    ok(!!q('[data-plan-status="ACTIVE"]'), "starting the plan from the coach activates it in the snapshot");
    const convs = await apiGet("/coach/conversations");
    const full = await apiGet(`/coach/conversations/${convs[0].id}`);
    ok(full.messages.length === 4 && full.messages[1].role === "COACH" && full.messages[1].generationId, "conversation persists both turns with the AI audit reference");
    const gen = await apiGet(`/ai/generations/${full.messages[1].generationId}`);
    ok(gen?.type === "COACH" && gen.promptVersion === "learning-coach-v1" && gen.provider === "mock", "each coach turn is audited (type COACH, prompt learning-coach-v1)");
  };

  // Coach: lesson context grounds explanations in the actual lesson content.
  suites.coachLessonContext = async () => {
    // A real backend-synced course (the demo catalogue's local lessons don't exist on the backend, by design of the demo seed).
    const { courseId, lessonId } = await suites.__createMappedCourse("lesson", undefined, 20);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD); await settled();
    const tree = await apiGet(`/courses/${courseId}`);
    const lesson = tree.modules[0].lessons.find((l) => l.id === lessonId);
    navigate(`/explore/${courseId}`); await waitFor(() => T("course.start"), 6000, "course page");
    click(T("course.start")); await waitFor(() => T("player.coach"), 6000, "player coach button");
    click(T("player.coach")); await waitFor(() => q('[data-coach-state="ready"]'), 8000, "coach with lesson");
    [...document.querySelectorAll("button")].find((b) => /New chat/.test(b.textContent)).click(); await sleep(100);
    ok(/Learning: /.test(T("coach.snapshot").textContent) && T("coach.snapshot").textContent.includes(lesson.title), "coach knows the current lesson: " + lesson.title + " (hash " + location.hash.slice(0, 40) + "; snapshot: " + T("coach.snapshot").textContent.replace(/\s+/g, " ").slice(0, 90) + ")");
    ok([...document.querySelectorAll("[data-coach-prompt]")].some((b) => /Explain this lesson/.test(b.textContent)), "lesson-specific prompts are offered");
    [...document.querySelectorAll("[data-coach-prompt]")].find((b) => /Explain this lesson/.test(b.textContent)).click();
    await waitFor(() => q('[data-coach-msg="COACH"]'), 15000, "explanation");
    const reply = q('[data-coach-msg="COACH"]').textContent;
    const firstWords = (lesson.content?.find((b) => b.text)?.text || "").replace(/\*\*/g, "").split(/\s+/).slice(0, 4).join(" ");
    ok(reply.includes(lesson.title) && (firstWords ? reply.includes(firstWords) : true), "explanation references the actual lesson title and content");
    const forbidden = await ask("Explain this lesson simply", "l-does-not-exist");
    ok(forbidden.status === 403, "a lesson outside the learner's access is refused (" + forbidden.status + ")");
  };

  // Grounding: no invented ids — actions only reference accessible entities; unavailable data is stated, not invented.
  suites.coachGrounding = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const c = await apiGet("/coach/context");
    const allowedCourses = new Set([...c.courses.map((x) => x.courseId), ...c.availableCourses.map((x) => x.courseId)]);
    for (const qText of ["Help me improve my weakest skill.", "What am I behind on?", "Summarize my learning progress.", "Which course helps me improve CRM?"]) {
      const r = await ask(qText);
      ok(r.status === 200 && r.body.coach.content.length > 20, `“${qText}” → grounded reply (${r.status})`);
      const actions = r.body.coach.actions || [];
      ok(actions.every((a) => (!a.courseId || allowedCourses.has(a.courseId)) && (!a.skillId || c.skills.some((k) => k.skillId === a.skillId)) && (!a.pathId || c.journeys.some((j) => j.id === a.pathId || j.pathId === a.pathId))), "all action ids exist in the learner's accessible context");
    }
    const weakest = [...c.skills].sort((a, b) => b.gapPct - a.gapPct)[0];
    const r = await ask("Help me improve my weakest skill.");
    ok(r.body.coach.content.includes(weakest.name) && r.body.coach.content.includes(weakest.level), "weakest-skill answer cites the real skill and level: " + weakest.name + " / " + weakest.level);
  };

  // RBAC / ownership: a learner cannot read or act on another learner's coach data, recommendations or plans.
  suites.coachRbac = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const mine = await ask("What should I learn next?");
    const convId = mine.body.conversationId;
    const recs = await apiGet("/recommendations");
    const plan = await (await apiPost("/learning-plans", { minutes: 15 })).json();
    // switch to another learner (Sam) — the demo login only has one learner password; use the seeded account directly
    const samTok = (await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "sam@workeasy360.dev", password: DEMO_PASSWORD }) }).then((r) => r.json())).token;
    const as = (path, opts = {}) => fetch("http://localhost:8080/api" + path, { ...opts, headers: { Authorization: "Bearer " + samTok, "Content-Type": "application/json" } });
    ok((await as(`/coach/conversations/${convId}`)).status === 403, "another learner cannot read the conversation");
    ok((await as(`/coach/message`, { method: "POST", body: JSON.stringify({ conversationId: convId, text: "hi" }) })).status === 403, "another learner cannot post into the conversation");
    ok((await as(`/recommendations/${recs[0].id}/dismiss`, { method: "POST" })).status === 403, "another learner cannot dismiss the recommendation");
    ok((await as(`/learning-plans/${plan.id}`)).status === 403 && (await as(`/learning-plans/${plan.id}/start`, { method: "POST" })).status === 403, "another learner cannot read or start the plan");
    ok((await as(`/coach/conversations`)).status === 200 && !(await as(`/coach/conversations`).then((r) => r.json())).some((x) => x.id === convId), "the other learner's own list does not contain it");
    ok((await fetch("http://localhost:8080/api/coach/context")).status === 401, "unauthenticated access is refused (401)");
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    ok((await apiRaw(`/coach/conversations/${convId}`)).status === 403, "an instructor cannot read a learner's conversation (learner-private)");
    ok((await apiRaw("/analytics/overview")).status === 200, "instructor APIs keep working");
  };

  // Validation: invalid AI output → retry, safe 422, audit record retained; recommendations unaffected.
  suites.coachValidation = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const before = (await apiGet("/ai/generations")) || [];
    const r = await ask("__malformed__ what should I do next?");
    ok(r.status === 422 && /couldn't be used|not a JSON object|not valid JSON/i.test(r.body?.message || ""), "malformed coach reply → 422 with a clear message");
    const after = (await apiGet("/ai/generations")) || [];
    ok(after[0]?.id !== before[0]?.id && after[0]?.type === "COACH" && after[0]?.status === "FAILED" && !!after[0]?.error, "failed coach turn is audited as FAILED (newest generation; the list is capped at 50)");
    const recs = await apiGet("/recommendations");
    ok(recs.length >= 1, "recommendations keep working regardless of the coach failure");
    navigate("/coach"); await waitFor(() => q('[data-coach-state="ready"]'), 8000, "coach page");
    type(T("coach.input"), "__malformed__ next"); click(T("coach.send"));
    await waitFor(() => q("[data-coach-error]"), 15000, "error bubble");
    ok(!!q("[data-coach-error]") && /Try again/.test(q("[data-coach-error]").textContent), "UI shows a recoverable error in the thread");
  };

  // Learning plan: manual plan lifecycle with lesson-backed completion.
  suites.learningPlan = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const c = await apiGet("/coach/context");
    const course = c.courses.find((x) => x.status === "in-progress" && x.nextLesson);
    const plan = await (await apiPost("/learning-plans", { minutes: 30, courseId: course.courseId })).json();
    ok(plan.status === "DRAFT" && plan.items[0].lessonId === course.nextLesson.lessonId && plan.items.reduce((n, i) => n + i.minutes, 0) <= 30, "30-minute plan starts with the course's next lesson and fits the budget");
    await settled();
    navigate("/"); await waitFor(() => q(`[data-plan="${plan.id}"]`), 8000, "plan card on Home"); await stable();
    click(q(`[data-plan="${plan.id}"] [data-plan-action="start"]`)); await waitFor(() => q(`[data-plan="${plan.id}"][data-plan-status="ACTIVE"]`), 6000, "active");
    ok(!!q(`[data-plan="${plan.id}"][data-plan-status="ACTIVE"]`), "plan can be started from Home");
    const { completeLesson } = await import("/src/services/learning.js");
    completeLesson("u-maya", course.courseId, course.nextLesson.lessonId); await sleep(1200);
    const after = await apiGet(`/learning-plans/${plan.id}`);
    ok(after.items[0].done === true, "completing the lesson through the normal progress flow marks the plan item done (no separate tracking)");
    const done = await (await apiPost(`/learning-plans/${plan.id}/complete`)).json();
    ok(done.status === "COMPLETED" && done.items.every((i) => i.done), "plan can be completed; review items close with it");
    const p2 = await (await apiPost("/learning-plans", { minutes: 10 })).json();
    const dis = await (await apiPost(`/learning-plans/${p2.id}/dismiss`)).json();
    ok(dis.status === "DISMISSED", "plan can be dismissed");
  };

  // Persistence: conversation survives reload + logout/login (backend restart verified out-of-band).
  suites.coachPersist = async () => {
    if (!sessionStorage.getItem("coach-phase")) {
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      const r = await ask("Summarize my learning progress.");
      sessionStorage.setItem("coach-phase", "1"); sessionStorage.setItem("coach-conv", r.body.conversationId); sessionStorage.setItem("coach-reply", r.body.coach.content);
      navigate("/coach"); await waitFor(() => q('[data-coach-msg="COACH"]'), 8000, "thread restored on open");
      location.reload(); await sleep(60000);
    } else {
      const id = sessionStorage.getItem("coach-conv"), reply = sessionStorage.getItem("coach-reply");
      sessionStorage.removeItem("coach-phase");
      await waitFor(() => q('[data-coach-msg="COACH"]'), 10000, "conversation after reload");
      ok(q('[data-coach-msg="COACH"]')?.textContent.includes(reply.slice(0, 40)), "after a full reload the coach page restores the persisted conversation");
      await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD); await sleep(300);
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      const full = await apiGet(`/coach/conversations/${id}`);
      ok(full && full.messages.some((m) => m.role === "COACH" && m.content === reply), "after logout/login the conversation and reply are unchanged");
      const plans = await apiGet("/learning-plans");
      ok(Array.isArray(plans), "learning plans remain readable after re-login (" + plans?.length + ")");
    }
  };
}
