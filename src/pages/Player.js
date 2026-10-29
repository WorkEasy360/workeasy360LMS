// Course player: outline, lesson content, completion loop (progress → unlock → journey → skills), quiz, assignment, notes, inline discussion.
import { h, debounce, pluralize, fmtDate } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Badge, StatusBadge } from "../components/Badge.js";
import { Progress, ProgressRing } from "../components/Progress.js";
import { LessonCard } from "../components/Domain.js";
import { EmptyState, ErrorState, LoadingState } from "../components/States.js";
import { Textarea, Field } from "../components/Form.js";
import { openDrawer, toast } from "../components/Overlay.js";
import { Composer, PostCard } from "../components/Post.js";
import { QuizRunner } from "../quiz/QuizRunner.js";
import { renderBlocks } from "../builder/blocks.js";
import { getCourse, lessonsOf, findLesson, moduleOfLesson, courseTitle, LESSON_TYPES } from "../services/courses.js";
import { enroll, getEnrollment, courseProgress, isLessonDone, isLessonUnlocked, nextLesson, completeLesson, saveQuizResult, submitAssignment, setNote, toggleBookmark } from "../services/learning.js";
import { listPosts } from "../services/community.js";
import { navigate, refreshRoute } from "../router.js";
import { recordVideoEvent, syncVideoProgress, getVideoProgress, completionThreshold, videoOf } from "../services/videos.js";
import { hydrateLessonProgress } from "../services/learningSync.js";
import { refreshCourse } from "../services/courseSync.js";
import { bus } from "../lib/events.js";

export function PlayerPage(ctx) {
  const user = ctx.user;
  const course = getCourse(ctx.params.courseId);
  if (!course || (course.status !== "published" && user.role === "learner")) {
    // A deep link (bookmark, e-mail, second device) can arrive before this browser has ever seen the course:
    // ask the backend for it before declaring it unavailable, and re-render when it lands.
    const el = h("div", {}, LoadingState("Opening this course…"));
    refreshCourse(ctx.params.courseId).then((tree) => {
      if (!el.isConnected) return;
      if (tree && (user.role !== "learner" || String(tree.status).toLowerCase() === "published")) return refreshRoute();
      el.replaceChildren(ErrorState({ title: "This course isn't available", description: "It may be unpublished or removed.", onRetry: () => navigate("/my-learning") }));
    });
    return { title: "Course unavailable", crumbs: [{ label: "My Learning", href: "/my-learning" }, { label: "Unavailable" }], el };
  }
  // Paid course without an entitlement (purchase or assignment): the content is locked server-side and redacted locally.
  if (user.role === "learner" && (course.locked || (course.price > 0 && !getEnrollment(user.id, course.id)))) {
    return { title: courseTitle(course), crumbs: [{ label: "Explore", href: "/explore" }, { label: courseTitle(course) }], el: h("div", { "data-player-locked": "" }, EmptyState({ icon: "lock", title: "This course is locked", description: "Purchase the course to open its lessons. Everything you've already bought is in My Learning.", action: Button({ label: "View course & purchase", icon: "arrow-right", variant: "primary", href: `/explore/${course.id}` }) })) };
  }
  const all = lessonsOf(course);
  const e = enroll(user.id, course.id);
  if (!all.length) return { title: courseTitle(course), crumbs: [{ label: courseTitle(course) }], el: EmptyState({ icon: "layers", title: "No lessons yet", description: "The instructor is still building this course." }) };

  let lesson = ctx.params.lessonId ? findLesson(course, ctx.params.lessonId) : null;
  if (!lesson) {
    navigate(`/learn/${course.id}/${(nextLesson(course, e) || all[0]).id}`, { replace: true });
    return null;
  }
  if (!isLessonUnlocked(course, e, lesson.id)) {
    toast("Finish the previous lesson to unlock that one.", { type: "info" });
    navigate(`/learn/${course.id}/${(nextLesson(course, e) || all[0]).id}`, { replace: true });
    return null;
  }

  const idx = all.findIndex((l) => l.id === lesson.id);
  const prev = all[idx - 1], following = all[idx + 1];
  const mod = moduleOfLesson(course, lesson.id);
  const href = (l) => `/learn/${course.id}/${l.id}`;
  let outlineOpen = !matchMedia("(max-width: 900px)").matches;
  let justUnlocked = null;

  const root = h("div", { class: ["player", !outlineOpen && "outline-closed"] });
  const outlineEl = h("aside", { class: "player-outline", "aria-label": "Course outline" });
  const ringHolder = h("span");
  const bookmarkBtnHolder = h("span");
  const barEl = h("div", { class: "player-bar" });
  const completionHost = h("div");
  const contentEl = h("div", { class: "stack-lg" });

  const done = () => isLessonDone(e, lesson.id);

  // Native / hosted-file videos report progress; a completion rule can finish the lesson automatically.
  const trackedVideo = lesson.blocks.find((b) => b.type === "video" && ["native", "external"].includes(videoOf(b)?.sourceType));
  const threshold = trackedVideo ? completionThreshold(lesson) : null;
  let videoStarted = false, lastVideoState = null; // for the authoritative-progress refresh + page-hide flush below
  const videoCtx = {
    user, course, lesson, tracking: true,
    onVideoEvent: (b, evt) => {
      if (evt.type === "started" || evt.type === "resumed") videoStarted = true;
      const p = recordVideoEvent(user.id, course.id, lesson.id, b.id, evt);
      lastVideoState = p ? { blockId: b.id, vp: p } : lastVideoState;
      if (p && threshold && b.id === trackedVideo.id && !done() && p.maxPercent >= threshold - 0.5) { toast(`Video watched to ${threshold}% — lesson complete`, { duration: 2400 }); complete(); }
      return p;
    },
  };
  // Persist the very last position even if the tab is closed mid-watch (keepalive request survives unload).
  const flushOnHide = () => { if (lastVideoState) syncVideoProgress(lesson.id, lastVideoState.blockId, lastVideoState.vp, "paused", { keepalive: true }); };
  window.addEventListener("pagehide", flushOnHide);

  // ---------- outline ----------
  function drawOutline() {
    const p = courseProgress(user.id, course.id);
    outlineEl.replaceChildren(
      h("div", { class: "stack-sm", style: "padding:4px 4px 12px" }, [
        h("div", { class: "eyebrow" }, "Course"), h("h3", {}, courseTitle(course)),
        Progress(p.pct, { size: "sm", label: "Course progress" }), h("div", { class: "xs muted" }, `${p.done} of ${p.total} lessons · ${p.pct}%`),
      ]),
      ...course.modules.map((m) => h("div", { class: "stack-sm", style: "margin-top:12px" }, [
        h("div", { class: "eyebrow", style: "padding:0 6px" }, m.title),
        ...m.lessons.map((l) => {
          const row = LessonCard({ lesson: l, status: isLessonDone(e, l.id) ? "done" : "todo", active: l.id === lesson.id, locked: !isLessonUnlocked(course, e, l.id), href: href(l) });
          if (l.id === justUnlocked) row.classList.add("just-unlocked");
          return row;
        }),
      ])),
    );
    const pct = p.pct;
    ringHolder.replaceChildren(ProgressRing(pct, { size: 40, stroke: 5 }));
  }

  // ---------- top bar ----------
  function drawBookmark() {
    const on = e.bookmarks.includes(lesson.id);
    bookmarkBtnHolder.replaceChildren(Button({ icon: "bookmark", variant: on ? "soft" : "ghost", size: "sm", title: on ? "Remove bookmark" : "Bookmark this lesson", attrs: { "aria-pressed": String(on) }, onClick: () => { const now = toggleBookmark(user.id, course.id, lesson.id); toast(now ? "Lesson bookmarked" : "Bookmark removed", { type: "info", duration: 1800 }); drawBookmark(); } }));
  }

  const top = h("div", { class: "player-top" }, [
    Button({ icon: "menu", variant: "ghost", size: "sm", title: "Toggle course outline", attrs: { "aria-expanded": String(outlineOpen) }, onClick: (ev) => { outlineOpen = !outlineOpen; root.classList.toggle("outline-closed", !outlineOpen); ev.currentTarget.setAttribute("aria-expanded", String(outlineOpen)); } }),
    h("div", { class: "grow", style: "min-width:160px" }, [h("div", { class: "xs muted strong" }, `${courseTitle(course)} · ${mod?.title || ""}`), h("div", { class: "strong truncate" }, lesson.title)]),
    ringHolder, bookmarkBtnHolder,
    Button({ label: "Notes", icon: "edit", variant: "ghost", size: "sm", onClick: openNotes }),
    Button({ label: `Discussion${discussionCount() ? ` (${discussionCount()})` : ""}`, icon: "message", variant: "secondary", size: "sm", attrs: { "data-guide-target": "player.discussion" }, onClick: openDiscussion }),
    user.role === "learner" && Button({ label: "Ask the coach", icon: "sparkles", variant: "secondary", size: "sm", attrs: { "data-guide-target": "player.coach" }, href: `/coach?lessonId=${lesson.id}` }),
  ]);

  // ---------- discussion + notes (without leaving the lesson) ----------
  function discussionCount() { return listPosts({ courseId: course.id, lessonId: lesson.id }).length; }
  function discussionThread() {
    const wrap = h("div", { class: "stack" });
    const paint = () => {
      const posts = listPosts({ courseId: course.id, lessonId: lesson.id });
      wrap.replaceChildren(
        Composer({ user, courseId: course.id, lessonId: lesson.id, compact: true, onPosted: paint, defaultKind: "question" }),
        ...(posts.length ? posts.map((p) => PostCard({ post: p, user, canPin: user.role !== "learner" })) : [h("div", { class: "card" }, EmptyState({ icon: "message", title: "Start the conversation", description: "Ask a question or share an insight about this lesson." }))])
      );
    };
    paint();
    return wrap;
  }
  function openDiscussion() { openDrawer({ title: `Discussion · ${lesson.title}`, content: discussionThread() }); }

  function openNotes() {
    const status = h("span", { class: "save-indicator saved" }, "Saved");
    const save = debounce((v) => { setNote(user.id, course.id, lesson.id, v); status.textContent = "Saved"; status.className = "save-indicator saved"; }, 500);
    openDrawer({ title: "My notes", content: h("div", { class: "stack" }, [
      h("p", { class: "small muted" }, `Private notes for “${lesson.title}”.`),
      Textarea({ rows: 10, value: e.notes[lesson.id] || "", placeholder: "Capture key ideas, questions and next steps…", "aria-label": "Notes", oninput: (ev) => { status.textContent = "Saving…"; status.className = "save-indicator saving"; save(ev.target.value); } }),
      status,
    ]) });
  }

  // ---------- lesson content ----------
  // Resume position the player was last drawn with (mirrors blocks.js's resumeAt rule), so a later hydration
  // that changes it — from any source — can trigger a redraw, but a no-op hydration doesn't.
  const resumeOf = () => {
    const p = trackedVideo ? getVideoProgress(user.id, course.id, trackedVideo.id) : null;
    return p && !p.completed && p.percent < 95 ? p.lastPosition || p.position || 0 : 0;
  };
  let renderedResume = 0;
  const redrawIfResumeChanged = () => {
    if (!root.isConnected || !trackedVideo || videoStarted) return;
    if (resumeOf() !== renderedResume) { drawOutline(); drawContent(); drawBar(); }
  };

  function drawContent() {
    const t = LESSON_TYPES[lesson.type] || LESSON_TYPES.lesson;
    renderedResume = resumeOf();
    contentEl.replaceChildren(
      h("div", { class: "stack-sm" }, [
        h("div", { class: "row-sm wrap" }, [Badge(t.label, "primary", t.icon), h("span", { class: "small muted" }, `${lesson.duration || 0} min`), done() && Badge("Completed", "success", "check")]),
        h("h1", { id: "page-title", tabindex: "-1" }, lesson.title),
      ]),
      lessonBody(),
      completionHost
    );
  }

  function lessonBody() {
    if (lesson.type === "quiz") return quiz();
    if (lesson.type === "assignment") return assignment();
    const parts = [lesson.blocks.length ? renderBlocks(lesson.blocks, videoCtx) : h("div", { class: "card" }, EmptyState({ icon: "file", title: "Nothing here yet", description: "The instructor hasn't added content to this lesson." }))];
    if (lesson.type === "discussion") parts.push(h("div", { class: "stack" }, [h("h2", {}, "Join the conversation"), discussionThread()]));
    return h("div", { class: "stack-lg" }, parts);
  }

  function quiz() {
    const qz = lesson.quiz || { questions: [], passScore: 70 };
    const best = e.quiz[lesson.id];
    return h("div", { class: "stack" }, [
      best?.passed && h("div", { class: "callout tip" }, [ico("check-circle", 18), `You passed this quiz with ${best.score}%. You can retake it any time.`]),
      lesson.blocks.length > 0 && renderBlocks(lesson.blocks, videoCtx),
      QuizRunner({
        questions: qz.questions, passScore: qz.passScore, title: lesson.title,
        onFinish: (r) => { saveQuizResult(user.id, course.id, lesson.id, r); if (r.passed && !done()) complete(); },
        onContinue: () => (following ? navigate(href(following)) : navigate(`/explore/${course.id}`)), continueLabel: following ? "Continue to next lesson" : "Finish course",
        onReview: prev ? () => navigate(href(prev)) : undefined, reviewLabel: prev ? `Review “${prev.title}”` : "Review",
      }),
    ]);
  }

  function assignment() {
    const a = lesson.assignment || { brief: "", rubric: [] };
    const sub = e.submissions[lesson.id];
    const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true });
    const input = Textarea({ rows: 7, placeholder: "Write or paste your response…", "aria-label": "Your submission", value: sub?.text && sub.text !== "Submitted for review." ? sub.text : "" });
    const submit = () => {
      if (input.value.trim().length < 20) { err.textContent = "Write at least a couple of sentences (20+ characters) before submitting."; err.hidden = false; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
      submitAssignment(user.id, course.id, lesson.id, input.value.trim());
      toast("Assignment submitted for review");
      if (!done()) complete();
      drawContent(); drawBar();
    };
    return h("div", { class: "stack" }, [
      h("div", { class: "card card-pad stack-sm" }, [h("h3", {}, "Brief"), h("p", { style: "white-space:pre-wrap;color:var(--c-text-2)" }, a.brief || "No brief provided."),
        a.rubric.length > 0 && h("div", {}, [h("div", { class: "label", style: "margin:8px 0 6px" }, "You'll be assessed on"), h("ul", { class: "stack-sm" }, a.rubric.map((r) => h("li", { class: "row-sm small" }, [ico("check", 16), r])))])]),
      sub
        ? h("div", { class: "card card-pad stack-sm" }, [h("div", { class: "row-between" }, [h("h3", {}, "Your submission"), StatusBadge(sub.status)]), h("p", { class: "small muted" }, `Submitted ${fmtDate(sub.at)}`), sub.feedback && h("div", { class: "callout tip" }, [ico("message", 18), h("div", {}, [h("strong", {}, "Instructor feedback: "), sub.feedback])])])
        : h("div", { class: "card card-pad stack-sm" }, [Field({ label: "Your submission", control: input }), err, h("div", { class: "row", style: "justify-content:flex-end" }, Button({ label: "Submit assignment", icon: "send", variant: "primary", onClick: submit, attrs: { "data-guide-target": "player.submit" } }))]),
    ]);
  }

  // ---------- completion loop ----------
  function complete() {
    const result = completeLesson(user.id, course.id, lesson.id);
    justUnlocked = result.unlocked?.id || null;
    drawOutline(); drawBar();
    completionHost.replaceChildren(completionCard(result));
    completionHost.scrollIntoView({ block: "center", behavior: "smooth" });
    top.querySelector(".badge-done")?.remove();
    return result;
  }

  function completionCard(r) {
    const bar = Progress(r.courseBefore, { label: "Course progress" });
    setTimeout(() => bar.setValue(r.courseAfter), 400);
    const step = (icon, body) => h("div", { class: "chain-step" }, [h("span", { class: "chain-dot" }, ico(icon, 16)), h("div", { class: "grow" }, body)]);
    const steps = [
      step("check", [h("strong", {}, r.already ? "Already completed" : "Lesson complete"), h("div", { class: "small muted" }, lesson.title)]),
      step("chart", [h("strong", {}, `Course progress ${r.courseBefore}% → ${r.courseAfter}%`), h("div", { style: "margin-top:6px" }, bar)]),
      r.unlocked ? step("lock", [h("strong", {}, "Next lesson unlocked"), h("div", { class: "small muted" }, r.unlocked.title)]) : null,
      ...r.journeys.map((j) => step("route", [h("strong", {}, `Learning journey updated`), h("div", { class: "small muted" }, `${j.title}: ${j.before}% → ${j.pct}%`)])),
      ...r.skills.slice(0, 3).map((s) => step("target", [h("strong", {}, `${s.skill.name} skill +${s.level - s.before}%`), h("div", { class: "small muted" }, `${s.before}% → ${s.level}% (target ${s.target}%)`)])),
    ].filter(Boolean);
    return h("section", { class: "complete-card", "aria-label": "Lesson completed" }, [
      h("h2", { tabindex: "-1" }, r.courseCompleted ? "🎉 Course complete!" : "Nice work!"),
      h("div", { class: "chain" }, steps),
      r.courseCompleted && r.certificate && h("div", { class: "callout tip", style: "margin-top:16px" }, [ico("award", 18), h("div", { class: "grow" }, [h("strong", {}, "Your certificate is ready. "), r.certificate.id]), Button({ label: "View certificate", size: "sm", variant: "primary", href: "/certificates" })]),
    ]);
  }

  // ---------- bottom bar ----------
  function drawBar() {
    const isDone = done();
    const nextBtn = following
      ? Button({ label: "Next lesson", iconRight: "arrow-right", variant: "primary", href: href(following), attrs: { "data-guide-target": "player.next" } })
      : Button({ label: "Finish course", iconRight: "check", variant: "primary", href: `/explore/${course.id}` });
    let primary;
    if (isDone) primary = nextBtn;
    else if (["quiz", "assignment"].includes(lesson.type)) primary = h("span", { class: "small muted row-sm" }, [ico("lock", 16), lesson.type === "quiz" ? `Pass the quiz (${lesson.quiz?.passScore ?? 70}%) to continue` : "Submit your assignment to continue"]);
    else if (threshold) primary = h("span", { class: "small muted row-sm", "data-guide-target": "player.watch-hint" }, [ico("video", 16), `Watch the video to ${threshold}% to complete this lesson`]);
    else primary = Button({ label: "Mark complete", icon: "check-circle", variant: "primary", attrs: { "data-guide-target": "player.complete" }, onClick: complete });
    barEl.replaceChildren(
      prev ? Button({ label: "Previous", icon: "arrow-left", variant: "ghost", href: href(prev) }) : h("span"),
      h("span", { class: "grow small muted center" }, `Lesson ${idx + 1} of ${all.length}`),
      isDone && !following ? null : null,
      primary
    );
  }

  const main = h("div", { class: "player-main" }, [top, h("div", { class: "player-scroll" }, h("div", { class: "player-content" }, contentEl)), barEl]);
  root.append(outlineEl, main);
  drawOutline(); drawBookmark(); drawContent(); drawBar();

  // The backend is the authority for progress: pull this course's rows on load (fresh browser, other device, or
  // logout/login) and, if that changed the resume position before the learner pressed play, redraw the lesson
  // content so the player's "Resume from mm:ss" reflects it. Newer local positions are never overwritten.
  hydrateLessonProgress(user.id, course.id)
    .then((changed) => { if (changed && root.isConnected) { drawOutline(); drawBar(); } redrawIfResumeChanged(); })
    .catch((err) => console.warn("[player] could not refresh progress from backend:", err.message));
  // The login-time hydration (learningSync.hydrateMyLearning) may land after this page mounted; react to it too.
  const offEnrollments = bus.on("data:enrollments", redrawIfResumeChanged);

  return {
    title: lesson.title, bleed: true, crumbs: [{ label: "My Learning", href: "/my-learning" }, { label: courseTitle(course), href: `/explore/${course.id}` }, { label: lesson.title }], el: root,
    destroy: () => { flushOnHide(); window.removeEventListener("pagehide", flushOnHide); offEnrollments(); },
  };
}
