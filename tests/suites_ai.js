// AI course builder / quiz generator suites (run one at a time: index.html?as=<role>&selftest=<suite>).
// They run against the backend's deterministic mock provider (AI_ENABLED=false) — no external API is called.
import { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, load } from "/src/lib/store.js";
import { flushSyncNow } from "/src/services/courseSync.js";

export function registerAi({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v2.token");
  const apiRaw = (path, opts = {}) => fetch("http://localhost:8080/api" + path, { ...opts, headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json", ...(opts.headers || {}) } });
  const apiGet = (path) => apiRaw(path).then((r) => (r.ok ? r.json() : null));
  const apiPost = (path, body) => apiRaw(path, { method: "POST", body: JSON.stringify(body) });
  const setSelect = (sel, v) => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); };
  const btn = (re, root = document) => [...root.querySelectorAll("button, a.btn")].find((b) => re.test(b.textContent.trim()));

  /** Drives the AI course builder UI end to end and returns the created draft course id. */
  async function buildCourseWithAi(topicPrefix) {
    navigate("/builder/ai"); await waitFor(() => T("ai.topic"), 4000, "AI builder");
    ok(!!q('[data-ai-phase="form"]'), "AI course builder opens on the brief form");
    await waitFor(() => q("[data-ai-provider]"), 4000, "provider status");
    ok(q('[data-ai-provider="mock"]'), "status shows the local deterministic (mock) provider — AI disabled, no external calls");
    type(T("ai.topic"), `${topicPrefix} ${Date.now()}`);
    type(q('input[aria-label="Audience"]'), "new account executives");
    type(q('textarea[aria-label="Learning objectives"]'), "Recognise the four most common objections\nRespond with the acknowledge-clarify-resolve pattern");
    type(q('input[aria-label="Source name"]'), "Sales playbook");
    type(q('textarea[aria-label="Source text"]'), "Objections are requests for more information. Acknowledge first, then clarify what is really being asked, then resolve with evidence.");
    click(T("ai.generate"));
    await waitFor(() => q('[data-ai-phase="generating"]'), 2000, "generating state");
    ok(!!q('[data-guide-target="ai.progress"]'), "generation progress is shown");
    await waitFor(() => q('[data-ai-phase="review"]') || q('[data-ai-phase="error"]'), 15000, "review state");
    ok(!!q('[data-ai-phase="review"]'), "generated outline reaches the review state");
    const genId = q("[data-ai-generation]")?.dataset.aiGeneration;
    const modulesBefore = document.querySelectorAll("[data-ai-module]").length;
    ok(modulesBefore >= 3 && !!T("ai.outline"), `outline proposes ${modulesBefore} modules (editable)`);
    ok(/Draft/.test(q("[data-ai-generation]").textContent) && /mock/.test(q("[data-ai-generation]").textContent), "provenance shows Draft status, provider and model");
    ok(/Sales playbook/.test(q("[data-ai-generation]").textContent), "provenance lists the supplied source");
    ok(/cited/.test(q('[data-ai-lesson="0.0"]')?.textContent || ""), "lesson content that used the source is marked as cited");
    // edit: rename module 1, remove one lesson from module 1
    type(q('[data-ai-module-title="0"]'), "Edited module title");
    const lessonsBefore = document.querySelectorAll('[data-ai-module="0"] [data-ai-lesson]').length;
    click(q('[data-ai-remove-lesson="0.1"]')); await sleep(100);
    ok(document.querySelectorAll('[data-ai-module="0"] [data-ai-lesson]').length === lessonsBefore - 1, "a proposed lesson can be removed before saving");
    click(T("ai.save"));
    await waitFor(() => /^#\/builder\/c-/.test(location.hash) && T("course.name"), 8000, "course builder after save");
    const courseId = location.hash.split("/")[2];
    const course = load("courses").find((c) => c.id === courseId);
    ok(!!course && course.status === "draft", "saved as a DRAFT course (never published by AI)");
    ok(course.modules[0].title === "Edited module title" && course.modules[0].lessons.length === lessonsBefore - 1, "edits made during review are what got saved");
    ok(course.modules.some((m) => m.lessons.some((l) => l.type === "quiz" && l.quiz?.questions?.length >= 3)), "quiz lessons carry generated questions");
    ok(course.modules[0].lessons[0].blocks.some((b) => b.sourceRef === "Sales playbook"), "content blocks keep source provenance");
    await flushSyncNow(courseId); await sleep(300);
    const remote = await apiGet(`/courses/${courseId}`);
    ok(remote?.status === "DRAFT" && remote.modules.length === course.modules.length, `backend has the draft with ${remote?.modules?.length} modules`);
    const gen = await apiGet(`/ai/generations/${genId}`);
    ok(gen?.status === "COMPLETED" && gen.provider === "mock" && gen.appliedCourseId === courseId && gen.promptVersion, "generation record is COMPLETED, provider mock, and linked to the applied course");
    return { courseId, genId };
  }

  // Admin: login → AI Course Builder → generate → edit → save draft.
  suites.aiCourseAdmin = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    await buildCourseWithAi("Admin AI course");
  };

  // Instructor: same flow, plus cannot generate into another instructor's course.
  suites.aiCourseInstructor = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    await buildCourseWithAi("Instructor AI course");
    const other = await apiPost("/ai/course/generate", { topic: "x", objectives: ["y"], courseId: "c-sec" });
    ok(other.status === 403, "instructor cannot generate into another instructor's course (HTTP " + other.status + ")");
  };

  // Quiz: lesson → Generate Quiz → generated questions → edit → save.
  suites.aiQuiz = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/builder/new"); await waitFor(() => location.hash.startsWith("#/builder/c-") && T("course.name"), 4000, "builder");
    const courseId = location.hash.split("/")[2];
    type(T("course.name"), "AI quiz test " + Date.now());
    click(T("course.add-module")); await sleep(200);
    document.querySelector('button[aria-label="Add another lesson type"]').click(); await sleep(100);
    [...document.querySelectorAll(".menu-item")].find((i) => /^Quiz$/i.test(i.textContent.trim())).click(); await sleep(300);
    await flushSyncNow(courseId);
    ok(!!T("quiz.ai"), "quiz editor offers “Generate with AI”");
    click(T("quiz.ai")); await waitFor(() => T("quiz.ai.generate"), 3000, "AI quiz panel");
    type(q('input[aria-label="Number of questions"]'), "4");
    setSelect(q('select[aria-label="Question type"]'), "mixed");
    type(q('textarea[aria-label="Quiz objectives"]'), "Explain the acknowledge-clarify-resolve pattern\nSpot a price objection");
    click(T("quiz.ai.generate"));
    await waitFor(() => T("quiz.ai.review") || q("[data-ai-quiz-error]"), 15000, "generated questions");
    ok(document.querySelectorAll("[data-ai-question]").length === 4, "4 questions generated for review");
    const types = [...document.querySelectorAll("[data-ai-question] .qeditor")].length;
    ok(types === 4, "each generated question opens in the existing question editor");
    // edit the first prompt, delete the last, reorder is available
    const firstPrompt = q('[data-ai-question="0"] textarea');
    type(firstPrompt, "EDITED: " + firstPrompt.value); await sleep(100);
    const last = q('[data-ai-question="3"]');
    [...last.querySelectorAll("button")].find((b) => /delete|remove/i.test(b.title || b.getAttribute("aria-label") || b.textContent)).click(); await sleep(150);
    ok(document.querySelectorAll("[data-ai-question]").length === 3, "a generated question can be deleted before accepting");
    click(T("quiz.ai.accept")); await sleep(500);
    const lesson = load("courses").find((c) => c.id === courseId).modules[0].lessons[0];
    ok(lesson.quiz.questions.length === 3 && /^EDITED: /.test(lesson.quiz.questions[0].prompt), "3 reviewed questions (with the edit) added to the lesson quiz");
    ok(lesson.quiz.questions.every((qq) => ["mc", "multi", "tf", "short"].includes(qq.type) && (qq.type !== "mc" || qq.options.some((o) => o.id === qq.answer))), "accepted questions are valid quiz-engine questions with consistent answers");
    ok(load("courses").find((c) => c.id === courseId).status === "draft", "course remains a draft");
    await flushSyncNow(courseId); await sleep(300);
    const remote = await apiGet(`/courses/${courseId}`);
    ok(remote?.modules?.[0]?.lessons?.[0]?.quiz?.questions?.length === 3, "backend lesson quiz has the 3 accepted questions");
  };

  // RBAC: a learner can neither generate nor read AI generations, and has no UI entry.
  suites.aiRbac = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const c = await apiPost("/ai/course/generate", { topic: "Anything", objectives: ["x"] });
    const qz = await apiPost("/ai/quiz/generate", { context: "Anything", objectives: ["x"], count: 3 });
    ok(c.status === 403 && qz.status === 403, `learner is refused course (${c.status}) and quiz (${qz.status}) generation`);
    const list = await apiGet("/ai/generations"); // a user may list their OWN audit rows (a learner's are coach turns only)
    ok(Array.isArray(list) && list.every((g) => g.userId === "u-maya" && g.type === "COACH"), `generation listing shows only the learner's own coach turns (${list?.length} rows, no course/quiz drafts)`);
    navigate("/builder/ai"); await sleep(600);
    ok(!T("ai.topic") && !/^#\/builder\/ai/.test(location.hash), "learner is redirected away from the AI course builder");
    ok((await apiRaw("/ai/status")).status === 200, "status endpoint is readable (no secrets in it)");
    const st = await apiGet("/ai/status");
    ok(!JSON.stringify(st).toLowerCase().includes("apikey") && !JSON.stringify(st).includes("sk-"), "status exposes no API key");
  };

  // Validation: a malformed provider reply is retried once, then reported as a recoverable error (nothing saved).
  suites.aiValidation = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    const before = (await apiGet("/ai/generations")) || [];
    const r = await apiPost("/ai/course/generate", { topic: "__malformed__ pricing", objectives: ["Handle price objections"] });
    ok(r.status === 422, "malformed AI reply → HTTP 422 (recoverable) rather than a crash (" + r.status + ")");
    const body = await r.json();
    ok(/could not be used|not valid JSON|not a JSON object/i.test(body.message || ""), "error explains the reply was unusable: " + (body.message || "").slice(0, 80));
    const after = (await apiGet("/ai/generations")) || [];
    const failed = after.find((g) => g.status === "FAILED" && /__malformed__/.test(JSON.stringify(g.input)));
    ok(after.length >= Math.min(50, before.length + 1) && !!failed && !!failed.error, "the failed attempt is recorded (status FAILED with the error) for auditing");
    navigate("/builder/ai"); await waitFor(() => T("ai.topic"), 4000, "AI builder");
    type(T("ai.topic"), "__malformed__ negotiation"); type(q('textarea[aria-label="Learning objectives"]'), "Anchor high");
    click(T("ai.generate")); await waitFor(() => q('[data-ai-phase="error"]') || q('[data-ai-phase="review"]'), 15000, "result");
    ok(!!q("[data-ai-error]") && !!T("ai.edit-brief"), "UI shows a recoverable error state with a way back to the brief");
    const bad = await apiPost("/ai/quiz/generate", { context: "x", objectives: ["x"], count: 999 });
    ok(bad.status === 200 && (await bad.json()).result.questions.length <= 25, "question count is capped at the configured maximum");
    const empty = await apiPost("/ai/course/generate", { topic: "", objectives: [] });
    ok(empty.status === 400, "missing topic/objectives → 400");
    const pdf = await apiPost("/ai/course/generate", { topic: "x", objectives: ["y"], sources: [{ kind: "pdf", name: "deck.pdf" }] });
    ok(pdf.status === 400 && /not supported/.test((await pdf.json()).message), "unsupported source kinds are refused clearly, not faked");
  };

  // Provider + dedupe: mock provider with AI disabled; an identical request within the window is not regenerated.
  suites.aiProvider = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    const st = await apiGet("/ai/status");
    ok(st && st.enabled === false && st.provider === "mock" && st.mock === true && st.configured === true, "AI_ENABLED=false → mock provider active and configured: " + JSON.stringify(st).slice(0, 100));
    const body = { topic: "Dedupe test " + Date.now(), audience: "team", difficulty: "Intermediate", durationMinutes: 45, objectives: ["Objective one", "Objective two"] }; // unique per run so the first call is fresh
    const a = await (await apiPost("/ai/course/generate", body)).json();
    const b = await (await apiPost("/ai/course/generate", body)).json();
    ok(a.id && b.id === a.id && b.deduplicated === true && a.deduplicated === false, "identical request within the dedupe window reuses the generation (" + a.id + ")");
    ok(a.provider === "mock" && a.model === "deterministic-mock-v1" && a.status === "COMPLETED", "record names the provider and model");
    const c = await (await apiPost("/ai/course/generate", { ...body, objectives: ["Objective one"] })).json();
    ok(c.id !== a.id && JSON.stringify(c.result) !== JSON.stringify(a.result), "a different brief produces a different outline (new generation " + c.id + ")");
    const again = await (await apiPost("/ai/course/generate", { ...body, objectives: ["Objective one"] })).json();
    ok(JSON.stringify(again.result) === JSON.stringify(c.result), "the mock provider is deterministic for the same brief");
  };

  // Persistence: a generation survives a full reload and logout/login (two-phase); backend restart is checked out-of-band.
  suites.aiPersist = async () => {
    if (!sessionStorage.getItem("ai-phase")) {
      await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
      const g = await (await apiPost("/ai/quiz/generate", { context: "Persistence quiz", objectives: ["Remember the steps"], count: 3, questionType: "mc" })).json();
      ok(g.status === "COMPLETED" && g.result.questions.length === 3, "quiz generation completed (" + g.id + ")");
      sessionStorage.setItem("ai-phase", "1"); sessionStorage.setItem("ai-gen", g.id); sessionStorage.setItem("ai-result", JSON.stringify(g.result));
      location.reload(); await sleep(60000);
    } else {
      const id = sessionStorage.getItem("ai-gen"), result = sessionStorage.getItem("ai-result");
      sessionStorage.removeItem("ai-phase");
      await waitFor(() => token(), 6000, "session");
      const g = await apiGet(`/ai/generations/${id}`);
      ok(!!g && g.status === "COMPLETED" && JSON.stringify(g.result) === result, "after a reload the generation record and its result are unchanged");
      await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
      const asAdmin = await apiGet(`/ai/generations/${id}`);
      ok(!!asAdmin && asAdmin.userId === "u-daniel", "an admin can audit another author's generation after logout/login");
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      ok((await apiRaw(`/ai/generations/${id}`)).status === 403, "a learner cannot read it");
    }
  };
}
