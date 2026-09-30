// Course Builder: visual editor — outline (modules / lessons) + canvas (details, lesson blocks, quiz, assignment) + learner preview.
import { h, debounce, announce, pluralize } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { load } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { Dropdown } from "../components/Menu.js";
import { Field, Input, Textarea, Select, Switch } from "../components/Form.js";
import { Badge, StatusBadge } from "../components/Badge.js";
import { EmptyState, ErrorState } from "../components/States.js";
import { openModal, confirmDialog, toast } from "../components/Overlay.js";
import { Cover } from "../components/Domain.js";
import { GuideButton } from "../components/GuideButton.js";
import { QuizRunner } from "../quiz/QuizRunner.js";
import { QuestionEditor } from "../builder/QuestionEditor.js";
import { openAiQuizPanel } from "../builder/AiQuizPanel.js";
import { newQuestion, QUESTION_TYPES } from "../quiz/engine.js";
import { BLOCK_TYPES, newBlock, renderBlocks, chooseVideo } from "../builder/blocks.js";
import { CURRENCIES } from "../services/pricing.js";
import { can } from "../services/permissions.js";
import { videoOf, COMPLETION_RULES } from "../services/videos.js";
import { users } from "../services/people.js";
import { navigate } from "../router.js";
import {
  getCourse, mutate, setTitle, addModule, addLesson, removeModule, removeLesson, moveModule, moveLesson, duplicateLesson, findLesson, moduleOfLesson,
  publishReadiness, publishCourse, unpublishCourse, archiveCourse, restoreCourse, assignInstructor, setVisibility, courseTitle, lessonsOf, courseMinutes, LESSON_TYPES, COVER_ICONS, CATEGORIES, LEVELS,
} from "../services/courses.js";

export function CourseBuilderPage(ctx) {
  const course = getCourse(ctx.params.id);
  if (!course) {
    return { title: "Course not found", crumbs: [{ label: "Courses", href: "/courses" }, { label: "Not found" }], el: ErrorState({ title: "We couldn't find that course", description: "It may have been deleted.", onRetry: () => navigate("/courses") }) };
  }

  if (!can(ctx.user, "course.edit", course)) {
    return { title: "No access", crumbs: [{ label: "Courses", href: "/courses" }, { label: "No access" }], el: ErrorState({ title: "You can edit only your own courses", description: "Ask an administrator to assign this course to you or make you an editor.", onRetry: () => navigate("/courses") }) };
  }
  const blockCtx = { user: ctx.user, course, author: true, flush: () => { persist.flush(); } };
  const canPublish = can(ctx.user, "course.publish", course);

  let sel = { kind: "details" };
  let mode = "edit";
  let previewLessonId = null;
  const collapsed = new Set();
  let drag = null;

  // ---------- save state ----------
  const saveEl = h("span", { class: "save-indicator saved", role: "status" }, [ico("check-circle", 14), "All changes saved"]);
  const setSave = (s) => {
    saveEl.className = `save-indicator ${s}`;
    saveEl.replaceChildren(ico(s === "saving" ? "refresh" : "check-circle", 14), s === "saving" ? "Saving…" : "All changes saved");
  };
  const persist = debounce(() => { mutate(course.id, () => {}); setSave("saved"); drawReadiness(); }, 350);
  const commit = () => { setSave("saving"); persist(); };

  // ---------- top bar ----------
  const statusHolder = h("span");
  const titleInput = Input({
    large: true, value: course.title, placeholder: "Name your course…", "aria-label": "Course name", class: "builder-title", "data-guide-target": "course.name",
    oninput: (e) => { setTitle(course.id, e.target.value); setSave("saving"); persist(); },
  });
  const previewBtn = Button({ label: "Preview", icon: "eye", variant: "secondary", attrs: { "data-guide-target": "course.preview" }, onClick: () => togglePreview() });
  const publishHolder = h("span");

  function refreshBar() {
    statusHolder.replaceChildren(StatusBadge(course.status));
    previewBtn.replaceChildren(ico(mode === "preview" ? "arrow-left" : "eye", 18), mode === "preview" ? "Back to editing" : "Preview");
    const published = course.status === "published";
    const inReview = course.status === "in_review";
    const archived = course.status === "archived";
    const waiting = (inReview && !canPublish) || archived;
    const label = published ? "Published" : inReview ? (canPublish ? "Approve & publish" : "In review") : archived ? "Archived" : canPublish ? "Publish" : "Submit for review";
    publishHolder.replaceChildren(Button({
      label, icon: published ? "check-circle" : waiting ? "clock" : "rocket", variant: published || waiting ? "secondary" : "primary",
      disabled: waiting, attrs: { "data-guide-target": "course.publish" }, onClick: onPublish, title: published ? "Click to unpublish" : "",
    }));
  }

  const bar = h("div", { class: "builder-bar" }, [
    h("div", { class: "builder-bar-title" }, [
      Button({ icon: "arrow-left", variant: "ghost", size: "sm", href: "/courses", title: "Back to courses" }),
      h("div", { class: "grow", style: "min-width:180px" }, titleInput),
      statusHolder,
    ]),
    h("div", { class: "row wrap", style: "justify-content:flex-end" }, [saveEl, GuideButton("create-first-course", { label: "Guide me" }), previewBtn, publishHolder]),
  ]);

  // ---------- publish ----------
  async function onPublish() {
    if (course.status === "published") {
      if (await confirmDialog({ title: "Unpublish this course?", message: "It will disappear from the catalog. Learner progress is kept.", confirmLabel: "Unpublish" })) { unpublishCourse(course.id); refreshBar(); drawReadiness(); toast("Course moved back to draft", { type: "info" }); }
      return;
    }
    const res = publishCourse(course.id, ctx.user);
    if (!res.ok) {
      openModal({
        title: "Not ready to publish yet", size: "sm",
        content: h("div", { class: "stack" }, [
          h("p", { class: "muted" }, "Finish these steps, then publish:"),
          ...res.blockers.map((b) => h("div", { class: "row-sm" }, [ico("alert", 18), b.label])),
        ]),
        footer: (close) => [Button({ label: "Got it", variant: "primary", onClick: close })],
      });
      return;
    }
    refreshBar(); drawReadiness();
    if (res.status === "in_review") { toast("Submitted for review — an admin will publish it once approved.", { type: "info" }); return; }
    toast(`“${courseTitle(course)}” is live in the catalog`, { action: { label: "View as learner", onClick: () => navigate(`/explore/${course.id}`) } });
  }

  function togglePreview() {
    mode = mode === "edit" ? "preview" : "edit";
    if (mode === "preview") { previewLessonId ||= lessonsOf(course)[0]?.id || null; bus.emit("course.previewed", { courseId: course.id }); }
    refreshBar(); drawBody();
  }

  // ---------- outline ----------
  const outlineEl = h("aside", { class: "outline", "aria-label": "Course outline" });
  const canvasEl = h("section", { class: "canvas", "aria-label": "Editor" });
  const bodyEl = h("div", { class: "builder-body" }, [outlineEl, canvasEl]);

  const select = (s) => { sel = s; drawOutline(); drawCanvas(); canvasEl.scrollTop = 0; };

  function drawOutline() {
    outlineEl.replaceChildren(
      h("button", { class: ["outline-item", sel.kind === "details" && "is-selected"], type: "button", onclick: () => select({ kind: "details" }), "aria-current": sel.kind === "details" ? "true" : undefined }, [ico("settings", 18), h("span", { class: "grow strong" }, "Course details")]),
      h("div", { class: "row-between", style: "margin:18px 4px 8px" }, [
        h("span", { class: "eyebrow" }, `Modules · ${course.modules.length}`),
        Button({ label: "Add module", icon: "plus", variant: "soft", size: "sm", attrs: { "data-guide-target": "course.add-module" }, onClick: onAddModule }),
      ]),
      course.modules.length
        ? h("div", { class: "stack-sm" }, course.modules.map(moduleEl))
        : h("div", { class: "outline-empty" }, [ico("layers", 22), h("strong", {}, "No modules yet"), h("span", { class: "small muted" }, "Modules are chapters. Add one to start structuring your course.")])
    );
  }

  function onAddModule() {
    const m = addModule(course.id);
    collapsed.delete(m.id);
    drawOutline(); drawReadiness(); setSave("saved");
    announce(`Module ${course.modules.length} added`);
    const input = outlineEl.querySelector(`[data-mod="${m.id}"] .mod-title`);
    input?.focus(); input?.select(); input?.scrollIntoView({ block: "nearest" });
  }

  function onAddLesson(m, type = "lesson") {
    const l = addLesson(course.id, m.id, type);
    collapsed.delete(m.id);
    sel = { kind: "lesson", id: l.id };
    drawOutline(); drawCanvas(); drawReadiness();
    announce(`${LESSON_TYPES[type].label} added`);
  }

  function moduleEl(m, mi) {
    const isCollapsed = collapsed.has(m.id);
    const card = h("div", { class: "mod", "data-mod": m.id });
    const menu = Dropdown({
      icon: "more", variant: "ghost", size: "sm", iconRight: null, title: `Module ${mi + 1} options`, align: "right",
      items: [
        { label: "Move up", icon: "arrow-up", disabled: mi === 0, onClick: () => { moveModule(course.id, m.id, mi - 1); drawOutline(); announce("Module moved up"); } },
        { label: "Move down", icon: "arrow-down", disabled: mi === course.modules.length - 1, onClick: () => { moveModule(course.id, m.id, mi + 1); drawOutline(); announce("Module moved down"); } },
        "sep",
        { label: "Delete module", icon: "trash", onClick: async () => { if (await confirmDialog({ title: `Delete “${m.title}”?`, message: m.lessons.length ? `This also removes its ${pluralize(m.lessons.length, "lesson")}.` : "This module is empty.", confirmLabel: "Delete", danger: true })) { removeModule(course.id, m.id); if (sel.kind === "lesson" && !findLesson(course, sel.id)) sel = { kind: "details" }; drawOutline(); drawCanvas(); drawReadiness(); } } },
      ],
    });
    const head = h("div", { class: "mod-head", draggable: "true",
      ondragstart: (e) => { drag = { type: "module", id: m.id }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", m.id); },
      ondragend: () => { drag = null; clearDrop(); } }, [
      h("span", { class: "grip", title: "Drag to reorder", "aria-hidden": "true" }, ico("grip", 16)),
      h("button", { class: "btn btn-ghost btn-icon btn-sm", type: "button", "aria-expanded": String(!isCollapsed), "aria-label": `${isCollapsed ? "Expand" : "Collapse"} module ${mi + 1}`, onclick: () => { isCollapsed ? collapsed.delete(m.id) : collapsed.add(m.id); drawOutline(); } }, ico(isCollapsed ? "chevron-right" : "chevron-down", 16)),
      h("input", { class: "mod-title", value: m.title, "aria-label": `Module ${mi + 1} title`, oninput: (e) => { m.title = e.target.value; commit(); }, onkeydown: (e) => e.key === "Enter" && e.target.blur() }),
      menu,
    ]);
    card.addEventListener("dragover", (e) => {
      if (drag?.type === "module" && drag.id !== m.id) { e.preventDefault(); clearDrop(); card.classList.add("drop-before"); }
      else if (drag?.type === "lesson" && !e.target.closest(".lesson-item")) { e.preventDefault(); clearDrop(); card.classList.add("drop-into"); }
    });
    card.addEventListener("drop", (e) => {
      if (drag?.type === "module" && drag.id !== m.id) { e.preventDefault(); const from = course.modules.findIndex((x) => x.id === drag.id); moveModule(course.id, drag.id, from < mi ? mi - 1 : mi); drawOutline(); }
      else if (drag?.type === "lesson" && !e.target.closest(".lesson-item")) { e.preventDefault(); moveLesson(course.id, drag.id, m.id, m.lessons.length); drawOutline(); }
      drag = null; clearDrop();
    });
    card.append(head);
    if (!isCollapsed) {
      card.append(
        h("div", { class: "lesson-list" }, m.lessons.length ? m.lessons.map((l) => lessonEl(m, l)) : [h("div", { class: "small muted", style: "padding:6px 12px" }, "No lessons yet.")]),
        h("div", { class: "mod-foot" }, [
          Button({ label: "Add lesson", icon: "plus", variant: "ghost", size: "sm", attrs: { "data-guide-target": "course.add-lesson" }, onClick: () => onAddLesson(m) }),
          Dropdown({ icon: "chevron-down", iconRight: null, variant: "ghost", size: "sm", title: "Add another lesson type", align: "left", items: Object.entries(LESSON_TYPES).map(([type, t]) => ({ label: t.label, icon: t.icon, onClick: () => onAddLesson(m, type) })) }),
        ])
      );
    }
    return card;
  }

  function lessonEl(m, l) {
    const t = LESSON_TYPES[l.type] || LESSON_TYPES.lesson;
    const idx = m.lessons.indexOf(l);
    const el = h("div", { class: ["lesson-item", sel.kind === "lesson" && sel.id === l.id && "is-selected"], draggable: "true",
      ondragstart: (e) => { e.stopPropagation(); drag = { type: "lesson", id: l.id }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.id); },
      ondragend: () => { drag = null; clearDrop(); },
      ondragover: (e) => { if (drag?.type !== "lesson" || drag.id === l.id) return; e.preventDefault(); e.stopPropagation(); clearDrop(); const r = el.getBoundingClientRect(); el.classList.add(e.clientY > r.top + r.height / 2 ? "drop-after" : "drop-before"); },
      ondrop: (e) => {
        if (drag?.type !== "lesson" || drag.id === l.id) return;
        e.preventDefault(); e.stopPropagation();
        const r = el.getBoundingClientRect();
        let to = idx + (e.clientY > r.top + r.height / 2 ? 1 : 0);
        const from = m.lessons.findIndex((x) => x.id === drag.id);
        if (from >= 0 && from < to) to -= 1;
        moveLesson(course.id, drag.id, m.id, to); drag = null; clearDrop(); drawOutline();
      } }, [
      h("span", { class: "grip", "aria-hidden": "true" }, ico("grip", 14)),
      h("button", { class: "lesson-btn", type: "button", onclick: () => select({ kind: "lesson", id: l.id }), "aria-current": sel.kind === "lesson" && sel.id === l.id ? "true" : undefined }, [
        ico(t.icon, 16), h("span", { class: "grow truncate" }, l.title || "Untitled"), !hasContent(l) && h("span", { class: "dot", style: "color:var(--c-warning)", title: "Needs content" }),
      ]),
      Dropdown({ icon: "more", iconRight: null, variant: "ghost", size: "sm", title: `Options for ${l.title}`, align: "right", items: [
        { label: "Move up", icon: "arrow-up", disabled: idx === 0, onClick: () => { moveLesson(course.id, l.id, m.id, idx - 1); drawOutline(); announce("Lesson moved up"); } },
        { label: "Move down", icon: "arrow-down", disabled: idx === m.lessons.length - 1, onClick: () => { moveLesson(course.id, l.id, m.id, idx + 1); drawOutline(); announce("Lesson moved down"); } },
        { label: "Duplicate", icon: "copy", onClick: () => { const c = duplicateLesson(course.id, l.id); if (c) { select({ kind: "lesson", id: c.id }); toast("Lesson duplicated", { type: "info" }); } } },
        "sep",
        { label: "Delete lesson", icon: "trash", onClick: async () => { if (await confirmDialog({ title: `Delete “${l.title}”?`, message: "This can't be undone.", confirmLabel: "Delete", danger: true })) { removeLesson(course.id, l.id); if (sel.id === l.id) sel = { kind: "details" }; drawOutline(); drawCanvas(); drawReadiness(); } } },
      ] }),
    ]);
    return el;
  }
  const clearDrop = () => outlineEl.querySelectorAll(".drop-before,.drop-after,.drop-into").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-into"));
  const hasContent = (l) => l.type === "quiz" ? l.quiz?.questions.length > 0 : l.type === "assignment" ? !!l.assignment?.brief?.trim() : l.blocks.some((b) => (b.text || b.url || b.items || b.question) && (b.text?.trim() || b.url?.trim() || b.items?.some((i) => (i.text || i.title || "").trim()) || b.question?.prompt?.trim()));

  // ---------- canvas ----------
  let readinessEl = null;
  function drawReadiness() {
    if (!readinessEl?.isConnected) return;
    const items = publishReadiness(course);
    const ready = items.filter((i) => i.required).every((i) => i.ok);
    readinessEl.replaceChildren(
      h("div", { class: "row-between" }, [h("h3", {}, course.status === "published" ? "Published" : ready ? "Ready to publish" : "Before you publish"), Badge(ready ? "Ready" : "In progress", ready ? "success" : "warning")]),
      h("ul", { class: "stack-sm", style: "margin-top:12px" }, items.map((i) => h("li", { class: "row-sm small" }, [ico(i.ok ? "check-circle" : i.required ? "alert" : "minus", 18), h("span", { style: i.ok ? "color:var(--c-muted)" : "" }, [i.label, !i.required && !i.ok && h("span", { class: "muted" }, " (recommended)")])])))
    );
  }

  function drawCanvas() {
    if (sel.kind === "lesson" && !findLesson(course, sel.id)) sel = { kind: "details" };
    canvasEl.replaceChildren(sel.kind === "details" ? detailsView() : lessonView(findLesson(course, sel.id)));
    drawReadiness();
  }

  // Course → skill mapping: which skills the course builds, the level it targets and its weight (points).
  // Persisted to course_skills on the backend through the normal course sync (courseSync.pushCourse → skills).
  const LEVEL_OPTS = [{ value: "1", label: "1 · Novice" }, { value: "2", label: "2 · Developing" }, { value: "3", label: "3 · Proficient" }, { value: "4", label: "4 · Advanced" }];
  const activeSkills = () => load("skills").filter((s) => s.active !== false);
  const skillName = (id) => load("skills").find((s) => s.id === id)?.name || id;

  function courseSkillsCard() {
    const chips = h("div", { class: "chips", "data-guide-target": "course.skills" });
    const rows = h("div", { class: "stack-sm" });
    const paint = () => {
      const skills = activeSkills();
      chips.replaceChildren(...skills.map((s) => {
        const on = course.skills.some((x) => x.skillId === s.id);
        return h("button", { class: "chip", type: "button", "aria-pressed": String(on), "data-skill-chip": s.id, onclick: () => { course.skills = on ? course.skills.filter((x) => x.skillId !== s.id) : [...course.skills, { skillId: s.id, points: 30, targetLevel: 3 }]; commit(); paint(); bus.emit("course.skills.changed", { courseId: course.id }); } }, s.name);
      }), !skills.length && h("span", { class: "small muted" }, "No skills in the library yet — an admin can add them under Skills."));
      rows.replaceChildren(...course.skills.map((m) => h("div", { class: "skill-map-row", "data-course-skill": m.skillId }, [
        h("div", { class: "small strong", style: "padding-bottom:10px" }, skillName(m.skillId)),
        Field({ label: "Target level", control: Select({ options: LEVEL_OPTS, value: String(m.targetLevel || 3), onChange: (v) => { m.targetLevel = +v; commit(); }, attrs: { "aria-label": `${skillName(m.skillId)} target level` } }) }),
        Field({ label: "Weight %", control: Input({ type: "number", min: "1", max: "100", value: m.points ?? 30, "aria-label": `${skillName(m.skillId)} weight`, oninput: (e) => { m.points = Math.min(100, Math.max(1, +e.target.value || 1)); commit(); } }) }),
      ])), course.skills.length > 0 && h("p", { class: "xs muted" }, "Weight is the progress a learner earns toward the skill by finishing the whole course. Map individual lessons for finer credit."));
    };
    paint();
    return h("div", { class: "card card-pad stack" }, [
      h("div", {}, [h("h3", {}, "Skills"), h("p", { class: "muted small" }, "Completing this course builds these skills.")]),
      chips, rows,
    ]);
  }

  // Lesson → skill mapping: which of the course's skills this lesson contributes to, and by how much.
  function lessonSkillsCard(lesson) {
    lesson.skills ||= [];
    const pool = course.skills.length ? course.skills.map((m) => load("skills").find((s) => s.id === m.skillId)).filter(Boolean) : activeSkills();
    const chips = h("div", { class: "chips", "data-guide-target": "lesson.skills" });
    const rows = h("div", { class: "stack-sm" });
    const paint = () => {
      chips.replaceChildren(...pool.map((s) => {
        const on = lesson.skills.some((x) => x.skillId === s.id);
        return h("button", { class: "chip", type: "button", "aria-pressed": String(on), "data-skill-chip": s.id, onclick: () => { lesson.skills = on ? lesson.skills.filter((x) => x.skillId !== s.id) : [...lesson.skills, { skillId: s.id, contribution: 10 }]; commit(); paint(); } }, s.name);
      }), !pool.length && h("span", { class: "small muted" }, "No skills available yet."));
      rows.replaceChildren(...lesson.skills.map((m) => h("div", { class: "row-sm", "data-lesson-skill": m.skillId }, [
        h("span", { class: "small strong grow" }, skillName(m.skillId)),
        h("label", { class: "row-sm xs muted" }, ["Contribution %", Input({ type: "number", min: "1", max: "100", value: m.contribution ?? 10, style: "width:80px", "aria-label": `${skillName(m.skillId)} contribution`, oninput: (e) => { m.contribution = Math.min(100, Math.max(1, +e.target.value || 1)); commit(); } })]),
      ])));
    };
    paint();
    return h("div", { class: "card card-pad stack-sm" }, [
      h("div", {}, [h("h3", {}, "Skills this lesson builds"), h("p", { class: "small muted" }, course.skills.length ? "Pick from the course's skills. Completing the lesson earns the contribution toward each." : "Map skills on the course first for a focused list, or pick from the whole library.")]),
      chips, rows,
    ]);
  }

  function detailsView() {
    const coverHolder = h("div", { style: "width:100%" });
    const paintCover = () => coverHolder.replaceChildren(Cover(course, 120, 44));
    paintCover();
    const iconGrid = h("div", { class: "icon-grid", role: "radiogroup", "aria-label": "Cover icon" }, COVER_ICONS.map((n) =>
      h("button", { class: ["icon-pick", course.cover.icon === n && "is-on"], type: "button", role: "radio", "aria-checked": String(course.cover.icon === n), "aria-label": n, onclick: () => { course.cover.icon = n; commit(); paintCover(); iconGrid.querySelectorAll(".icon-pick").forEach((b) => { const on = b.getAttribute("aria-label") === n; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); }); } }, ico(n, 20))));
    const empty = !course.modules.length;
    return h("div", { class: "canvas-inner stack-lg" }, [
      h("div", {}, [h("h2", {}, "Course details"), h("p", { class: "muted small" }, "The basics learners see in the catalog.")]),
      empty && h("div", { class: "callout" }, [ico("bulb", 18), h("div", { class: "grow" }, [h("strong", {}, "Next: add a module. "), "Use “Add module” in the outline on the left to start structuring your course — or ", h("a", { href: `#/builder/ai/${course.id}`, "data-guide-target": "course.ai" }, "draft an outline with AI"), "."])]),
      h("div", { class: "card card-pad stack" }, [
        Field({ label: "Description", hint: "One or two sentences on what learners will be able to do.", control: Textarea({ rows: 3, value: course.description, placeholder: "e.g. Learn to run discovery calls that uncover real buyer needs.", oninput: (e) => { course.description = e.target.value; commit(); } }) }),
        h("div", { class: "grid grid-2" }, [
          Field({ label: "Category", control: Select({ options: CATEGORIES, value: course.category, onChange: (v) => { course.category = v; commit(); } }) }),
          Field({ label: "Level", control: Select({ options: LEVELS, value: course.level, onChange: (v) => { course.level = v; commit(); } }) }),
        ]),
        Field({ label: "Cover", control: h("div", { class: "stack-sm" }, [coverHolder, iconGrid, h("label", { class: "row-sm small" }, ["Colour", h("input", { type: "range", min: "0", max: "359", value: course.cover.hue, "aria-label": "Cover colour", style: "flex:1;accent-color:var(--c-primary)", oninput: (e) => { course.cover.hue = +e.target.value; commit(); paintCover(); } })])]) }),
      ]),
      courseSkillsCard(),
      h("div", { class: "card card-pad stack" }, [
        h("label", { class: "row-between" }, [h("span", {}, [h("strong", { class: "small" }, "Lessons unlock in order"), h("span", { class: "hint", style: "display:block" }, "Learners must finish each lesson before the next.")]), Switch({ checked: course.sequential, label: "Sequential lessons", onChange: (v) => { course.sequential = v; commit(); } })]),
        Field({ label: "Certificate validity", control: Select({ options: [{ value: "0", label: "Never expires" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }, { value: "24", label: "24 months" }], value: String(course.certExpiryMonths || 0), onChange: (v) => { course.certExpiryMonths = +v; commit(); } }) }),
        Field({ label: "Price", hint: "0 = free. A paid course stays locked for learners until they purchase it (or an instructor assigns it).", control: h("div", { class: "row" }, [
          Input({ type: "number", min: "0", step: "1", value: String((course.price || 0) / 100), "aria-label": "Price", "data-course-price": "", style: "max-width:160px", oninput: (e) => { course.price = Math.max(0, Math.round((+e.target.value || 0) * 100)); commit(); } }),
          Select({ options: CURRENCIES, value: course.currency || "INR", onChange: (v) => { course.currency = v; commit(); }, attrs: { "aria-label": "Currency", style: "width:auto" } }),
          h("span", { class: "small muted" }, course.price > 0 ? "Paid course" : "Free course"),
        ]) }),
      ]),
      (can(ctx.user, "course.assign", course) || can(ctx.user, "course.archive", course)) && h("div", { class: "card card-pad stack" }, [
        h("div", {}, [h("h3", {}, "Administration"), h("p", { class: "muted small" }, "Ownership, visibility and lifecycle.")]),
        can(ctx.user, "course.assign", course) && Field({ label: "Instructor", hint: "The instructor can edit this course.", control: Select({ options: users().filter((u) => u.role !== "learner").map((u) => ({ value: u.id, label: `${u.name} (${u.role})` })), value: course.instructorId, onChange: (v) => { assignInstructor(course.id, v); toast("Instructor assigned", { duration: 1800 }); } }) }),
        can(ctx.user, "course.visibility", course) && Field({ label: "Catalog visibility", control: Select({ options: [{ value: "catalog", label: "Listed in the catalog" }, { value: "assigned", label: "Hidden — enrolled learners only" }], value: course.visibility || "catalog", onChange: (v) => { setVisibility(course.id, v); commit(); } }) }),
        can(ctx.user, "course.archive", course) && h("div", { class: "row-between wrap" }, [
          h("span", { class: "small muted" }, course.status === "archived" ? "This course is archived and hidden from learners." : "Archiving hides the course from learners; progress is kept."),
          Button({ label: course.status === "archived" ? "Restore course" : "Archive course", icon: course.status === "archived" ? "refresh" : "lock", variant: "secondary", size: "sm", onClick: async () => { if (course.status === "archived") restoreCourse(course.id); else if (await confirmDialog({ title: "Archive this course?", message: "It will be hidden from the catalog and learners.", confirmLabel: "Archive" })) archiveCourse(course.id); refreshBar(); drawCanvas(); } }),
        ]),
      ]),
      (readinessEl = h("div", { class: "card card-pad" })),
    ]);
  }

  function lessonView(lesson) {
    const m = moduleOfLesson(course, lesson.id);
    const content = h("div", { class: "stack" });
    const paint = () => content.replaceChildren(...lessonBody(lesson, paint));
    paint();
    const titleIn = Input({ value: lesson.title, "aria-label": "Lesson title", class: "lesson-title-input", oninput: (e) => { lesson.title = e.target.value; commit(); redrawOutlineSoon(); } });
    return h("div", { class: "canvas-inner stack-lg" }, [
      h("div", { class: "stack-sm" }, [
        h("div", { class: "row-between wrap" }, [
          h("div", { class: "eyebrow" }, `${m?.title || ""} · ${LESSON_TYPES[lesson.type]?.label || "Lesson"}`),
          h("div", { class: "row-sm" }, [
            GuideButton("add-first-video", { label: "Guide: add a video", size: "sm" }),
            Button({ label: "Save lesson", icon: "check", variant: "soft", size: "sm", attrs: { "data-guide-target": "lesson.save" }, onClick: () => { persist.flush(); toast("Lesson saved", { duration: 1600 }); bus.emit("lesson.saved", { lessonId: lesson.id }); } }),
          ]),
        ]),
        h("div", { class: "grid", style: "grid-template-columns:1fr 150px 110px;align-items:end" }, [
          Field({ label: "Lesson title", control: titleIn }),
          Field({ label: "Type", control: Select({ options: Object.entries(LESSON_TYPES).map(([v, t]) => ({ value: v, label: t.label })), value: lesson.type, onChange: (v) => { lesson.type = v; if (v === "quiz") lesson.quiz ||= { passScore: 70, questions: [] }; if (v === "assignment") lesson.assignment ||= { brief: "", rubric: [] }; commit(); drawOutline(); drawCanvas(); } }) }),
          Field({ label: "Minutes", control: Input({ type: "number", min: "1", max: "240", value: lesson.duration || 5, oninput: (e) => { lesson.duration = Math.max(1, +e.target.value || 1); commit(); } }) }),
        ]),
      ]),
      content,
      h("div", { class: "card card-pad", style: "margin-top:8px" }, (readinessEl = h("div"), readinessEl)),
    ]);
  }
  const redrawOutlineSoon = debounce(() => drawOutline(), 400);

  function lessonBody(lesson, repaint) {
    if (lesson.type === "quiz") return [...quizEditor(lesson, repaint), lessonSkillsCard(lesson)];
    if (lesson.type === "assignment") return [...assignmentEditor(lesson, repaint), lessonSkillsCard(lesson)];
    return [
      lesson.type === "discussion" && h("div", { class: "callout" }, [ico("message", 18), "Learners will see a live discussion thread right under this lesson."]),
      blocksEditor(lesson),
      completionCard(lesson),
      lessonSkillsCard(lesson),
    ];
  }

  // Completion requirement. Watch-based rules work for uploaded / hosted-file videos (embedded YouTube/Vimeo can't be tracked).
  function completionCard(lesson) {
    const cur = lesson.completion?.rule || "manual";
    return h("div", { class: "card card-pad stack-sm" }, [
      h("div", {}, [h("h3", {}, "Completion requirement"), h("p", { class: "small muted" }, "How does a learner finish this lesson?")]),
      h("div", { class: "stack-sm", role: "radiogroup", "aria-label": "Completion requirement" }, COMPLETION_RULES.map((r) =>
        h("label", { class: "check" }, [h("input", { type: "radio", name: "cr-" + lesson.id, checked: cur === r.id, onchange: () => { lesson.completion = { rule: r.id }; commit(); } }), h("span", {}, r.label)]))),
      h("p", { class: "xs muted" }, "Watch rules apply to the first uploaded or hosted-file video in the lesson."),
    ]);
  }

  function blocksEditor(lesson) {
    const wrap = h("div", { class: "stack" });
    const paint = () => {
      wrap.replaceChildren(
        ...lesson.blocks.map((b, i) => blockCard(lesson, b, i, paint)),
        !lesson.blocks.length && h("div", { class: "card" }, EmptyState({ icon: "file", title: "This lesson is empty", description: "Add a content block to start building it.", action: h("div", { class: "row wrap", style: "justify-content:center" }, ["text", "video", "knowledge"].map((t) => Button({ label: BLOCK_TYPES[t].label, icon: BLOCK_TYPES[t].icon, size: "sm", onClick: () => { lesson.blocks.push(newBlock(t)); commit(); paint(); drawOutline(); } }))) })),
        addBlockMenu(lesson, paint)
      );
    };
    paint();
    return wrap;
  }

  function addBlockMenu(lesson, paint) {
    const mk = (t) => ({
      label: BLOCK_TYPES[t].label, icon: BLOCK_TYPES[t].icon, attrs: { "data-guide-target": `block.${t}` },
      onClick: () => {
        const b = newBlock(t);
        lesson.blocks.push(b); commit(); paint(); drawOutline(); wrapLast();
        // Adding a video block immediately opens the source chooser (Upload Video first).
        if (t === "video") { bus.emit("video.block.added", { lessonId: lesson.id }); chooseVideo(b, blockCtx, paint); }
      },
    });
    const wrapLast = () => setTimeout(() => canvasEl.querySelector(".block-card:last-of-type")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    return h("div", { class: "row", style: "justify-content:center;padding:8px 0" }, Dropdown({
      label: "Add content block", icon: "plus", variant: "secondary", align: "left", attrs: { "data-guide-target": "block.add" },
      items: [{ group: "Content" }, ...["text", "heading", "image", "video", "quote", "callout"].map(mk), { group: "Interactive" }, ...["checklist", "accordion", "knowledge", "link"].map(mk)],
    }));
  }

  function blockCard(lesson, b, i, paintAll) {
    const def = BLOCK_TYPES[b.type];
    if (!def) return null;
    const body = h("div", { class: "block-body" });
    const paint = () => body.replaceChildren(def.edit(b, { commit, redraw: paint, ctx: blockCtx }));
    paint();
    const move = (d) => { const j = i + d; if (j < 0 || j >= lesson.blocks.length) return; [lesson.blocks[i], lesson.blocks[j]] = [lesson.blocks[j], lesson.blocks[i]]; commit(); paintAll(); announce(`Block moved ${d < 0 ? "up" : "down"}`); };
    return h("div", { class: "block-card card" }, [
      h("div", { class: "block-head" }, [
        h("span", { class: "row-sm strong small" }, [ico(def.icon, 16), def.label]), h("span", { class: "grow" }),
        Button({ icon: "arrow-up", variant: "ghost", size: "sm", title: "Move up", disabled: i === 0, onClick: () => move(-1) }),
        Button({ icon: "arrow-down", variant: "ghost", size: "sm", title: "Move down", disabled: i === lesson.blocks.length - 1, onClick: () => move(1) }),
        Button({ icon: "copy", variant: "ghost", size: "sm", title: "Duplicate block", onClick: () => { const c = JSON.parse(JSON.stringify(b)); c.id = newBlock("text").id; lesson.blocks.splice(i + 1, 0, c); commit(); paintAll(); } }),
        Button({ icon: "trash", variant: "ghost", size: "sm", title: "Delete block", onClick: () => { lesson.blocks.splice(i, 1); commit(); paintAll(); drawOutline(); } }),
      ]),
      body,
    ]);
  }

  function quizEditor(lesson, repaint) {
    lesson.quiz ||= { passScore: 70, questions: [] };
    const list = h("div", { class: "stack" });
    const paint = () => {
      list.replaceChildren(
        ...lesson.quiz.questions.map((q, i) => {
          const holder = h("div");
          const draw = () => holder.replaceChildren(QuestionEditor(q, { index: i, commit, redraw: draw, onDelete: () => { lesson.quiz.questions.splice(i, 1); commit(); paint(); drawOutline(); } }));
          draw();
          return holder;
        }),
        !lesson.quiz.questions.length && h("div", { class: "card" }, EmptyState({ icon: "clipboard", title: "No questions yet", description: "Add a question to check what learners understood." })),
        h("div", { class: "row", style: "justify-content:center" }, Dropdown({ label: "Add question", icon: "plus", items: Object.entries(QUESTION_TYPES).map(([t, d]) => ({ label: d.label, desc: d.hint, onClick: () => { lesson.quiz.questions.push(newQuestion(t)); commit(); paint(); drawOutline(); } })) }))
      );
    };
    paint();
    return [
      h("div", { class: "card card-pad row-between wrap" }, [
        h("div", {}, [h("h3", {}, "Assessment settings"), h("p", { class: "muted small" }, "Learners must reach the pass mark to complete this lesson.")]),
        h("div", { class: "row" }, [
          Field({ label: "Pass mark %", control: Input({ type: "number", min: "0", max: "100", value: lesson.quiz.passScore, style: "width:90px", oninput: (e) => { lesson.quiz.passScore = Math.min(100, Math.max(0, +e.target.value || 0)); commit(); } }) }),
          Button({ label: "Generate with AI", icon: "sparkles", variant: "secondary", attrs: { "data-guide-target": "quiz.ai" }, onClick: () => openAiQuizPanel({ course, lesson, onAdded: () => { commit(); paint(); drawOutline(); } }) }),
          Button({ label: "Try the quiz", icon: "play", variant: "secondary", disabled: !lesson.quiz.questions.length, onClick: () => openModal({ title: lesson.title, size: "lg", content: QuizRunner({ questions: lesson.quiz.questions, passScore: lesson.quiz.passScore, title: lesson.title, preview: true }) }) }),
        ]),
      ]),
      list,
    ];
  }

  function assignmentEditor(lesson, repaint) {
    lesson.assignment ||= { brief: "", rubric: [] };
    const a = lesson.assignment;
    const rub = h("div", { class: "stack-sm" });
    const paint = () => rub.replaceChildren(
      ...a.rubric.map((r, i) => h("div", { class: "row-sm" }, [Input({ value: r, placeholder: `Criterion ${i + 1}`, "aria-label": `Criterion ${i + 1}`, oninput: (e) => { a.rubric[i] = e.target.value; commit(); } }), Button({ icon: "x", variant: "ghost", size: "sm", title: "Remove criterion", onClick: () => { a.rubric.splice(i, 1); commit(); paint(); } })])),
      Button({ label: "Add criterion", icon: "plus", variant: "ghost", size: "sm", cls: "align-self-start", onClick: () => { a.rubric.push(""); commit(); paint(); } })
    );
    paint();
    return [h("div", { class: "card card-pad stack" }, [
      Field({ label: "Assignment brief", hint: "What should the learner produce?", control: Textarea({ rows: 5, value: a.brief, placeholder: "Describe the task, format and any constraints", oninput: (e) => { a.brief = e.target.value; commit(); redrawOutlineSoon(); } }) }),
      h("div", {}, [h("div", { class: "label", style: "margin-bottom:8px" }, "Grading rubric"), rub]),
    ])];
  }

  // ---------- learner preview ----------
  function previewView() {
    const ls = lessonsOf(course);
    const cur = ls.find((l) => l.id === previewLessonId) || ls[0];
    const list = h("div", { class: "stack-sm" }, course.modules.map((m) => h("div", {}, [
      h("div", { class: "eyebrow", style: "margin:8px 4px" }, m.title),
      ...m.lessons.map((l) => h("button", { class: ["lesson-row", l.id === cur?.id && "is-active"], type: "button", onclick: () => { previewLessonId = l.id; drawBody(); } }, [ico(LESSON_TYPES[l.type].icon, 18), h("span", { class: "grow" }, [h("span", { class: "lesson-title" }, l.title), h("span", { class: "xs muted", style: "display:block" }, `${LESSON_TYPES[l.type].label} · ${l.duration} min`)])])),
    ])));
    return h("div", { class: "preview" }, [
      h("div", { class: "preview-bar" }, [Badge("Learner preview", "primary", "eye"), h("span", { class: "small" }, "This is exactly what learners will see."), h("span", { class: "grow" }), Button({ label: "Back to editing", icon: "arrow-left", size: "sm", onClick: togglePreview })]),
      h("div", { class: "preview-hero", style: Cover(course).getAttribute("style").replace(/height:[^;]+;?/, "") }, [
        h("div", { class: "stack-sm" }, [Badge(course.category, ""), h("h1", { style: "color:#fff" }, courseTitle(course)), h("p", { style: "opacity:.9;max-width:560px" }, course.description || "Add a description in Course details."), h("div", { class: "row-sm small", style: "opacity:.9" }, [ico("clock", 16), `${courseMinutes(course)} min`, "·", pluralize(ls.length, "lesson"), "·", course.level])]),
      ]),
      ls.length
        ? h("div", { class: "preview-cols" }, [h("div", { class: "card card-pad-sm" }, list), h("div", { class: "card card-pad stack" }, [h("h2", {}, cur.title), lessonPreview(cur)])])
        : h("div", { class: "card" }, EmptyState({ icon: "layers", title: "Nothing to preview yet", description: "Add a module and a lesson, then preview again.", action: Button({ label: "Back to editing", variant: "primary", onClick: togglePreview }) })),
    ]);
  }
  function lessonPreview(l) {
    if (l.type === "quiz") return QuizRunner({ questions: l.quiz?.questions || [], passScore: l.quiz?.passScore || 70, title: l.title, preview: true });
    if (l.type === "assignment") return h("div", { class: "stack" }, [h("div", { class: "prose", html: (l.assignment?.brief || "No brief yet.").replace(/</g, "&lt;").replace(/\n/g, "<br>") }), l.assignment?.rubric?.length ? h("ul", { class: "stack-sm" }, l.assignment.rubric.map((r) => h("li", { class: "row-sm small" }, [ico("check", 16), r]))) : null, Textarea({ rows: 4, placeholder: "Learners submit their work here…", disabled: true })]);
    return l.blocks.length ? renderBlocks(l.blocks, { user: ctx.user, course, author: true }) : h("p", { class: "muted" }, "This lesson has no content yet.");
  }

  function drawBody() {
    if (mode === "preview") { bodyEl.classList.add("is-preview"); canvasEl.replaceChildren(previewView()); outlineEl.replaceChildren(); }
    else { bodyEl.classList.remove("is-preview"); drawOutline(); drawCanvas(); }
  }

  const root = h("div", { class: "builder" }, [bar, bodyEl]);
  refreshBar();
  drawBody();

  return {
    title: courseTitle(course), bleed: true, crumbs: [{ label: "Courses", href: "/courses" }, { label: courseTitle(course) }], el: root,
    destroy: () => persist.flush(),
  };
}
