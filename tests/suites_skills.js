// Skills engine + learning journey suites (run one at a time: index.html?as=<role>&selftest=<suite>).
// Every suite drives the real UI against the running Java backend and then reads the persisted state back
// over the API, so a pass means "the screen did it AND the database has it".
import { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, load } from "/src/lib/store.js";
import { flushSyncNow } from "/src/services/courseSync.js";

export function registerSkills({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v3.token");
  const apiGet = (path) => fetch("http://localhost:8080/api" + path, { headers: { Authorization: "Bearer " + token() } }).then((r) => (r.ok ? r.json() : null));
  const btn = (re, root = document) => [...root.querySelectorAll("button, a.btn")].find((b) => re.test(b.textContent.trim()));
  const chip = (root, skillId) => root.querySelector(`[data-skill-chip="${skillId}"]`);
  const setSelect = (sel, v) => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); };

  /** Instructor builds + publishes a course whose single lesson (lesson | quiz | assignment) is mapped to a skill
   *  through the real Course Builder UI: course skill (target level 3, weight 30) + lesson contribution.
   *  Without a `skillId`, the admin first creates a brand-new skill for this run, so repeated runs never pile
   *  evidence onto the shared seeded skills (which would saturate the demo learner at 100%). */
  async function createMappedCourse(lessonType, skillId, contribution = 40, { extraLesson = false } = {}) {
    let skillName = skillId;
    if (!skillId) {
      await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
      skillName = "Run skill " + Date.now().toString(36);
      const created = await fetch("http://localhost:8080/api/skills", { method: "POST", headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: JSON.stringify({ name: skillName, description: "Created by a selftest run.", categoryId: "cat-sales", icon: "target" }) }).then((r) => r.json());
      skillId = created.id;
      const { hydrateSkillLibrary } = await import("/src/services/skillsSync.js");
      await hydrateSkillLibrary();
    }
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/builder/new"); await waitFor(() => location.hash.startsWith("#/builder/c-") && T("course.name"), 4000, "builder (new course id)"); // a previous Builder may still be mounted while /builder/new redirects
    const courseId = location.hash.split("/")[2];
    type(T("course.name"), `Skills ${lessonType} test ${Date.now()}`);
    await waitFor(() => chip(T("course.skills"), skillId), 3000, "course skill chip");
    click(chip(T("course.skills"), skillId)); await sleep(150);
    ok(chip(T("course.skills"), skillId).getAttribute("aria-pressed") === "true", "course skill chip toggles on");
    const lvl = q(`[data-course-skill="${skillId}"] select`);
    setSelect(lvl, "3");
    click(T("course.add-module")); await sleep(200);
    const dd = document.querySelector('button[aria-label="Add another lesson type"]');
    dd.click(); await sleep(100);
    [...document.querySelectorAll(".menu-item")].find((i) => new RegExp("^" + (lessonType === "quiz" ? "Quiz" : lessonType === "assignment" ? "Assignment" : "Lesson") + "$", "i").test(i.textContent.trim())).click();
    await sleep(300);
    if (lessonType === "quiz") {
      btn(/Add question/).click(); await sleep(80);
      [...document.querySelectorAll(".menu-item")].find((i) => /Multiple choice/.test(i.textContent)).click(); await sleep(150);
      const qcard = q(".qeditor");
      type(qcard.querySelector("textarea"), "Does a mapped quiz record skill evidence?");
      const opts = qcard.querySelectorAll('input[aria-label^="Option"]');
      type(opts[0], "Yes"); type(opts[1], "No"); type(opts[2], "Maybe");
      qcard.querySelector('input[type="radio"]').click(); await sleep(100);
    } else if (lessonType === "assignment") {
      const brief = q('textarea[aria-label="Assignment brief"]'); if (brief) { type(brief, "Write a short response for the analytics assignment test."); await sleep(150); }
    } else {
      btn(/Add content block/).click(); await sleep(60);
      [...document.querySelectorAll(".menu-item")].find((i) => /^Text$/.test(i.textContent.trim())).click(); await sleep(100);
      const ta = q(".block-card textarea"); if (ta) type(ta, "Lesson body for the skills test.");
    }
    await waitFor(() => chip(T("lesson.skills"), skillId), 3000, "lesson skill chip");
    click(chip(T("lesson.skills"), skillId)); await sleep(150);
    type(q(`[data-lesson-skill="${skillId}"] input`), String(contribution));
    click(T("lesson.save")); await sleep(200);
    if (extraLesson) { click(T("course.add-lesson")); await sleep(300); } // a plain second lesson, so completing lesson 1 leaves the course in progress
    click(T("course.publish")); await sleep(300);
    await flushSyncNow(courseId);
    const lessons = load("courses").find((c) => c.id === courseId).modules[0].lessons;
    return { courseId, lessonId: lessons[0].id, lessonId2: lessons[1]?.id, skillId, skillName };
  }
  suites.__createMappedCourse = createMappedCourse;

  // 1. Admin creates, edits and deactivates a skill from the Skills screen; the library is backend-persisted.
  suites.skillsAdmin = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    navigate("/skills"); await waitFor(() => T("skills.new"), 4000, "admin skills page");
    ok(!!q("[data-skill-table]") && document.querySelectorAll("[data-skill-row]").length >= 7, "library lists the seeded skills (" + document.querySelectorAll("[data-skill-row]").length + ")");
    const name = "Selftest skill " + Date.now();
    click(T("skills.new")); await waitFor(() => q('input[aria-label="Skill name"]'), 2000, "skill form");
    type(q('input[aria-label="Skill name"]'), name);
    type(q('textarea[aria-label="Skill description"]'), "Created by the selftest suite.");
    click(q('[data-skill-action="save"]'));
    await waitFor(() => [...document.querySelectorAll("[data-skill-row]")].some((r) => r.textContent.includes(name)), 4000, "new skill row");
    const row = [...document.querySelectorAll("[data-skill-row]")].find((r) => r.textContent.includes(name));
    ok(!!row, "new skill appears in the library table");
    let remote = (await apiGet("/skills?includeInactive=true")) || [];
    const created = remote.find((s) => s.name === name);
    ok(!!created && created.active === true, "skill persisted on the backend (" + created?.id + ")");
    // edit
    click(row.querySelector('[data-skill-action="edit"]')); await waitFor(() => q('input[aria-label="Skill name"]'), 2000, "edit form");
    type(q('input[aria-label="Skill name"]'), name + " v2"); click(q('[data-skill-action="save"]'));
    await waitFor(() => [...document.querySelectorAll("[data-skill-row]")].some((r) => r.textContent.includes(name + " v2")), 4000, "renamed row");
    remote = (await apiGet("/skills?includeInactive=true")) || [];
    ok(remote.some((s) => s.id === created.id && s.name === name + " v2"), "rename persisted on the backend");
    // deactivate
    const row2 = [...document.querySelectorAll("[data-skill-row]")].find((r) => r.textContent.includes(name + " v2"));
    click(row2.querySelector('[data-skill-action="toggle"]')); await sleep(200);
    click(btn(/^Deactivate$/, q(".modal") || document)); await sleep(600);
    remote = (await apiGet("/skills?includeInactive=true")) || [];
    ok(remote.some((s) => s.id === created.id && s.active === false), "deactivation persisted on the backend");
    ok(!(await apiGet("/skills")).some((s) => s.id === created.id), "inactive skill is excluded from the default (active) library");
  };

  // 2 + 3. Instructor maps a skill to a course (target level) and to a lesson (contribution) in the Course Builder.
  suites.skillMapping = async () => {
    const { courseId, lessonId, skillId } = await createMappedCourse("lesson", undefined, 40);
    const cs = await apiGet(`/courses/${courseId}/skills`);
    ok(Array.isArray(cs) && cs.some((m) => m.skillId === skillId && m.targetLevel === 3 && m.weight === 30), "course → skill mapping persisted (target level 3, weight 30): " + JSON.stringify(cs));
    const ls = await apiGet(`/lessons/${lessonId}/skills`);
    ok(Array.isArray(ls) && ls.some((m) => m.skillId === skillId && m.contribution === 40), "lesson → skill mapping persisted (contribution 40): " + JSON.stringify(ls));
    // remove the lesson mapping from the UI, confirm the row is gone server-side
    navigate(`/builder/${courseId}`); await waitFor(() => q(".lesson-btn"), 3000, "builder");
    q(".lesson-btn").click(); await waitFor(() => chip(T("lesson.skills"), skillId), 3000, "lesson skills");
    click(chip(T("lesson.skills"), skillId)); await sleep(100); click(T("lesson.save")); await sleep(100);
    await flushSyncNow(courseId);
    const after = await apiGet(`/lessons/${lessonId}/skills`);
    ok(Array.isArray(after) && after.length === 0, "removing the lesson mapping removes the persisted row");
    // course tree round-trips the lesson mapping shape (re-added) so the builder can hydrate it after a refresh
    click(chip(T("lesson.skills"), skillId)); await sleep(100); await flushSyncNow(courseId);
    const tree = await apiGet(`/courses/${courseId}`);
    ok(tree?.modules?.[0]?.lessons?.[0]?.skills?.some((m) => m.skillId === skillId), "course tree includes lesson skill mappings for hydration");
  };

  // 4 + 6 + 7. Learner completes a mapped lesson (which also finishes the 1-lesson course): UserSkill updates with
  // lesson + course evidence, level stays below Proficient without an assessment, and the Skills page shows it.
  suites.skillProgress = async () => {
    const { courseId, lessonId, skillId, skillName } = await createMappedCourse("lesson", undefined, 40);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const before = ((await apiGet("/me/skills")) || []).find((s) => s.skillId === skillId);
    const basePts = before?.progressPercentage || 0;
    navigate(`/explore/${courseId}`); await waitFor(() => T("journey.next"), 4000, "course detail with journey");
    ok(!!q(".lj") && q('[data-lj-node="course"]'), "learning journey renders on the course page");
    click(T("course.start")); await waitFor(() => T("player.complete"), 4000, "player");
    click(T("player.complete")); await waitFor(() => q(".complete-card"), 3000, "completion card");
    ok(new RegExp(skillName + " skill \\+70%").test(q(".complete-card").textContent), "completion card shows the projected gain (+40 lesson, +30 course): " + (q(".complete-card").textContent.match(/skill \+\d+%/) || [""])[0]);
    let mine = null;
    for (let i = 0; i < 10 && !(mine && mine.evidence.some((e) => e.refId === lessonId)); i++) { await sleep(400); mine = ((await apiGet("/me/skills")) || []).find((s) => s.skillId === skillId); }
    ok(!!mine && mine.evidence.some((e) => e.source === "lesson" && e.refId === lessonId && e.points === 40), "lesson completion recorded as skill evidence (+40): " + JSON.stringify(mine?.evidence?.slice(-2)));
    ok(mine.evidence.some((e) => e.source === "course" && e.refId === courseId && e.points === 30), "course completion recorded as skill evidence (+30)");
    ok(mine.progressPercentage === Math.min(100, basePts + 70), `progress is deterministic (${basePts} → ${mine.progressPercentage})`);
    ok(mine.currentLevel <= 2 || mine.evidence.some((e) => e.source === "quiz" || (e.source === "assignment" && /Reviewed/.test(e.label))), "no Proficient/Advanced level without assessed evidence (level " + mine.currentLevel + ")");
    navigate("/skills"); await waitFor(() => q(`[data-skill-card="${skillId}"]`), 4000, "skills page");
    await waitFor(() => q('[data-skills-source="backend"]'), 3000, "backend-sourced standing");
    const card = q(`[data-skill-card="${skillId}"]`);
    ok(card.textContent.includes(`${mine.progressPercentage}%`), "Skills page shows the persisted progress (" + mine.progressPercentage + "%)");
    ok(new RegExp("Level " + mine.currentLevel).test(card.textContent), "Skills page shows the persisted level");
    ok(!!T("skills.overview") && !!T("skills.card"), "guide targets present on the Skills page");
  };

  // 5. Passing a quiz records assessed evidence and can lift the level to Proficient.
  suites.skillQuizEvidence = async () => {
    const { courseId, lessonId, skillId } = await createMappedCourse("quiz", undefined, 40);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const { saveQuizResult, completeLesson } = await import("/src/services/learning.js");
    const before = ((await apiGet("/me/skills")) || []).find((s) => s.skillId === skillId);
    const basePts = before?.progressPercentage || 0;
    // The attempt carries the actual answers: the backend scores them itself and ignores the claimed score.
    const quiz = load("courses").find((c) => c.id === courseId).modules[0].lessons[0].quiz;
    saveQuizResult("u-maya", courseId, lessonId, { score: 100, passed: true, answers: Object.fromEntries(quiz.questions.map((qq) => [qq.id, qq.answer])) });
    let mine = null;
    const has = (source, refId) => mine && mine.evidence.some((e) => e.source === source && e.refId === refId);
    for (let i = 0; i < 10 && !has("quiz", lessonId); i++) { await sleep(400); mine = ((await apiGet("/me/skills")) || []).find((s) => s.skillId === skillId); }
    ok(has("quiz", lessonId) && mine.evidence.find((e) => e.source === "quiz" && e.refId === lessonId).points === 15, "passed quiz stored as assessed evidence (+15 at 100%)");
    completeLesson("u-maya", courseId, lessonId);
    for (let i = 0; i < 10 && !(has("course", courseId) && has("lesson", lessonId)); i++) { await sleep(400); mine = ((await apiGet("/me/skills")) || []).find((s) => s.skillId === skillId); }
    ok(mine.progressPercentage === Math.min(100, basePts + 85), `lesson 40 + course 30 + quiz 15 = ${mine.progressPercentage}%`);
    ok(mine.currentLevel >= 3, "assessed evidence unlocks Proficient/Advanced (level " + mine.currentLevel + " " + mine.levelLabel + ")");
    const cached = () => load("userSkills").some((r) => r.userId === "u-maya" && r.skillId === skillId && r.progressPercentage === mine.progressPercentage);
    await waitFor(cached, 4000, "local userSkills cache refresh"); // refreshMySkills() runs after the progress save resolves
    ok(cached(), "local cache mirrors the backend standing after refresh");
  };

  // 8-11. Journey states + next action on the course page, updating as a lesson is completed.
  suites.journey = async () => {
    // A fresh 2-lesson mapped course of which the learner has finished exactly lesson 1: every journey state below
    // is asserted on known data, not on whatever the demo learner has accumulated on the seeded courses.
    const { courseId, lessonId } = await createMappedCourse("lesson", undefined, 40, { extraLesson: true });
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    await fetch(`http://localhost:8080/api/courses/${courseId}/enroll`, { method: "POST", headers: { Authorization: "Bearer " + token(), "Content-Type": "application/json" }, body: "{}" });
    const { completeLesson } = await import("/src/services/learning.js");
    completeLesson("u-maya", courseId, lessonId);
    let synced = null;
    for (let i = 0; i < 30 && !synced; i++) { const rows = await apiGet(`/courses/${courseId}/progress/detail`); synced = rows?.find((r) => r.lessonId === lessonId && r.status === "COMPLETED") || null; if (!synced) await sleep(400); }
    ok(!!synced, "setup: lesson 1 of 2 completed on the backend");
    navigate(`/explore/${courseId}`); await waitFor(() => T("journey.next"), 6000, "course detail");
    const statuses = () => [...document.querySelectorAll("[data-lj-node]")].map((n) => n.dataset.ljStatus);
    const s0 = statuses();
    ok(s0.includes("completed") && s0.filter((s) => s === "current").length >= 1, "journey shows completed and current nodes (" + s0.join(",") + ")");
    ok(!!q('[data-lj-node="certificate"][data-lj-status="current"], [data-lj-node="certificate"][data-lj-status="locked"]'), "certificate node is not yet available");
    ok(document.querySelectorAll(".lj-stage").length >= 5, "stages: course, modules, lessons, skills, certificate (" + document.querySelectorAll(".lj-stage").length + ")");
    ok(!!q(".lj-edge.is-flow") || !!q(".lj-edge.is-done"), "edges communicate state (done / flowing)");
    const curr = q('[data-lj-node^="l:"][data-lj-status="current"]');
    curr.click(); await sleep(100);
    ok(q(".lj-detail") && /In progress/.test(q(".lj-detail").textContent), "selecting a node shows its status and next action (detail: " + (q(".lj-detail")?.textContent || "none").replace(/\s+/g, " ").slice(0, 120) + ")");
    ok(/Continue with/.test(T("journey.next").closest(".lj-next").textContent), "next-action CTA names the next lesson");
    click(T("journey.next")); await waitFor(() => T("player.complete"), 4000, "player from journey CTA");
    ok(new RegExp("^#/learn/" + courseId + "/").test(location.hash), "CTA opens the next lesson in the Player");
    click(T("player.complete")); await waitFor(() => q(".complete-card"), 3000, "completion card");
    const completedText = (q(".complete-card")?.textContent || "(no completion card)").replace(/\s+/g, " ").slice(0, 80);
    navigate(`/explore/${courseId}`); await waitFor(() => T("journey.next"), 4000, "course detail again");
    const s1 = statuses();
    ok(s1.filter((s) => s === "completed").length > s0.filter((s) => s === "completed").length, "completing a lesson moves a node to completed (" + s0.filter((s) => s === "completed").length + " → " + s1.filter((s) => s === "completed").length + "; card: " + completedText + ")");
    ok(!!q('[data-lj-node^="s:"]'), "skill nodes appear in the journey");
  };

  // 12 + 13. Refresh and logout/login keep the persisted standing (two-phase, survives location.reload()).
  suites.skillsPersist = async () => {
    if (!sessionStorage.getItem("skills-phase")) {
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      const mine = await apiGet("/me/skills");
      ok(Array.isArray(mine) && mine.length > 0, "learner has persisted skill rows (" + mine?.length + ")");
      navigate("/skills"); await waitFor(() => q('[data-skills-source="backend"]'), 4000, "backend standing on page");
      sessionStorage.setItem("skills-phase", "1");
      sessionStorage.setItem("skills-snapshot", JSON.stringify(mine.map((s) => [s.skillId, s.progressPercentage, s.currentLevel])));
      location.reload();
      await sleep(60000);
    } else {
      const snap = JSON.parse(sessionStorage.getItem("skills-snapshot"));
      sessionStorage.removeItem("skills-phase");
      await waitFor(() => q('[data-skills-source="backend"]'), 6000, "backend standing after reload");
      const rows = load("userSkills").filter((r) => r.userId === "u-maya");
      ok(snap.every(([id, pct, lvl]) => rows.some((r) => r.skillId === id && r.progressPercentage === pct && r.currentLevel === lvl)), "after a full reload the Skills page shows the same persisted standing");
      for (const [id, pct] of snap) ok(q(`[data-skill-card="${id}"]`)?.textContent.includes(pct + "%"), `card ${id} shows ${pct}% after reload`);
      // logout → login as the same learner: standing comes back from the server, not from local cache
      localStorage.removeItem("we360.v3.userSkills");
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      await sleep(1200);
      const again = await apiGet("/me/skills");
      ok(snap.every(([id, pct, lvl]) => again.some((r) => r.skillId === id && r.progressPercentage === pct && r.currentLevel === lvl)), "after logout/login the backend returns the same standing");
      const paths = await apiGet("/learning-paths");
      ok(Array.isArray(paths) && paths.length >= 2 && load("journeys").some((j) => j.id === paths[0].id), "learning paths are persisted and hydrated into journeys");
    }
  };
}
