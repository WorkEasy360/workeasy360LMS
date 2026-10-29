// Video, permission and "Add Your First Video" guide suites. Registered from selftest.js.
import { videoStorage, videoAccess } from "/src/services/videos.js";
import { can } from "/src/services/permissions.js";
import { login, DEMO_USER_BY_ROLE, getUser, load, loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD } from "/src/lib/store.js";
import { flushSyncNow } from "/src/services/courseSync.js";

export function register({ suites, log, ok, sleep, q, click, type, waitFor, guideEngine, navigate }) {
  async function makeVideoFile() {
    try {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180;
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(20), { mimeType: "video/webm" });
      const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      let t = 0;
      const iv = setInterval(() => { g.fillStyle = `hsl(${t * 25},70%,45%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = "#fff"; g.font = "28px sans-serif"; g.fillText("Frame " + t++, 20, 100); }, 50);
      rec.start(100);
      await new Promise((r) => setTimeout(r, 2200));
      const stopped = new Promise((r) => (rec.onstop = r)); rec.stop(); await stopped; clearInterval(iv);
      const f = new File(chunks, "Sales-Onboarding.webm", { type: "video/webm" });
      if (f.size > 1000) return f;
    } catch (e) { log("NOTE: MediaRecorder unavailable:", e.message); }
    return new File([new Uint8Array(4096)], "Sales-Onboarding.mp4", { type: "video/mp4" }); // undecodable -> exercises the fallback path
  }
  const setFile = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); };
  const T = (t) => q(`[data-guide-target="${t}"]`);

  async function videoFlow(role) {
    ok(can(getUser(), "course.create"), `${role} can create courses`);
    navigate("/courses");
    await waitFor(() => T("courses.new"), 3000, "courses page");
    ok(/Create Course/.test(T("courses.new").textContent), `${role}: prominent Create Course button on the course list`);
    ok(!!T("nav.create-course"), `${role}: sidebar Create Course shortcut`);
    click(T("courses.new"));
    await waitFor(() => location.hash.startsWith("#/builder/") && T("course.name"), 4000, "builder");
    const courseId = location.hash.split("/")[2];
    type(T("course.name"), `${role} video course`);
    click(T("course.add-module")); await sleep(100);
    click(T("course.add-lesson")); await sleep(150);
    click(T("block.add")); await sleep(80);
    ok(!!T("block.video"), "Video is in the Add content block menu");
    click(T("block.video"));
    await waitFor(() => q(".vd"), 2000, "video dialog");
    const dlg = q(".vd").textContent;
    ok(/Upload Video/.test(dlg) && /YouTube/.test(dlg) && /Vimeo/.test(dlg) && /Video URL/.test(dlg), "source chooser offers Upload, YouTube, Vimeo and Video URL");
    ok(/Recommended/.test(T("video.source-upload").textContent), "Upload Video is the primary/recommended option");
    click(T("video.source-upload"));
    await waitFor(() => T("video.browse"), 2000, "dropzone");
    ok(/Drag & drop your video here/.test(q(".dropzone").textContent) && /Maximum file size/.test(q(".dropzone").textContent), "drop zone shows instructions and size limit");
    setFile(q('.vd input[type="file"]'), new File(["x"], "notes.txt", { type: "text/plain" }));
    await sleep(150);
    ok(/isn't supported/.test(q(".vd").textContent), "unsupported file type is rejected with a message");
    const file = await makeVideoFile();
    log("NOTE: test file", file.name, file.size, "bytes");
    setFile(q('.vd input[type="file"]'), file);
    await waitFor(() => T("video.progress"), 2000, "progress");
    ok(/Uploading/.test(q(".vd").textContent) || /Processing/.test(q(".vd").textContent), "upload progress is shown");
    await waitFor(() => /Processing/.test(q(".vd")?.textContent || ""), 8000, "processing stage");
    log("DBG dialog:", (q(".vd")?.textContent || "").slice(0, 160));
    ok(/Generating thumbnail/.test(q(".vd").textContent) && /Uploaded/.test(q(".vd").textContent), "processing checklist shown");
    await waitFor(() => /Video ready/.test(q(".vd")?.textContent || ""), 20000, "video ready");
    ok(/Video ready/.test(q(".vd").textContent), "video ready screen shown");
    ok(!!T("video.preview") && !!q(".vd .vp"), "native player preview rendered");
    const v = q(".vd video");
    ok(/Sales Onboarding/.test(q('.vd input[type="text"]').value), "title pre-filled from file name");
    v.dispatchEvent(new Event("play"));
    const decodable = await waitFor(() => v.readyState >= 1, 5000, "video metadata");
    ok(/^data:image/.test(q(".vd .vd-thumb")?.src || "") || !decodable, "thumbnail generated from the video");
    ok(!decodable || /^[0-9]{2}:[0-9]{2}$/.test(q(".vd input[disabled]")?.value || ""), "duration detected: " + q(".vd input[disabled]")?.value);
    log("NOTE: decodable preview:", !!decodable);
    click(T("video.save"));
    await sleep(300);
    ok(!q(".vd"), "dialog closes after Save video");
    ok(/Sales Onboarding/.test(q(".video-summary")?.textContent || ""), "block shows the saved video summary");
    const course = load("courses").find((c) => c.id === courseId);
    const b = course.modules[0].lessons[0].blocks.find((x) => x.type === "video");
    ok(b?.video?.sourceType === "native" && !!b.video.storageKey, "video saved with sourceType=native and a storageKey");
    const online = !!localStorage.getItem("we360.v3.token");
    if (online) {
      const resp = await fetch(`http://localhost:8080/api/videos/${b.video.storageKey}/stream`, { headers: { Authorization: "Bearer " + localStorage.getItem("we360.v3.token") } });
      ok(resp.status === 200, "uploaded file is stored on the backend and streams back (HTTP " + resp.status + ")");
    } else {
      ok(!!(await videoStorage.get(b.video.storageKey)), "uploaded file is stored via the local storage abstraction");
    }
    const radio = [...document.querySelectorAll('input[type="radio"]')].find((r) => /reaches 90%/.test(r.closest("label")?.textContent || ""));
    radio.click(); await sleep(100);
    click(T("lesson.save")); await sleep(500);
    ok(course.modules[0].lessons[0].completion?.rule === "watch90", "completion rule saved on the lesson");
    click(T("course.publish")); await sleep(300);
    ok(course.status === "published", `${role}: course publishes`);
    return { courseId, duration: b.video.duration, decodable: !!decodable, lessonId: course.modules[0].lessons[0].id, blockId: b.id };
  }

  suites.video = async () => {
    const role = new URLSearchParams(location.search).get("as");
    const r = await videoFlow(role);
    if (role !== "instructor") return;
    login(DEMO_USER_BY_ROLE.learner);
    navigate("/explore/" + r.courseId); await sleep(500);
    ok(/Enrol/.test(T("course.start")?.textContent || ""), "learner sees the published course");
    click(T("course.start"));
    await waitFor(() => q(".vp"), 4000, "learner player");
    ok(!!q(".vp") && /Watch the video to 90%/.test(q(".player-bar").textContent), "learner sees the native player and the 90% completion hint");
    ok(!T("player.complete"), "manual Mark complete is replaced by the watch rule");
    const v = q(".vp video");
    const online = !!localStorage.getItem("we360.v3.token");
    const urlOk = (src) => (online ? /\/api\/videos\/.+\/stream/.test(src) : /^blob:/.test(src));
    await waitFor(() => urlOk(v.src), 3000, "playback url");
    ok(urlOk(v.src), `playback URL resolved through the ${online ? "backend" : "local"} storage abstraction: ${v.src.slice(0, 60)}`);
    if (r.decodable) {
      await waitFor(() => v.readyState >= 1, 4000, "metadata");
      v.muted = true;
      q(".vp").player.emit("started");
      v.currentTime = r.duration * 0.5; await sleep(600);
      q(".vp").player.emit("progress"); await sleep(100);
      const e = load("enrollments").find((x) => x.userId === "u-maya" && x.courseId === r.courseId);
      ok(e?.videoProgress?.[r.blockId]?.maxPercent > 40, "watch progress is stored (" + Math.round(e?.videoProgress?.[r.blockId]?.maxPercent || 0) + "%)");
      v.currentTime = r.duration * 0.95; await sleep(1200);
      q(".vp").player.emit("progress");
      await waitFor(() => q(".complete-card"), 3000, "auto-complete");
      ok(!!q(".complete-card"), "reaching 90% completes the lesson automatically");
      navigate("/learn/" + r.courseId + "/" + r.lessonId); await sleep(700);
      ok(/Watched|Video progress/.test(q(".vp-progress")?.textContent || ""), "returning learner sees stored progress: " + (q(".vp-progress")?.textContent || ""));
    } else log("NOTE: skipping playback assertions (no decodable video in this browser)");
    const course = load("courses").find((c) => c.id === r.courseId);
    ok(!videoAccess(load("users").find((u) => u.id === "u-tom"), course).allowed, "unenrolled learner is denied playback access");
    ok(!can(getUser(), "course.edit", course), "learner cannot edit courses");
  };

  const openChoose = async () => {
    navigate("/builder/new");
    await waitFor(() => T("course.name"), 3000, "builder");
    type(T("course.name"), "Sales Onboarding");
    click(T("course.add-module")); await sleep(100);
    click(T("course.add-lesson")); await sleep(150);
    click(T("block.add")); await sleep(80);
    click(T("block.video"));
    await waitFor(() => q(".vd"), 2000, "dialog");
  };
  suites.vdchoose = async () => { await openChoose(); };
  suites.vdupload = async () => { await openChoose(); click(T("video.source-upload")); await sleep(200); };

  suites.review = async () => {
    // Uses a freshly-created course (not a fixed seed id) so this suite stays deterministic even when a real,
    // persistent backend is in play and previous runs have already synced their own edits to the seed courses.
    const { updateSettings } = await import("/src/services/people.js");
    const { publishCourse, addModule, addLesson } = await import("/src/services/courses.js");
    updateSettings({ instructorPublish: false });
    navigate("/builder/new"); await waitFor(() => T("course.name"), 3000, "builder");
    const courseId = location.hash.split("/")[2];
    type(T("course.name"), "Review workflow test " + Date.now());
    click(T("course.add-module")); await sleep(150);
    click(T("course.add-lesson")); await sleep(150);
    await waitFor(() => T("course.publish"), 2000, "publish button ready");
    ok(/Submit for review/.test(T("course.publish").textContent), "instructor without publish rights sees Submit for review");
    click(T("course.publish")); await sleep(300);
    const draft = load("courses").find((c) => c.id === courseId);
    ok(draft.status === "in_review" && /In review/.test(T("course.publish").textContent), "submitting moves the course to In review");
    login(DEMO_USER_BY_ROLE.admin); navigate("/courses"); await sleep(700);
    ok(/In review\s*1/.test(q(".tabs").textContent), "admin sees it under the In review tab");
    ok(publishCourse(courseId, getUser()).status === "published", "admin approves and publishes");
    updateSettings({ instructorPublish: true });
  };

  suites.perms = async () => {
    const users = load("users");
    const admin = users.find((u) => u.id === "u-priya"), inst = users.find((u) => u.id === "u-daniel"), maya = users.find((u) => u.id === "u-maya");
    const mine = load("courses").find((c) => c.instructorId === "u-daniel"), other = { ...mine, instructorId: "u-priya" };
    ok(can(admin, "course.create") && can(inst, "course.create") && !can(maya, "course.create"), "admin + instructor can create, learner cannot");
    ok(can(admin, "course.edit", other) && !can(inst, "course.edit", other) && can(inst, "course.edit", mine), "admin edits any course; instructor only their own");
    ok(can(admin, "course.assign", mine) && !can(inst, "course.assign", mine), "only admin can assign instructors");
    navigate("/builder/" + mine.id); await sleep(500);
    ok(!!T("course.name"), "instructor opens own course in the builder");
  };

  suites.addvideo = async () => {
    navigate("/courses");
    await waitFor(() => T("courses.new"), 3000, "courses");
    guideEngine.open("add-first-video", { source: "help-menu" });
    await sleep(500);
    const at = async (i, label) => { await waitFor(() => guideEngine.state.stepIndex === i, 6000, label); ok(guideEngine.state.stepIndex === i, label); await sleep(150); };
    await at(0, "guide starts at: open the Course Builder");
    const hole = q(".guide-hole"); ok(hole && !hole.hidden, "spotlight on Create Course");
    click(T("courses.new"));
    await at(1, "step 2: add a lesson (highlights Add module first when needed)");
    click(T("course.add-module")); await sleep(200);
    ok(guideEngine.state.stepIndex === 1, "adding only a module keeps step 2 active");
    click(T("course.add-lesson"));
    await at(2, "step 3: select Video");
    click(T("block.add")); await sleep(150);
    const tr = T("block.video").getBoundingClientRect(), hr = q(".guide-hole").getBoundingClientRect();
    ok(Math.abs(hr.left - (tr.left - 6)) < 4, "spotlight moves to the Video menu item once the menu is open");
    click(T("block.video"));
    await at(3, "step 4: Upload Video");
    click(T("video.source-upload"));
    await at(4, "step 5: choose a file");
    const modalRect = q(".modal").getBoundingClientRect(), panelRect = q("#guide-root").getBoundingClientRect();
    ok(modalRect.right <= panelRect.left + 1, "upload UI stays inside the app column; guide panel stays visible");
    setFile(q('.vd input[type="file"]'), await makeVideoFile());
    await at(5, "step 6: wait for upload and processing");
    await at(6, "step 7: preview the video");
    q(".vd video").dispatchEvent(new Event("play"));
    await at(7, "step 8: save the lesson");
    click(T("video.save"));
    await waitFor(() => guideEngine.state.finished, 4000, "guide finished");
    ok(guideEngine.state.finished, "Add Your First Video guide completes");
  };
}

// ---------------- backend-connected persistence proof ----------------
export function registerBackend({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  async function makeVideoFile() {
    try {
      const c = document.createElement("canvas"); c.width = 320; c.height = 180;
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(20), { mimeType: "video/webm" });
      const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      let t = 0;
      const iv = setInterval(() => { g.fillStyle = `hsl(${t * 25},70%,45%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = "#fff"; g.font = "28px sans-serif"; g.fillText("F" + t++, 20, 100); }, 50);
      rec.start(100);
      await new Promise((r) => setTimeout(r, 1200));
      const stopped = new Promise((r) => (rec.onstop = r)); rec.stop(); await stopped; clearInterval(iv);
      return new File(chunks, "Backend-Proof.webm", { type: "video/webm" });
    } catch { return new File([new Uint8Array(4096)], "Backend-Proof.mp4", { type: "video/mp4" }); }
  }
  const setFile = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); };

  // Phase 1 (fresh load): sign in for real, create+upload+publish a course through the actual UI, verify
  //   directly against the backend that it landed in the database, then wipe localStorage entirely (as if
  //   this were a brand-new browser) and reload.
  // Phase 2 (after reload, detected via sessionStorage — which a reload does NOT clear): the app boots
  //   signed out. Sign back in through the real Login screen and confirm the course — title, module, lesson,
  //   video, published status — reappears, pulled fresh from the server into an empty local cache. This is
  //   the literal "create something, refresh the browser, log back in, still see it" requirement.
  suites.backendE2E = async () => {
    const MARK = "we360_e2e_phase";
    if (!sessionStorage.getItem(MARK)) {
      localStorage.clear();
      await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
      ok(!!localStorage.getItem("we360.v3.token"), "real JWT stored after login");
      navigate("/courses");
      await waitFor(() => T("courses.new"), 4000, "courses page");
      click(T("courses.new"));
      await waitFor(() => location.hash.startsWith("#/builder/") && T("course.name"), 4000, "builder");
      const courseId = location.hash.split("/")[2];
      const courseName = "Backend-Connected Course " + Date.now();
      type(T("course.name"), courseName);
      click(T("course.add-module")); await sleep(150);
      click(T("course.add-lesson")); await sleep(200);
      click(T("block.add")); await sleep(100);
      click(T("block.video")); await waitFor(() => q(".vd"), 2000, "video dialog");
      click(T("video.source-upload")); await waitFor(() => T("video.browse"), 2000, "dropzone");
      setFile(q('.vd input[type="file"]'), await makeVideoFile());
      await waitFor(() => /Video ready/.test(q(".vd")?.textContent || ""), 20000, "video ready");
      click(T("video.save")); await sleep(400);
      ok(!q(".vd"), "video dialog closed after save");
      const videoId = JSON.parse(localStorage.getItem("we360.v3.courses")).find((c) => c.id === courseId).modules[0].lessons[0].blocks.find((b) => b.type === "video")?.video?.storageKey;
      ok(!!videoId, "local course object now references a video (storageKey=" + videoId + ")");
      click(T("course.publish")); await sleep(300);
      await flushSyncNow(courseId);
      await sleep(300);

      const token = localStorage.getItem("we360.v3.token");
      const apiGet = (path) => fetch("http://localhost:8080/api" + path, { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
      const server = await apiGet(`/courses/${courseId}`);
      ok(server.title === courseName, "server has the exact course title: " + server.title);
      ok(server.status === "PUBLISHED", "server shows the course as PUBLISHED");
      ok(server.modules.length === 1 && server.modules[0].lessons.length === 1, "server has the module + lesson");
      const serverVideoBlock = server.modules[0].lessons[0].content.find((b) => b.type === "video");
      ok(serverVideoBlock?.video?.storageKey === videoId, "server's lesson content references the same uploaded video id");
      const streamProbe = await fetch(`http://localhost:8080/api/videos/${videoId}/stream?access_token=${token}`);
      ok(streamProbe.status === 200, "the uploaded video file streams back from the backend (HTTP " + streamProbe.status + ")");

      sessionStorage.setItem(MARK, "2");
      sessionStorage.setItem("we360_e2e_title", courseName);
      log("NOTE: wiping localStorage (simulating a brand-new browser) and reloading for phase 2...");
      localStorage.clear();
      // Drop ?as=... too — that's this test harness's own auto-login shortcut, not something a real visitor's
      // URL would carry, and leaving it would immediately re-authenticate before we can prove the app boots signed out.
      location.href = location.pathname + "?selftest=backendE2E";
      await new Promise(() => {}); // navigation away; nothing after this runs in phase 1
    } else {
      // ---- phase 2: fresh load, no local cache, no session ----
      const courseName = sessionStorage.getItem("we360_e2e_title");
      sessionStorage.removeItem(MARK);
      ok(!localStorage.getItem("we360.v3.token") && !localStorage.getItem("we360.v3.courses"), "local cache is genuinely empty after the reload");
      await waitFor(() => q(".role-card"), 4000, "login screen");
      ok(!!q(".role-card"), "app boots to the sign-in screen when signed out, exactly as before");
      click([...document.querySelectorAll(".role-card")].find((c) => /Instructor/.test(c.textContent)));
      await waitFor(() => localStorage.getItem("we360.v3.token"), 4000, "logged back in");
      navigate("/courses");
      await waitFor(() => document.querySelector("#main")?.textContent.includes(courseName), 6000, "course reappears");
      ok(document.querySelector("#main").textContent.includes(courseName), "the course is visible again in My Courses after logging back in: " + courseName);
      ok(/Published/.test(document.querySelector("#main").textContent), "it still shows as Published");
    }
  };
}

// ---------------- quiz / assignment / community / guide backend persistence ----------------
export function registerLearningBackend({ suites, log, ok, sleep, q, click, type, waitFor, navigate, guideEngine }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);

  // Note: these suites do NOT wipe localStorage first (unlike backendE2E) — without a location.reload() to go
  // with it, that would only clear the *browser's* storage while the app's in-memory cache (store.js) keeps
  // serving stale data from before the clear, masking real state rather than resetting it. A fresh Chrome
  // profile per test run (see rt.sh) already gives each suite a clean slate. They also each build a brand-new,
  // single-lesson course rather than reusing the shared seed courses, which accumulate real completion state
  // across every run against the same persistent backend — a fresh course sidesteps that entirely.
  async function createSingleLessonCourse(lessonType) {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/builder/new"); await waitFor(() => T("course.name"), 3000, "builder");
    const courseId = location.hash.split("/")[2];
    type(T("course.name"), lessonType + " test " + Date.now());
    click(T("course.add-module")); await sleep(200);
    const dd = document.querySelector('button[aria-label="Add another lesson type"]');
    dd.click(); await sleep(100);
    [...document.querySelectorAll(".menu-item")].find((i) => new RegExp(lessonType, "i").test(i.textContent)).click();
    await sleep(300);
    if (lessonType === "quiz") {
      const addQ = [...document.querySelectorAll("button")].find((b) => /Add question/.test(b.textContent));
      addQ.click(); await sleep(80);
      [...document.querySelectorAll(".menu-item")].find((i) => /Multiple choice/.test(i.textContent)).click();
      await sleep(150);
      const qcard = q(".qeditor");
      type(qcard.querySelector("textarea"), "Is this a real backend-connected question?");
      const opts = qcard.querySelectorAll('input[aria-label^="Option"]');
      type(opts[0], "Yes"); type(opts[1], "No"); type(opts[2], "Maybe");
      qcard.querySelector('input[type="radio"]').click();
      await sleep(150);
    } else {
      const brief = q('textarea[aria-label="Assignment brief"]');
      if (brief) { type(brief, "Write a short response for this backend-connected assignment test."); await sleep(150); }
    }
    click(T("course.publish")); await sleep(400);
    const lessonId = JSON.parse(localStorage.getItem("we360.v3.courses")).find((c) => c.id === courseId).modules[0].lessons[0].id;
    return { courseId, lessonId };
  }

  suites.quizBackend = async () => {
    // The UI mechanics of taking a quiz (question → answer → feedback → result) are already covered end-to-end
    // by the earlier `quiz` suite against the seeded course. What's new here is the backend sync, so this calls
    // the same connected service function the Player's "onFinish" callback calls, on a freshly-created lesson.
    const { courseId, lessonId } = await createSingleLessonCourse("quiz");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    const { saveQuizResult } = await import("/src/services/learning.js");
    // The attempt carries the actual answers: the backend scores them itself and ignores the claimed score.
    const quiz = load("courses").find((c) => c.id === courseId).modules[0].lessons[0].quiz;
    const answers = Object.fromEntries(quiz.questions.map((qq) => [qq.id, qq.answer]));
    saveQuizResult("u-maya", courseId, lessonId, { score: 100, passed: true, answers });
    await sleep(400);
    const token = localStorage.getItem("we360.v3.token");
    const attempts = await fetch(`http://localhost:8080/api/lessons/${lessonId}/quiz-attempts`, { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
    ok(attempts.length > 0 && attempts[0].score === 100, "quiz attempt persisted on the backend (" + attempts.length + " attempt(s), last score " + attempts[0]?.score + "%)");
  };

  suites.assignmentBackend = async () => {
    const { courseId, lessonId } = await createSingleLessonCourse("assignment");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate(`/learn/${courseId}/${lessonId}`);
    await waitFor(() => q('textarea[aria-label="Your submission"]'), 4000, "assignment lesson");
    type(q('textarea[aria-label="Your submission"]'), "This is my real submitted answer for the backend-connected assignment test, well over twenty characters.");
    click([...document.querySelectorAll("button")].find((b) => /Submit assignment/.test(b.textContent)));
    await sleep(400);
    const token = localStorage.getItem("we360.v3.token");
    const mine = await fetch(`http://localhost:8080/api/lessons/${lessonId}/submissions/me`, { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
    ok(mine && mine.status === "SUBMITTED", "assignment submission persisted on the backend: " + JSON.stringify(mine?.body || "").slice(0, 40));
  };

  suites.communityBackend = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate("/community"); await waitFor(() => q(".post"), 3000, "feed");
    const title = q('input[aria-label="Title"]');
    const uniqueTitle = "Backend community test " + Date.now();
    type(title, uniqueTitle);
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Post").click();
    await sleep(400);
    const token = localStorage.getItem("we360.v3.token");
    const posts = await fetch("http://localhost:8080/api/community/posts", { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
    ok(posts.some((p) => p.title === uniqueTitle), "new community post persisted on the backend");
  };

  suites.guideBackend = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/courses"); await waitFor(() => T("courses.new"), 3000, "courses");
    click('[data-guide-launch="create-first-course"]'); await sleep(300);
    click(T("courses.new")); await waitFor(() => T("course.name"), 3000, "builder");
    type(T("course.name"), "Guide backend test " + Date.now());
    await waitFor(() => guideEngine?.state?.stepIndex >= 1, 3000, "guide step advances"); // the "name" step settles ~1s after typing stops
    await sleep(400);
    const token = localStorage.getItem("we360.v3.token");
    const progress = await fetch("http://localhost:8080/api/guides/progress", { headers: { Authorization: "Bearer " + token } }).then((r) => r.json());
    const g = progress.find((p) => p.guideId === "create-first-course");
    ok(!!g && g.stepIndex >= 1, "guide step progress persisted on the backend (step " + g?.stepIndex + ")");
  };

  shared.createSingleLessonCourse = createSingleLessonCourse;
}

// Helpers shared between suite groups (populated by registerLearningBackend, consumed by registerFinal).
const shared = {};

// ---------------- video resume, certificate verification, fresh-quiz click-through ----------------
export function registerFinal({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v3.token");
  const apiGet = (path) => fetch("http://localhost:8080/api" + path, { headers: { Authorization: "Bearer " + token() } }).then((r) => (r.ok ? r.json() : null));
  const setFile = (input, file) => { const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); };
  const localCourses = () => JSON.parse(localStorage.getItem("we360.v3.courses") || "[]");

  async function makeVideoFile(seconds) {
    const c = document.createElement("canvas"); c.width = 320; c.height = 180;
    const g = c.getContext("2d");
    const rec = new MediaRecorder(c.captureStream(20), { mimeType: "video/webm" });
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let t = 0;
    const iv = setInterval(() => { g.fillStyle = `hsl(${t * 7},70%,45%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = "#fff"; g.font = "28px sans-serif"; g.fillText("F" + t++, 20, 100); }, 50);
    rec.start(100);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const stopped = new Promise((r) => (rec.onstop = r)); rec.stop(); await stopped; clearInterval(iv);
    return new File(chunks, "Resume-Test.webm", { type: "video/webm" });
  }

  // Instructor: brand-new published course whose only lesson holds one uploaded native video.
  async function createVideoCourse(seconds) {
    await loginReal(DEMO_EMAIL_BY_ROLE.instructor, DEMO_PASSWORD);
    navigate("/builder/new"); await waitFor(() => T("course.name"), 4000, "builder");
    const courseId = location.hash.split("/")[2];
    type(T("course.name"), "Video resume test " + Date.now());
    click(T("course.add-module")); await sleep(150);
    click(T("course.add-lesson")); await sleep(200);
    click(T("block.add")); await sleep(100);
    click(T("block.video")); await waitFor(() => q(".vd"), 2000, "video dialog");
    click(T("video.source-upload")); await waitFor(() => T("video.browse"), 2000, "dropzone");
    setFile(q('.vd input[type="file"]'), await makeVideoFile(seconds));
    await waitFor(() => /Video ready/.test(q(".vd")?.textContent || ""), 25000, "video ready");
    click(T("video.save")); await sleep(400);
    click(T("course.publish")); await sleep(300);
    await flushSyncNow(courseId); await sleep(300);
    const lessonId = localCourses().find((c) => c.id === courseId).modules[0].lessons[0].id;
    return { courseId, lessonId };
  }

  // WATCH → reach a position → persisted on the backend → wipe local storage + reload → log back in → reopen the
  // same lesson → the player offers "Resume from mm:ss" straight from the server's row.
  suites.videoResume = async () => {
    const MARK = "we360_resume_phase";
    if (!sessionStorage.getItem(MARK)) {
      const { courseId, lessonId } = await createVideoCourse(9);
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      await waitFor(() => localCourses().some((c) => c.id === courseId), 15000, "catalog hydrated");
      navigate(`/learn/${courseId}/${lessonId}`);
      await waitFor(() => q(".vp video"), 20000, "player");
      const v = q(".vp video");
      await waitFor(() => /\/api\/videos\/.+\/stream/.test(v.src) && v.readyState >= 1, 20000, "video metadata from backend stream");
      v.muted = true;
      q(".vp").player.emit("started");
      v.currentTime = 6.5; await sleep(700);
      q(".vp").player.emit("paused"); // pause → immediate (unthrottled) backend save
      let server = null;
      for (let i = 0; i < 20 && !server; i++) { const rows = await apiGet(`/courses/${courseId}/progress/detail`); const r = rows?.find((x) => x.lessonId === lessonId); if (r && r.lastPosition >= 6) server = r; else await sleep(300); }
      ok(!!server, "watch position persisted on the backend (lastPosition=" + (server?.lastPosition?.toFixed(1)) + "s, " + Math.round(server?.watchPercentage || 0) + "%)");
      sessionStorage.setItem(MARK, "2");
      sessionStorage.setItem("we360_resume_course", courseId);
      sessionStorage.setItem("we360_resume_lesson", lessonId);
      log("NOTE: wiping localStorage and reloading; the resume position must come back from the backend...");
      q(".vp video")?.pause(); await sleep(300); // stop progress saves racing the wipe
      localStorage.clear();
      location.href = location.pathname + "?selftest=videoResume";
      await new Promise(() => {});
    } else {
      const courseId = sessionStorage.getItem("we360_resume_course"), lessonId = sessionStorage.getItem("we360_resume_lesson");
      sessionStorage.removeItem(MARK);
      ok(!localStorage.getItem("we360.v3.enrollments"), "no local progress exists after the reload");
      await waitFor(() => q(".role-card, [data-login-email]"), 10000, "login screen");
      await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
      await waitFor(() => localCourses().some((c) => c.id === courseId), 15000, "catalog hydrated");
      navigate(`/learn/${courseId}/${lessonId}`);
      await waitFor(() => q('[data-vp="resume"]'), 15000, "resume prompt");
      const prompt = q('[data-vp="resume"]');
      ok(!!prompt && /Resume from 00:0[5-9]/.test(prompt.textContent), "player offers to resume from the persisted position: " + (prompt?.textContent || "(no prompt)"));
      ok(/Video progress \d+%/.test(q(".vp-progress")?.textContent || ""), "progress row restored: " + (q(".vp-progress")?.textContent || ""));
      prompt.click(); await sleep(400);
      const v = q(".vp video");
      ok(v.currentTime >= 5.5, "clicking Resume seeks the video to the saved position (" + v.currentTime.toFixed(1) + "s)");
    }
  };

  // Backend-authoritative verification: valid → revoked → unknown, through the existing Verify page.
  suites.certVerify = async () => {
    const { courseId, lessonId } = await shared.createSingleLessonCourse("lesson");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    await waitFor(() => localCourses().some((c) => c.id === courseId), 6000, "catalog hydrated");
    navigate(`/learn/${courseId}/${lessonId}`);
    await waitFor(() => T("player.complete"), 5000, "player");
    click(T("player.complete"));
    await waitFor(() => q(".complete-card"), 3000, "completion");
    let cert = null;
    for (let i = 0; i < 20 && !cert; i++) { const certs = await apiGet("/certificates"); cert = certs?.find((c) => c.courseId === courseId) || null; if (!cert) await sleep(300); }
    ok(!!cert && /^WE360-\d{4}-[A-Z0-9]{6}$/.test(cert.certificateNumber), "certificate issued by the backend with the standard number format: " + cert?.certificateNumber);

    navigate(`/verify/${cert.certificateNumber}`);
    await waitFor(() => q('[data-verify="valid"]'), 5000, "valid result");
    ok(!!q('[data-verify="valid"]') && /Valid certificate/.test(q("#main").textContent), "verify page shows Valid certificate from the backend");

    const admin = await fetch("http://localhost:8080/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: DEMO_EMAIL_BY_ROLE.admin, password: DEMO_PASSWORD }) }).then((r) => r.json());
    const rev = await fetch(`http://localhost:8080/api/certificates/${cert.id}/revoke`, { method: "POST", headers: { Authorization: "Bearer " + admin.token } });
    ok(rev.ok, "admin revoked the certificate via the API");
    navigate(`/verify/${cert.certificateNumber}`);
    await waitFor(() => q('[data-verify="revoked"]'), 5000, "revoked result");
    ok(!!q('[data-verify="revoked"]') && /was revoked/.test(q("#main").textContent), "verify page now reports the certificate as revoked");

    navigate("/verify/WE360-2026-NOPE00");
    await waitFor(() => q('[data-verify="not-found"]'), 5000, "not-found result");
    ok(!!q('[data-verify="not-found"]') && /No certificate found/.test(q("#main").textContent), "unknown number reports No certificate found");
  };

  // Regression for the earlier anomaly: a quiz question created fresh in the Builder, taken by a learner via
  // real clicks (radio → Check answer → Next → result), then the attempt verified on the backend.
  suites.quizFresh = async () => {
    const { courseId, lessonId } = await shared.createSingleLessonCourse("quiz");
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    await waitFor(() => localCourses().some((c) => c.id === courseId), 6000, "catalog hydrated");
    navigate(`/learn/${courseId}/${lessonId}`);
    await waitFor(() => q(".quiz .qview"), 5000, "quiz question");
    await sleep(800); // give any post-login hydration a chance to settle before interacting
    const runner = q(".quiz");
    q('.qopt input[type="radio"]').click();
    await sleep(150);
    // The runner redraws its own question panel on every selection by design; what must NOT happen is the whole
    // Player being re-mounted underneath the learner (which is what lost the selection before).
    ok(q(".quiz") === runner && !!q('.qopt input[type="radio"]:checked'), "selection retained — the Player was not re-mounted underneath the learner");
    const check = q('[data-quiz-action="check"]');
    ok(!!check && !check.disabled, "Check answer becomes enabled after choosing an option");
    check.click(); await sleep(150);
    ok(!!q(".qfeedback"), "feedback shown after Check answer");
    q('[data-quiz-action="next"]').click();
    await waitFor(() => /You passed|Almost there|Keep practising|review and try again/.test(q(".quiz")?.textContent || ""), 3000, "quiz result");
    ok(/You passed/.test(q(".quiz").textContent), "result screen reached (passed)");
    let attempts = null; // the save is a background request; poll rather than assume a fixed latency
    for (let i = 0; i < 12 && !(attempts && attempts.length); i++) { await sleep(400); attempts = await apiGet(`/lessons/${lessonId}/quiz-attempts`); }
    ok(attempts?.length > 0 && attempts[0].passed, "attempt persisted on the backend (score " + attempts?.[0]?.score + "%)");
  };
}
