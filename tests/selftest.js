// In-browser interaction tests. Run: index.html?as=<role>&selftest=<suite>  (results are written into #selftest-out).
import { guideEngine } from "/src/guide/GuideEngine.js";
import { navigate } from "/src/router.js";

const out = document.createElement("pre");
out.id = "selftest-out";
out.style.cssText = "position:fixed;left:0;bottom:0;z-index:9999;background:#000;color:#0f0;font:11px monospace;margin:0;padding:6px;max-height:40vh;overflow:auto;display:none";
document.body.appendChild(out);
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: "*,*::before,*::after{transition:none!important;animation:none!important}" }));
const log = (...a) => { const line = a.join(" "); out.textContent += line + "\n"; fetch("/__log", { method: "POST", body: line, keepalive: true }).catch(() => {}); };
let fails = 0;
window.addEventListener("error", (e) => log("PAGEERROR", e.message, e.filename + ":" + e.lineno));
window.addEventListener("unhandledrejection", (e) => log("REJECTION", e.reason?.stack || e.reason));
const ok = (cond, msg) => { if (!cond) fails++; log(cond ? "PASS" : "FAIL", msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => document.querySelector(sel);
async function waitFor(fn, ms = 4000, label = "condition") {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await sleep(50); }
  log("TIMEOUT waiting for", label);
  return null;
}
const type = (el, value) => { el.focus(); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); };
const click = (sel) => { const el = typeof sel === "string" ? q(sel) : sel; if (!el) { log("MISSING", sel); return false; } el.click(); return true; };

const suites = {
  async guide() {
    navigate("/courses");
    await waitFor(() => q('[data-guide-target="courses.new"]'), 4000, "courses page");
    click('[data-guide-launch="create-first-course"]');
    await waitFor(() => guideEngine.isOpen(), 2000, "guide open");
    ok(guideEngine.isOpen() && document.body.classList.contains("guide-open"), "guide opens with body.guide-open");
    ok(!!q(".guide-panel"), "guide panel rendered");
    ok(guideEngine.state.misroute, "step 1 reports misroute on the courses screen");
    await sleep(700);
    const frame = q("#frame").getBoundingClientRect(), panel = q("#guide-root").getBoundingClientRect();
    ok(panel.width > frame.width * 0.28 && panel.width < frame.width * 0.4, `guide panel is ~1/3 wide (${Math.round(panel.width)}/${Math.round(frame.width)})`);
    guideEngine.goToStepRoute();
    await waitFor(() => location.hash.startsWith("#/builder/") && q('[data-guide-target="course.name"]'), 3000, "builder");
    await sleep(300);
    ok(!guideEngine.state.misroute, "misroute clears inside the builder");
    ok(guideEngine.state.stepIndex === 0, "on step 1");
    const hole = q(".guide-hole");
    ok(hole && !hole.hidden, "spotlight visible on course name");
    const tr = q('[data-guide-target="course.name"]').getBoundingClientRect(), hr = hole.getBoundingClientRect();
    ok(Math.abs(hr.left - (tr.left - 6)) < 3 && Math.abs(hr.top - (tr.top - 6)) < 3, "spotlight aligned to target");
    // Next must not advance without the action
    click('[data-key="next"]');
    await sleep(200);
    ok(guideEngine.state.stepIndex === 0, "Next is disabled until the action is performed");
    type(q('[data-guide-target="course.name"]'), "Handling Objections");
    await waitFor(() => guideEngine.state.stepIndex === 1, 3000, "step 2");
    ok(guideEngine.state.stepIndex === 1, "typing a course name completes step 1");
    click('[data-guide-target="course.add-module"]');
    await waitFor(() => guideEngine.state.stepIndex === 2, 3000, "step 3");
    ok(guideEngine.state.stepIndex === 2, "adding a module completes step 2");
    click('[data-guide-target="course.add-lesson"]');
    await waitFor(() => guideEngine.state.stepIndex === 3, 3000, "step 4");
    ok(guideEngine.state.stepIndex === 3, "adding a lesson completes step 3");
    log("DBG before preview: step", guideEngine.state.stepIndex, "done", guideEngine.state.stepDone, "btn:", q('[data-guide-target="course.preview"]')?.textContent);
    click('[data-guide-target="course.preview"]');
    await sleep(300);
    log("DBG after preview: step", guideEngine.state.stepIndex, "done", guideEngine.state.stepDone, "btn:", q('[data-guide-target="course.preview"]')?.textContent, "misroute", guideEngine.state.misroute);
    await waitFor(() => guideEngine.state.stepIndex === 4, 3000, "step 5");
    ok(guideEngine.state.stepIndex === 4, "previewing completes step 4");
    ok(q('[data-guide-target="course.publish"]'), "publish target still present in preview mode");
    click('[data-guide-target="course.publish"]');
    await waitFor(() => guideEngine.state.finished, 3000, "guide finished");
    ok(guideEngine.state.finished, "publishing completes the guide");
    ok(!!q(".guide-complete"), "completion screen shown");
    ok(JSON.parse(localStorage.getItem("we360.v3.guideProgress"))["u-daniel"].guides["create-first-course"].status === "completed", "progress persisted as completed");
  },
};

const name = new URLSearchParams(location.search).get("selftest");
window.__suites = suites;
// Suite modules are registered before the run starts, so a slow module load (busy dev server) can't leave the
// requested suite unregistered ("suites[name] is not a function").
const ready = Promise.all([
  import("./suites_video.js").then((m) => {
    m.register({ suites, log, ok, sleep, q, click, type, waitFor, guideEngine, navigate });
    m.registerBackend({ suites, log, ok, sleep, q, click, type, waitFor, navigate });
    m.registerLearningBackend({ suites, log, ok, sleep, q, click, type, waitFor, navigate, guideEngine });
    m.registerFinal({ suites, log, ok, sleep, q, click, type, waitFor, navigate });
  }),
  import("./suites_skills.js").then((m) => m.registerSkills({ suites, log, ok, sleep, q, click, type, waitFor, navigate })),
  import("./suites_analytics.js").then((m) => m.registerAnalytics({ suites, log, ok, sleep, q, click, type, waitFor, navigate })),
  import("./suites_ai.js").then((m) => m.registerAi({ suites, log, ok, sleep, q, click, type, waitFor, navigate })),
  import("./suites_coach.js").then((m) => m.registerCoach({ suites, log, ok, sleep, q, click, type, waitFor, navigate })),
  import("./suites_commerce.js").then((m) => m.registerCommerce({ suites, log, ok, sleep, q, click, type, waitFor, navigate })),
  import("./suites_agent.js").then((m) => m.registerAgent({ suites, log, ok, sleep, q, click, type, waitFor, navigate })),
  import("./suites_platform.js").then((m) => { m.registerPlatform({ suites, log, ok, sleep, q, click, type, waitFor, navigate }); m.registerResponsive({ suites, log, ok, sleep, waitFor }); m.registerAccountLogin({ suites, ok, sleep, q, click, type, waitFor }); }),
]).catch((e) => log("ERROR loading suite modules:", e.message));
(async () => {
  await ready;
  await sleep(600);
  try { await suites[name](); } catch (e) { fails++; log("ERROR", e.stack || e.message); }
  log(fails ? `RESULT: ${fails} FAILED` : "RESULT: ALL PASSED");
  document.body.dataset.selftest = fails ? "fail" : "pass";
})();

suites.guidemid = async () => {
  navigate("/builder/new");
  await waitFor(() => q('[data-guide-target="course.name"]'), 3000, "builder");
  click('[data-guide-launch="create-first-course"]');
  await sleep(300);
  type(q('[data-guide-target="course.name"]'), "Handling Customer Objections");
  await waitFor(() => guideEngine.state.stepIndex === 1, 3000);
  click('[data-guide-target="course.add-module"]');
  await waitFor(() => guideEngine.state.stepIndex === 2, 3000);
  await sleep(500);
  log("guidemid ready");
};

// Smoke test: visit every route for a role and report thrown errors / empty pages.
suites.smoke = async () => {
  const role = new URLSearchParams(location.search).get("as");
  const paths = {
    learner: ["/", "/my-learning", "/explore", "/explore/c-crm", "/learn/c-crm", "/learn/c-sales", "/journeys", "/skills", "/achievements", "/certificates", "/notifications", "/community", "/verify/WE360-2026-MAYA01", "/verify/BOGUS", "/nope"],
    instructor: ["/", "/courses", "/assessments", "/learners", "/community", "/analytics", "/explore/c-crm", "/notifications"],
    admin: ["/", "/courses", "/people", "/skills", "/community", "/certifications", "/analytics", "/automation", "/integrations", "/settings"],
  }[role];
  for (const p of paths) {
    navigate(p);
    await sleep(700);
    const main = q("#main");
    const text = (main?.innerText || "").trim();
    const isErr = /hit an unexpected problem|Something went wrong/.test(text);
    ok(text.length > 40 && !isErr, `route ${p} renders (${text.length} chars)${isErr ? " ERROR STATE" : ""}`);
  }
};

suites.learnerguide = async () => {
  navigate("/");
  await waitFor(() => q('[data-guide-launch="first-lesson"]'), 3000, "dashboard guide button");
  click('[data-guide-launch="first-lesson"]');
  await sleep(500);
  ok(guideEngine.isOpen(), "learner guide opens");
  click('[data-guide-target="nav.explore"]');
  await waitFor(() => guideEngine.state.stepIndex === 1, 3000, "step 2");
  ok(guideEngine.state.stepIndex === 1, "opening Explore completes step 1");
  await waitFor(() => q('[data-guide-target="explore.first-course"]'), 3000, "catalog card");
  const card = q('[data-guide-target="explore.first-course"]');
  ok(!card.textContent.includes("Sales Foundations"), "guide targets the first unfinished course, not the completed one");
  click(card);
  await waitFor(() => guideEngine.state.stepIndex === 2, 3000, "step 3");
  ok(guideEngine.state.stepIndex === 2, "opening a course completes step 2");
  click('[data-guide-target="course.start"]');
  await waitFor(() => guideEngine.state.stepIndex === 3, 3000, "step 4");
  ok(guideEngine.state.stepIndex === 3, "starting the course completes step 3");
  await waitFor(() => q('[data-guide-target="player.complete"]'), 3000, "mark complete");
  click('[data-guide-target="player.complete"]');
  await waitFor(() => guideEngine.state.finished, 3000, "finished");
  ok(guideEngine.state.finished, "completing a lesson finishes the learner guide");
  ok(!!q(".complete-card"), "completion loop card visible in the app while guide is open");
};

suites.player = async () => {
  navigate("/learn/c-crm");
  await waitFor(() => q('[data-guide-target="player.complete"]'), 3000, "player");
  const before = q(".player-outline").textContent;
  ok(/Forecasting with confidence/.test(q(".player-top").textContent), "resumes at the next unfinished lesson");
  click('[data-guide-target="player.complete"]');
  await waitFor(() => q(".complete-card"), 2000, "completion card");
  const txt = q(".complete-card").textContent;
  ok(/Course progress 50% → 67%/.test(txt), "progress updates 50% → 67% (" + (txt.match(/Course progress[^N]*/) || [""])[0].slice(0, 40) + ")");
  ok(/Next lesson unlocked/.test(txt), "next lesson unlocked");
  ok(/Learning journey updated/.test(txt), "learning journey updated");
  ok(/CRM skill \+/.test(txt), "skill progress updated");
  ok(!q('[data-guide-target="player.complete"]') && q('[data-guide-target="player.next"]'), "primary action becomes Next lesson");
  ok(!/Automating follow-ups[\s\S]*Lock/.test(q(".player-outline").innerHTML) , "outline refreshed");
  // discussion without leaving the lesson
  const hashBefore = location.hash;
  click('[data-guide-target="player.discussion"]');
  await waitFor(() => q(".drawer"), 2000, "drawer");
  const drawer = q(".drawer");
  const title = drawer.querySelector('input[aria-label="Title"]');
  type(title, "How do you defend a commit forecast?");
  [...drawer.querySelectorAll("button")].find((b) => b.textContent.trim() === "Post").click();
  await sleep(200);
  ok(/How do you defend a commit forecast\?/.test(q(".drawer").textContent), "lesson discussion post appears in the drawer");
  ok(location.hash === hashBefore, "posted without leaving the lesson");
};

suites.quiz = async () => {
  navigate("/learn/c-sec");
  await waitFor(() => q('[data-guide-target="player.complete"]'), 3000, "lesson 1");
  click('[data-guide-target="player.complete"]');
  await sleep(200);
  click('[data-guide-target="player.next"]');
  await waitFor(() => /Report it fast/.test(q(".player-top")?.textContent || ""), 3000, "lesson 2");
  click('[data-guide-target="player.complete"]');
  await sleep(200);
  click('[data-guide-target="player.next"]');
  await waitFor(() => q(".quiz"), 3000, "quiz");
  const pick = (text) => [...document.querySelectorAll(".qopt")].find((l) => l.textContent.includes(text)).querySelector("input").click();
  const act = (kind) => q(`[data-quiz-action="${kind}"]`).click();
  ok(q('[data-quiz-action="check"]').disabled, "Check answer is disabled until an option is chosen");
  pick("Report it as phishing"); await sleep(50); act("check"); await sleep(50);
  ok(!!q(".qfeedback.is-correct"), "correct answer shows positive feedback");
  act("next"); await sleep(50);
  pick("Generic greeting"); pick("Mismatched link"); pick("Unusual urgency"); await sleep(50);
  act("check"); await sleep(50); act("next"); await sleep(100);
  ok(/You passed/.test(q(".quiz").textContent), "quiz result shows pass");
  ok(!!q('[data-guide-target="quiz.continue"]'), "recommended next action offered");
  await sleep(200);
  ok(!!q(".just-unlocked") || /Nice work|Lesson complete/.test(q("#main").textContent), "passing completes the lesson");
};

suites.community = async () => {
  // Sign-in hydration re-renders list pages once it lands; wait for that to settle before interacting, as a person would.
  const { bus } = await import("/src/lib/events.js");
  let lastRoute = Date.now(); const off = bus.on("route", () => (lastRoute = Date.now()));
  await waitFor(() => localStorage.getItem("we360.v3.token"), 8000, "backend session");
  await waitFor(() => Date.now() - lastRoute > 2000, 12000, "post-login hydration settled");
  navigate("/community");
  await waitFor(() => Date.now() - lastRoute > 1200, 8000, "community page settled"); off();
  await waitFor(() => q(".post"), 3000, "feed");
  ok(document.querySelectorAll(".post").length >= 5, "feed renders posts");
  ok(q(".post").textContent.includes("Pinned"), "pinned discussions float to the top");
  const title = q('input[aria-label="Title"]');
  type(title, "Test discussion from selftest");
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Post").click();
  await sleep(200);
  ok(/Test discussion from selftest/.test(q("#main").textContent), "new discussion appears in the feed");
  const search = q('input[aria-label="Search conversations"]');
  type(search, "pricing");
  await sleep(100);
  const hits = [...document.querySelectorAll(".post")];
  ok(hits.length >= 1 && hits.every((p) => /pricing/i.test(p.textContent)), "search filters conversations (" + hits.length + " match(es), all containing 'pricing')");
  const post = q(".post");
  [...post.querySelectorAll("button")].find((b) => /repl/.test(b.textContent)).click();
  await sleep(100);
  const input = post.querySelector('input[aria-label="Write a reply…"]');
  type(input, "Great question!");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await sleep(100);
  ok(/Great question!/.test(q(".post").textContent), "comment appears under the post");
};

suites.builder = async () => {
  navigate("/builder/new");
  await waitFor(() => q('[data-guide-target="course.name"]'), 3000, "builder");
  const btn = (label) => [...document.querySelectorAll("button, a.btn")].find((b) => b.textContent.trim() === label);
  // publishing an empty course is blocked with a helpful list
  click('[data-guide-target="course.publish"]');
  await sleep(150);
  ok(/Not ready to publish/.test(q(".modal")?.textContent || ""), "publishing an empty course shows readiness blockers");
  btn("Got it").click(); await sleep(100);
  type(q('[data-guide-target="course.name"]'), "Selftest Course");
  click('[data-guide-target="course.add-module"]'); await sleep(100);
  click('[data-guide-target="course.add-module"]'); await sleep(100);
  ok(document.querySelectorAll(".mod").length === 2, "two modules added");
  click('[data-guide-target="course.add-lesson"]'); await sleep(150);
  ok(!!q(".lesson-title-input"), "adding a lesson opens the lesson editor");
  // add blocks via the menu
  btn("Add content block").click(); await sleep(60);
  [...document.querySelectorAll(".menu-item")].find((i) => i.textContent.includes("Knowledge check")).click(); await sleep(100);
  ok(!!q(".qeditor"), "knowledge-check block editor rendered");
  const prompt = q(".qeditor textarea");
  type(prompt, "What is 2+2?");
  const opts = [...document.querySelectorAll('.qeditor input[aria-label^="Option"]')];
  type(opts[0], "4"); type(opts[1], "5"); type(opts[2], "6");
  // preview shows the block as a learner would
  click('[data-guide-target="course.preview"]'); await sleep(200);
  ok(!!q(".preview") && /What is 2\+2\?/.test(q(".preview").textContent), "preview renders the knowledge check");
  click('[data-guide-target="course.preview"]'); await sleep(100);
  ok(!q(".preview") && !!q(".outline"), "Back to editing restores the editor");
  // quiz lesson
  const dd = [...document.querySelectorAll('button[aria-label="Add another lesson type"]')][0];
  dd.click(); await sleep(60);
  [...document.querySelectorAll(".menu-item")].find((i) => i.textContent.trim() === "Quiz").click(); await sleep(150);
  ok(/Assessment settings/.test(q(".canvas").textContent), "quiz lesson editor shown");
  // publish succeeds
  click('[data-guide-target="course.publish"]'); await sleep(200);
  ok(/Published/.test(q('[data-guide-target="course.publish"]').textContent), "publish button reflects published state");
  const saved = JSON.parse(localStorage.getItem("we360.v3.courses")).find((c) => c.title === "Selftest Course");
  ok(saved && saved.status === "published" && saved.modules.length === 2, "course persisted to storage");
  ok(saved.modules[0].lessons.length === 2 && saved.modules[0].lessons[0].blocks.some((b) => b.type === "knowledge"), "lessons and blocks persisted");
  // now visible in the catalog for learners
  navigate("/courses"); await sleep(600);
  ok(/Selftest Course/.test(q("#main").textContent), "new course listed in My Courses");
};

suites.builderlesson = async () => {
  navigate("/builder/c-crm");
  await waitFor(() => q(".lesson-btn"), 3000, "builder");
  await sleep(200);
  [...document.querySelectorAll(".lesson-btn")][0].click();
  await sleep(300);
};

suites.persist = async () => {
  if (!sessionStorage.getItem("persist-phase")) {
    navigate("/builder/new");
    await waitFor(() => q('[data-guide-target="course.name"]'), 3000, "builder");
    click('[data-guide-launch="create-first-course"]');
    await sleep(300);
    type(q('[data-guide-target="course.name"]'), "Persisted Course");
    await waitFor(() => guideEngine.state.stepIndex === 1, 3000, "step 2");
    sessionStorage.setItem("persist-phase", "1");
    sessionStorage.setItem("persist-hash", location.hash);
    location.reload();
    await sleep(60000);
  } else {
    await sleep(500);
    ok(guideEngine.isOpen(), "guide panel is restored after a full reload");
    ok(guideEngine.state.stepIndex === 1, "guide resumes at the same step (" + guideEngine.state.stepIndex + ")");
    ok(location.hash === sessionStorage.getItem("persist-hash"), "route preserved");
    ok(/Persisted Course/.test(q('[data-guide-target="course.name"]')?.value || ""), "course title persisted");
    const hole = q(".guide-hole");
    ok(hole && !hole.hidden, "spotlight re-attaches to the target");
    sessionStorage.removeItem("persist-phase");
  }
};
