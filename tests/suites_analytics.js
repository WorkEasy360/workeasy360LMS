// Learning analytics suites (run one at a time: index.html?as=<role>&selftest=<suite>). Each suite drives the
// real UI against the Java backend and cross-checks what the screen shows with what the API returns.
import { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, load } from "/src/lib/store.js";

export function registerAnalytics({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v2.token");
  const apiRaw = (path) => fetch("http://localhost:8080/api" + path, { headers: { Authorization: "Bearer " + token() } });
  const apiGet = (path) => apiRaw(path).then((r) => (r.ok ? r.json() : null));
  const metric = (id) => +q(`[data-metric="${id}"]`)?.dataset.metricValue;
  const setSelect = (sel, v) => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); };
  const loaded = () => waitFor(() => q('[data-analytics-source="backend"]') && !q(".loading, .skeleton") && (q("[data-metric]") || q("[data-analytics-course]") || q(".learner-row") || q("[data-skill-analytics]") || q('[data-guide-target="analytics.health"]') || q("[data-guide-analytics]")), 8000, "analytics loaded");
  const tab = async (label) => { [...document.querySelectorAll('[data-guide-target^="analytics.tab-"]')].find((b) => b.textContent.trim() === label).click(); await sleep(150); await loaded(); };
  const iso = (d) => d.toISOString().slice(0, 10);
  const range30 = () => `from=${iso(new Date(Date.now() - 29 * 86400000))}&to=${iso(new Date())}`;

  // 1. Admin overview renders real backend numbers; funnel, filters and tabs are backend-driven.
  suites.analyticsAdmin = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    navigate("/analytics"); await loaded();
    const o = await apiGet(`/analytics/overview?${range30()}`);
    ok(!!o && o.scope === "organisation", "admin overview scope is the organisation (" + o?.scope + ")");
    ok(q('[data-analytics-scope="organisation"]'), "page reports organisation scope");
    ok(metric("enrollments") === o.enrollments, `Enrolments card matches API (${metric("enrollments")} vs ${o.enrollments})`);
    ok(metric("completionRate") === o.completionRate, `Completion rate card matches API (${metric("completionRate")}%)`);
    ok(metric("learners") === o.totalLearners, `Learners card matches API (${o.totalLearners})`);
    ok(metric("certificates") === o.certificatesIssued, `Certificates card matches API (${o.certificatesIssued})`);
    const stages = [...document.querySelectorAll("[data-funnel-stage]")].map((s) => [s.dataset.funnelStage, +s.dataset.funnelCount]);
    ok(stages.length === 5 && stages.every(([name, n]) => o.funnel.find((f) => f.stage.toLowerCase() === name)?.count === n), "funnel stages (Enrolled→Started→Progressing→Completed→Certified) match the API: " + JSON.stringify(stages));
    ok(!!q(".chart-draw svg") && document.querySelectorAll(".chart-draw circle").length >= 1, "activity trend chart drawn from backend series");
    ok(document.querySelectorAll(".dist-row").length === 6, "progress distribution shows six buckets");
    // date filter → server-side: 7-day numbers must equal the API for that range
    setSelect(q('[data-analytics-filter="range"]'), "7d"); await sleep(100); await loaded(); await sleep(900);
    const o7 = await apiGet(`/analytics/overview?from=${iso(new Date(Date.now() - 6 * 86400000))}&to=${iso(new Date())}`);
    ok(metric("enrollments") === o7.enrollments && metric("completionRate") === o7.completionRate, `7-day filter re-queries the backend (${metric("enrollments")} enrolments, ${metric("completionRate")}%)`);
    // course filter → scope becomes one course
    setSelect(q('[data-analytics-filter="course"]'), "c-crm"); await sleep(100); await loaded();
    ok(q('[data-analytics-scope="course"]'), "course filter narrows the scope to one course");
    const oc = await apiGet(`/analytics/overview?courseId=c-crm&from=${iso(new Date(Date.now() - 6 * 86400000))}&to=${iso(new Date())}`);
    ok(metric("enrollments") === oc.enrollments, `course-filtered enrolments match API (${oc.enrollments})`);
    setSelect(q('[data-analytics-filter="course"]'), ""); setSelect(q('[data-analytics-filter="range"]'), "30d"); await sleep(100); await loaded();
    await tab("Skills");
    const sk = await apiGet("/analytics/skills");
    ok(document.querySelectorAll("[data-skill-analytics]").length === sk.length && sk.length >= 7, `skills tab renders ${sk.length} skills from the backend`);
    await tab("Course health");
    const hs = await apiGet("/analytics/health");
    ok(!!T("analytics.health") && (hs.length === 0 || document.querySelectorAll("[data-health-signal]").length === hs.length), `course health shows ${hs.length} factual signal(s) with their metric`);
    if (hs.length) ok(/\d/.test(q(".health-metric").textContent), "each signal shows the underlying metric value: " + q(".health-metric").textContent);
    await tab("Learners");
    const ls = await apiGet(`/analytics/learners?${range30()}`); // the UI list is filtered to the same 30-day period
    ok(document.querySelectorAll(".learner-row").length === ls.length, `learners list has ${ls.length} learners`);
    q(".learner-row").click(); await waitFor(() => q("[data-analytics-learner]"), 5000, "learner detail");
    ok(!!q("[data-analytics-learner]"), "selecting a learner shows their progress detail");
  };

  // 2 + 3. Instructor sees only their own courses; another instructor's course is refused by the backend.
  suites.analyticsInstructor = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/analytics"); await loaded();
    ok(q('[data-analytics-scope="my-courses"]'), "instructor overview is scoped to their courses");
    // The page defaults to "Last 30 days" while this test compares against the unfiltered (all-time) API — and the
    // seeded activity ages out of any window eventually. Compare like with like: switch the page to all time.
    setSelect(q('[data-analytics-filter="range"]'), "all"); await sleep(100); await loaded();
    await tab("Courses");
    const mine = await apiGet("/analytics/courses");
    ok(mine.length > 0 && mine.every((c) => c.instructorId === "u-daniel"), `API lists only Daniel's courses (${mine.length})`);
    ok(document.querySelectorAll("[data-analytics-course]").length === mine.length, "course cards match the API list");
    ok(!mine.some((c) => c.courseId === "c-sec"), "Aisha's Security course is not in Daniel's list");
    q('[data-analytics-course="c-sales"]').click(); await waitFor(() => q('[data-analytics-course-detail="c-sales"]'), 5000, "course detail");
    const cs = await apiGet("/analytics/courses/c-sales");
    const stages = [...document.querySelectorAll('[data-analytics-course-detail] [data-funnel-stage]')].map((s) => +s.dataset.funnelCount);
    ok(stages.length === 5 && stages.every((n, i) => cs.funnel[i].count === n), "course funnel matches API: " + stages.join("→"));
    ok(document.querySelectorAll("[data-lesson-stat]").length === cs.lessons.length, `lesson drop-off lists ${cs.lessons.length} lessons`);
    ok(document.querySelectorAll("[data-course-learner]").length === cs.learners.length, `learner rows for the course (${cs.learners.length})`);
    const other = await apiRaw("/analytics/courses/c-sec");
    ok(other.status === 403, "backend refuses another instructor's course analytics (HTTP " + other.status + ")");
    const notMine = await apiRaw("/analytics/learners/u-lena");
    ok(notMine.status === 403, "backend refuses a learner not enrolled in the instructor's courses (HTTP " + notMine.status + ")");
    const maya = await apiGet("/analytics/learners/u-maya");
    ok(!!maya && maya.courses.every((c) => mine.some((m) => m.courseId === c.courseId)), "learner detail discloses only the instructor's own courses");
  };

  // 4 + 5. Learner My Progress renders own persisted data; manager analytics and other learners are refused.
  suites.analyticsLearner = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate("/progress"); await waitFor(() => q('[data-progress-source="backend"]'), 8000, "my progress");
    const me = await apiGet("/analytics/me");
    const stat = (id) => +q(`[data-progress-stat="${id}"]`)?.dataset.progressValue;
    ok(stat("lessons") === me.lessonsCompleted && stat("courses") === me.coursesCompleted && stat("certificates") === me.certificates, `accomplishments match /analytics/me (${me.lessonsCompleted} lessons, ${me.coursesCompleted} courses, ${me.certificates} certificates)`);
    ok(stat("streak") === me.streakDays, `streak matches (${me.streakDays} days)`);
    ok(T("progress.next")?.dataset.nextHref === me.nextAction.href, "next action is the backend's deterministic choice: " + me.nextAction.label);
    ok(document.querySelectorAll("[data-progress-skill]").length === Math.min(6, me.skills.length), "skills section lists persisted skill rows");
    ok(!!T("progress.overview") && !!T("progress.courses") && !!T("progress.activity"), "guide targets present");
    for (const [path, label] of [["/analytics/overview", "manager overview"], ["/analytics/learners", "learner list"], ["/analytics/learners/u-omar", "another learner"], ["/analytics/courses/c-crm", "course analytics"], ["/analytics/health", "course health"]]) {
      const r = await apiRaw(path); ok(r.status === 403, `learner is refused ${label} (HTTP ${r.status})`);
    }
    ok((await apiRaw("/analytics/learners/u-maya")).status === 200, "learner can read their own record");
    await waitFor(() => q('[data-progress-source="backend"]') && T("progress.next"), 8000, "next action after hydration"); click(T("progress.next").querySelector("button")); await sleep(400);
    ok(/^#\/(learn|explore)/.test(location.hash), "next action navigates into learning (" + location.hash.slice(0, 30) + ")");
  };

  // 6 + 14. Funnel calculations on a fresh course: enrol → complete → certified, verified through the UI + API.
  suites.analyticsFunnel = async () => {
    const { courseId, lessonId } = await suites.__createMappedCourse("lesson", undefined, 40);
    let cs = null;
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate(`/explore/${courseId}`); await waitFor(() => T("course.start"), 5000, "course page");
    click(T("course.start")); await waitFor(() => T("player.complete"), 5000, "player");
    await sleep(600);
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    for (let i = 0; i < 10 && !(cs && cs.enrolled === 1); i++) { await sleep(400); cs = await apiGet(`/analytics/courses/${courseId}`); }
    ok(cs.enrolled === 1 && cs.completed === 0 && cs.certified === 0, `after enrolling: enrolled 1, completed 0, certified 0 (started ${cs.funnel[1].count} — a lesson counts as started once progress is saved)`);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate(`/learn/${courseId}/${lessonId}`); await waitFor(() => T("player.complete"), 5000, "player again");
    click(T("player.complete")); await sleep(800);
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    for (let i = 0; i < 10 && !(cs && cs.completed === 1 && cs.certified === 1); i++) { await sleep(400); cs = await apiGet(`/analytics/courses/${courseId}`); }
    ok(cs.funnel.map((f) => f.count).join(",") === "1,1,1,1,1", "funnel Enrolled→Started→Progressing→Completed→Certified = 1,1,1,1,1 (" + cs.funnel.map((f) => f.count).join(",") + ")");
    ok(cs.completionRate === 100 && cs.avgProgress === 100 && cs.lessons[0].completed === 1 && cs.lessons[0].completionPct === 100, "completion rate, average progress and lesson stats are 100%");
    navigate("/analytics"); await loaded(); await tab("Courses");
    q(`[data-analytics-course="${courseId}"]`).click(); await waitFor(() => q(`[data-analytics-course-detail="${courseId}"]`), 5000, "detail");
    const shown = [...document.querySelectorAll('[data-analytics-course-detail] [data-funnel-stage]')].map((s) => +s.dataset.funnelCount).join(",");
    ok(shown === "1,1,1,1,1", "UI funnel shows the same stages (" + shown + ")");
  };

  // 7 + 8. Quiz pass-rate and assignment metrics from real attempts/submissions.
  suites.analyticsAssessments = async () => {
    const { courseId, lessonId } = await suites.__createMappedCourse("quiz", undefined, 40);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const { saveQuizResult } = await import("/src/services/learning.js");
    // The backend scores attempts from the submitted answers (never the claimed score): one wrong answer (0%,
    // failed) and one right answer (100%, passed) → 2 attempts, 50% pass rate, 50% average.
    const quiz = load("courses").find((c) => c.id === courseId).modules[0].lessons[0].quiz;
    const qq = quiz.questions[0], wrongOption = qq.options.find((o) => o.id !== qq.answer).id;
    saveQuizResult("u-maya", courseId, lessonId, { score: 40, passed: false, answers: { [qq.id]: wrongOption } }); await sleep(500);
    saveQuizResult("u-maya", courseId, lessonId, { score: 100, passed: true, answers: { [qq.id]: qq.answer } }); await sleep(800);
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    let cs = null;
    for (let i = 0; i < 10 && !(cs && cs.quizAttempts === 2); i++) { await sleep(400); cs = await apiGet(`/analytics/courses/${courseId}`); }
    ok(cs.quizAttempts === 2 && cs.quizPassRate === 50 && cs.avgQuizScore === 50, `quiz metrics: 2 attempts, 50% pass rate, avg 50% (got ${cs.quizAttempts}/${cs.quizPassRate}/${cs.avgQuizScore})`);
    const a = await suites.__createMappedCourse("assignment", undefined, 20);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate(`/learn/${a.courseId}/${a.lessonId}`); await waitFor(() => q('textarea[aria-label="Your submission"]'), 5000, "assignment");
    type(q('textarea[aria-label="Your submission"]'), "My analytics assignment submission, comfortably over twenty characters long.");
    click([...document.querySelectorAll("button")].find((b) => /Submit assignment/.test(b.textContent))); await sleep(800);
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    let ca = null;
    for (let i = 0; i < 10 && !(ca && ca.assignmentsSubmitted === 1); i++) { await sleep(400); ca = await apiGet(`/analytics/courses/${a.courseId}`); }
    ok(ca.assignmentsSubmitted === 1 && ca.assignmentsReviewed === 0 && ca.assignmentCompletionRate === 0, "assignment metrics: 1 submitted, 0 reviewed, 0% reviewed");
    const o = await apiGet("/analytics/overview");
    ok(o.assignmentSubmissions >= 1 && o.quizAttempts >= 2, "overview aggregates include the new attempts and submission");
  };

  // 9 + 10 + 11. Skill analytics and filtering are applied by the backend.
  suites.analyticsFilters = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const sk = await apiGet("/analytics/skills");
    ok(sk.length >= 7 && sk.every((s) => s.levelDistribution && "Novice" in s.levelDistribution), "skill analytics carry level distributions for every active skill");
    const one = await apiGet("/analytics/skills?skillId=crm");
    ok(one.length === 1 && one[0].skillId === "crm" && one[0].learners >= 1, "skill filter returns just that skill with learner counts");
    const future = await apiGet("/analytics/overview?from=2031-01-01&to=2031-01-31");
    ok(future.enrollments === 0 && future.completions === 0 && future.quizAttempts === 0 && future.activity.every((d) => d.lessonsCompleted === 0), "a date range with no activity yields zero events");
    const all = await apiGet("/analytics/overview");
    const thisMonth = await apiGet(`/analytics/overview?${range30()}`);
    ok(all.enrollments >= thisMonth.enrollments && all.activity.length === 30 && thisMonth.activity.length === 30, "date ranges bound the event counts and the daily series");
    const byCourse = await apiGet("/analytics/overview?courseId=c-sales");
    const crs = await apiGet("/analytics/courses/c-sales");
    ok(byCourse.scope === "course" && byCourse.enrollments === crs.enrolled, "course filter matches the course endpoint (" + crs.enrolled + " enrolled)");
    const published = await apiGet("/analytics/courses?status=PUBLISHED");
    ok(published.length > 0 && published.every((c) => c.status === "PUBLISHED"), "status filter returns only published courses");
    const bad = await apiRaw("/analytics/overview?from=not-a-date");
    ok(bad.status === 400, "invalid date is rejected with 400");
    navigate("/analytics"); await loaded(); await tab("Skills");
    ok(document.querySelectorAll("[data-skill-analytics]").length === sk.length, "Skills tab renders the backend skill analytics");
    setSelect(q('[data-analytics-filter="course"]'), "c-crm"); await sleep(100); await loaded();
    const crmSkills = await apiGet("/analytics/skills?courseId=c-crm");
    ok(document.querySelectorAll("[data-skill-analytics]").length === crmSkills.length, `course filter narrows skills to the course's mappings (${crmSkills.length})`);
  };

  // Seed/demo consistency: a valid certificate always belongs to a completed enrolment, so no course can show more
  // certified than completed learners, and the demo learner's Sales Foundations certificate verifies as VALID.
  suites.seedConsistency = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const courses = await apiGet("/analytics/courses");
    const bad = courses.filter((c) => c.certified > c.completed);
    ok(bad.length === 0, "no course has more certified than completed learners" + (bad.length ? ": " + bad.map((c) => `${c.title} ${c.certified}>${c.completed}`).join(", ") : ""));
    const sales = courses.find((c) => c.courseId === "c-sales");
    ok(sales && sales.certified === sales.completed && sales.completed >= 2, `Sales Foundations: completed ${sales?.completed}, certified ${sales?.certified}`);
    const certs = (await apiGet("/certificates?all=true")) || [];
    let checked = 0, inconsistent = 0;
    for (const c of certs.filter((x) => x.status !== "REVOKED")) {
      const l = await apiGet(`/analytics/learners/${c.userId}`);
      const course = l?.courses.find((x) => x.courseId === c.courseId);
      if (!course) continue;
      checked++; if (course.status !== "completed") inconsistent++;
    }
    ok(checked > 0 && inconsistent === 0, `every valid certificate (${checked} checked) sits on a completed enrolment`);
    const maya = await apiGet("/analytics/learners/u-maya");
    const mayaSales = maya.courses.find((c) => c.courseId === "c-sales");
    ok(mayaSales?.status === "completed" && mayaSales.progress === 100, "Maya's Sales Foundations enrolment is complete (100%)");
    const mayaCert = maya.certificateList.find((c) => c.courseId === "c-sales");
    ok(!!mayaCert && mayaCert.status === "VALID", "Maya holds a valid Sales Foundations certificate (" + mayaCert?.certificateNumber + ")");
    const verified = await fetch(`http://localhost:8080/api/certificates/verify/${mayaCert.certificateNumber}`).then((r) => r.json());
    ok(verified?.status === "VALID" && verified.courseId === "c-sales", "public verification confirms the certificate is VALID");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const me = await apiGet("/analytics/me");
    ok(me.completed.some((c) => c.courseId === "c-sales") && me.certificateList.some((c) => c.courseId === "c-sales"), "learner's My Progress lists Sales Foundations as completed with its certificate");
  };

  // Guide adoption analytics: events recorded by the Guide runtime are persisted server-side, aggregated for admins,
  // deduplicated, and refused to other roles.
  suites.guideAnalyticsBackend = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const before = ((await apiGet("/analytics/guides")) || []).find((g) => g.guideId === "create-first-course") || { opened: 0, started: 0, stepReach: {} };
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/courses"); await waitFor(() => T("courses.new"), 4000, "courses");
    click('[data-guide-launch="create-first-course"]'); await sleep(300);
    click(T("courses.new")); await waitFor(() => T("course.name"), 4000, "builder");
    type(T("course.name"), "Guide analytics test " + Date.now());
    const { guideEngine } = await import("/src/guide/GuideEngine.js");
    await waitFor(() => guideEngine?.state?.stepIndex >= 1, 4000, "guide step advances"); await sleep(600);
    ok((await apiRaw("/analytics/guides")).status === 403, "instructor is refused guide adoption analytics (403)");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    ok((await apiRaw("/analytics/guides")).status === 403, "learner is refused guide adoption analytics (403)");
    // duplicate suppression: the same event posted twice in quick succession is stored once
    const post = () => fetch("http://localhost:8080/api/guides/first-lesson/analytics", { method: "POST", headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify({ event: "help.requested", step: 2, durationMs: null }) });
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const fl0 = ((await apiGet("/analytics/guides")) || []).find((g) => g.guideId === "first-lesson")?.helpRequested || 0;
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    await post(); await post(); await sleep(300);
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    const rows = await apiGet("/analytics/guides");
    const after = rows.find((g) => g.guideId === "create-first-course");
    ok(after.opened === before.opened + 1 && after.started >= before.started + 1, `guide opened/started persisted for the admin (opened ${before.opened} → ${after.opened})`);
    ok((after.stepReach["1"] || 0) === (before.stepReach["1"] || 0) + 1, "step 1 completion recorded in the step drop-off (" + JSON.stringify(after.stepReach) + ")");
    ok(after.users >= 1 && typeof after.completionRate === "number", "aggregate includes distinct users and a completion rate");
    const fl1 = rows.find((g) => g.guideId === "first-lesson")?.helpRequested || 0;
    ok(fl1 === fl0 + 1, `duplicate event suppressed: help.requested ${fl0} → ${fl1}`);
    navigate("/analytics"); await loaded(); await tab("Guides");
    await waitFor(() => q('[data-guide-analytics-source]'), 6000, "guides tab");
    ok(q('[data-guide-analytics-source="backend"]'), "Guides tab reads the backend aggregate");
    ok(q('[data-guide-analytics="create-first-course"]')?.dataset.guideOpened === String(after.opened), "Guides tab shows the persisted opened count (" + after.opened + ")");
  };

  // Guide analytics survive a full reload and a logout/login (two-phase).
  suites.guideAnalyticsPersist = async () => {
    if (!sessionStorage.getItem("ga-phase")) {
      await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
      const rows = await apiGet("/analytics/guides");
      ok(Array.isArray(rows) && rows.length > 0, "guide analytics rows exist on the server (" + rows?.length + " guides)");
      sessionStorage.setItem("ga-phase", "1");
      sessionStorage.setItem("ga-snapshot", JSON.stringify(rows.map((r) => [r.guideId, r.opened, r.started, r.completed, r.stepReach])));
      location.reload();
      await sleep(60000);
    } else {
      const snap = JSON.parse(sessionStorage.getItem("ga-snapshot"));
      sessionStorage.removeItem("ga-phase");
      await waitFor(() => token(), 6000, "session");
      const same = (rows) => snap.every(([id, o, s, c, reach]) => rows.some((r) => r.guideId === id && r.opened === o && r.started === s && r.completed === c && JSON.stringify(r.stepReach) === JSON.stringify(reach)));
      ok(same(await apiGet("/analytics/guides")), "after a full reload the server returns the same guide analytics");
      await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD); await sleep(300);
      await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
      ok(same(await apiGet("/analytics/guides")), "after logout/login the guide analytics are unchanged");
      navigate("/analytics"); await loaded(); await tab("Guides");
      await waitFor(() => q('[data-guide-analytics-source="backend"]'), 6000, "guides tab from backend");
      ok(snap.every(([id, o]) => q(`[data-guide-analytics="${id}"]`)?.dataset.guideOpened === String(o)), "Guides tab shows the persisted counts after reload + re-login");
    }
  };

  // 12 + 13. Refresh and logout/login keep the same analytics (two-phase, survives location.reload()).
  suites.analyticsPersist = async () => {
    if (!sessionStorage.getItem("analytics-phase")) {
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      const me = await apiGet("/analytics/me");
      sessionStorage.setItem("analytics-phase", "1");
      sessionStorage.setItem("analytics-snapshot", JSON.stringify([me.lessonsCompleted, me.coursesCompleted, me.certificates, me.overallProgress, me.nextAction.href]));
      navigate("/progress"); await waitFor(() => q('[data-progress-source="backend"]'), 8000, "my progress");
      location.reload();
      await sleep(60000);
    } else {
      const snap = JSON.parse(sessionStorage.getItem("analytics-snapshot"));
      sessionStorage.removeItem("analytics-phase");
      await waitFor(() => q('[data-progress-source="backend"]'), 8000, "my progress after reload");
      const stat = (id) => +q(`[data-progress-stat="${id}"]`)?.dataset.progressValue;
      ok(stat("lessons") === snap[0] && stat("courses") === snap[1] && stat("certificates") === snap[2], "after a full reload My Progress shows the same persisted numbers");
      ok(T("progress.next")?.dataset.nextHref === snap[4], "next action is the same after reload");
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD); await sleep(600);
      const me = await apiGet("/analytics/me");
      ok(me.lessonsCompleted === snap[0] && me.coursesCompleted === snap[1] && me.certificates === snap[2] && me.overallProgress === snap[3], "after logout/login the backend returns the same analytics");
      await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
      const o = await apiGet("/analytics/overview");
      ok(!!o && o.enrollments > 0, "admin analytics available after switching user (" + o?.enrollments + " enrolments)");
    }
  };
}
