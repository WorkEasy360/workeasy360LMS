// AI Course Builder: describe the course → generate (backend AI provider) → review/edit the proposed outline →
// Save as Draft (ordinary draft course in the existing Course Builder; review/publish happens there as usual).
import { h, pluralize } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card, SectionTitle } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { Field, Input, Textarea, Select } from "../components/Form.js";
import { ErrorState } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { toast } from "../components/Overlay.js";
import { getCourse, listCourses, courseTitle, LESSON_TYPES } from "../services/courses.js";
import { can } from "../services/permissions.js";
import { aiStatus, generateCourseOutline, applyOutline, DIFFICULTIES } from "../services/ai.js";
import { navigate } from "../router.js";

const STEPS = ["Reading your brief", "Structuring modules", "Writing lessons and activities", "Drafting quiz questions", "Validating the draft"];

export function AiCourseBuilderPage(ctx) {
  const user = ctx.user;
  const targetCourse = ctx.params.courseId ? getCourse(ctx.params.courseId) : null;
  if (ctx.params.courseId && (!targetCourse || !can(user, "course.edit", targetCourse))) {
    return { title: "No access", crumbs: [{ label: "Courses", href: "/courses" }, { label: "AI course builder" }], el: ErrorState({ title: "You can only build into courses you manage", onRetry: () => navigate("/courses") }) };
  }
  const form = { topic: targetCourse ? courseTitle(targetCourse) : "", audience: "", difficulty: targetCourse?.level || "Beginner", durationMinutes: 60, objectives: "", sourceName: "", sourceText: "", sourceCourseId: "" };
  let status = null, phase = "form", generation = null, outline = null, error = null, stepTimer = null;
  const root = h("div", { class: "stack-lg", "data-ai-phase": phase });
  const body = h("div", { class: "stack-lg" });

  const setPhase = (p) => { phase = p; root.dataset.aiPhase = p; draw(); };
  const objectives = () => form.objectives.split("\n").map((s) => s.trim()).filter(Boolean);

  // ---------- 1. brief ----------
  function formView() {
    const mySources = listCourses().filter((c) => can(user, "course.edit", c) || c.status === "published");
    return h("div", { class: "grid ai-cols" }, [
      h("div", { class: "card card-pad stack" }, [
        h("div", {}, [h("h3", {}, "Describe the course"), h("p", { class: "small muted" }, "The AI proposes an outline you review and edit. Nothing is published until you publish it yourself.")]),
        Field({ label: "Course topic / title", control: Input({ value: form.topic, placeholder: "e.g. Handling customer objections", "aria-label": "Course topic", "data-guide-target": "ai.topic", oninput: (e) => { form.topic = e.target.value; bus.emit("ai.input", { field: "topic", value: form.topic }); } }) }),
        h("div", { class: "grid grid-3" }, [
          Field({ label: "Audience", control: Input({ value: form.audience, placeholder: "e.g. new account executives", "aria-label": "Audience", oninput: (e) => (form.audience = e.target.value) }) }),
          Field({ label: "Difficulty", control: Select({ options: DIFFICULTIES, value: form.difficulty, onChange: (v) => (form.difficulty = v), attrs: { "aria-label": "Difficulty" } }) }),
          Field({ label: "Target duration (min)", control: Input({ type: "number", min: "10", max: "2400", value: form.durationMinutes, "aria-label": "Duration in minutes", oninput: (e) => (form.durationMinutes = +e.target.value || 60) }) }),
        ]),
        Field({ label: "Learning objectives", hint: "One per line — each becomes a module focus.", control: Textarea({ rows: 4, value: form.objectives, placeholder: "Recognise the four most common objections\nRespond with the acknowledge–clarify–resolve pattern", "aria-label": "Learning objectives", oninput: (e) => (form.objectives = e.target.value) }) }),
        h("div", { class: "row wrap", style: "justify-content:flex-end" }, [
          Button({ label: "Generate with AI", icon: "sparkles", variant: "primary", attrs: { "data-guide-target": "ai.generate" }, onClick: generate }),
        ]),
      ]),
      h("div", { class: "stack" }, [
        h("div", { class: "card card-pad stack-sm" }, [
          h("h4", {}, "Source material (optional)"),
          h("p", { class: "xs muted" }, "Pasted text or existing course content is used and cited in the draft. PDF, DOCX and URLs are planned; they're refused rather than guessed."),
          Field({ label: "Source name", control: Input({ value: form.sourceName, placeholder: "e.g. Sales playbook 2026", "aria-label": "Source name", oninput: (e) => (form.sourceName = e.target.value) }) }),
          Field({ label: "Pasted text", control: Textarea({ rows: 6, value: form.sourceText, placeholder: "Paste reference material…", "aria-label": "Source text", oninput: (e) => (form.sourceText = e.target.value) }) }),
          Field({ label: "Existing course", control: Select({ options: [{ value: "", label: "None" }, ...mySources.map((c) => ({ value: c.id, label: courseTitle(c) }))], value: form.sourceCourseId, onChange: (v) => (form.sourceCourseId = v), attrs: { "aria-label": "Existing course as source" } }) }),
        ]),
        statusCard(),
      ]),
    ]);
  }

  function statusCard() {
    if (!status) return null;
    return h("div", { class: "card card-pad-sm stack-sm", "data-ai-provider": status.provider }, [
      h("div", { class: "row-between" }, [h("span", { class: "small strong" }, "AI provider"), Badge(status.mock ? "Local deterministic" : status.configured ? "Connected" : "Not configured", status.mock ? "" : status.configured ? "success" : "warning")]),
      h("div", { class: "xs muted" }, status.mock ? "AI is disabled (AI_ENABLED=false): a local, deterministic provider drafts the outline so the workflow can be used and tested without an external service." : `${status.provider} · ${status.model}`),
      h("div", { class: "xs muted" }, `Prompt version ${status.promptVersion} · up to ${status.maxInputChars.toLocaleString()} characters of source material`),
    ]);
  }

  // ---------- 2. generate ----------
  async function generate() {
    if (!form.topic.trim()) { toast("Give the course a topic first", { type: "error" }); return; }
    if (!objectives().length) { toast("Add at least one learning objective", { type: "error" }); return; }
    const sources = [];
    if (form.sourceText.trim()) sources.push({ kind: "text", name: form.sourceName.trim() || "Pasted text", text: form.sourceText });
    if (form.sourceCourseId) sources.push({ kind: "lms", name: courseTitle(getCourse(form.sourceCourseId) || { title: "Existing course" }), courseId: form.sourceCourseId });
    setPhase("generating");
    try {
      generation = await generateCourseOutline({ topic: form.topic.trim(), audience: form.audience.trim(), difficulty: form.difficulty, durationMinutes: form.durationMinutes, objectives: objectives(), sources, courseId: targetCourse?.id || null });
      outline = JSON.parse(JSON.stringify(generation.result)); // editable working copy
      error = null;
      bus.emit("ai.generated", { generationId: generation.id, type: "COURSE" });
      setPhase("review");
    } catch (err) {
      error = err.message || "Generation failed";
      setPhase("error");
    }
  }

  function generatingView() {
    let step = 0;
    const list = h("ul", { class: "ai-steps", "data-guide-target": "ai.progress" }, STEPS.map((s, i) => h("li", { class: ["ai-step", i === 0 && "is-active"] }, [h("span", { class: "ai-step-dot" }, ico(i === 0 ? "refresh" : "clock", 14)), s])));
    clearInterval(stepTimer);
    stepTimer = setInterval(() => { step = Math.min(STEPS.length - 1, step + 1); [...list.children].forEach((li, i) => { li.classList.toggle("is-active", i === step); li.classList.toggle("is-done", i < step); li.querySelector(".ai-step-dot").replaceChildren(ico(i < step ? "check" : i === step ? "refresh" : "clock", 14)); }); }, 700);
    return h("div", { class: "card card-pad stack", "aria-live": "polite" }, [
      h("div", { class: "row" }, [h("span", { class: "icon-tile" }, ico("sparkles", 20)), h("div", {}, [h("h3", {}, `Drafting “${form.topic}”`), h("div", { class: "small muted" }, "Generating an outline, lessons, activities and quiz questions…")])]),
      list,
      h("div", { class: "stack-sm" }, [1, 2, 3].map(() => h("div", { class: "skeleton", style: "height:56px" }))),
    ]);
  }

  // ---------- 3. review / edit ----------
  function reviewView() {
    clearInterval(stepTimer);
    const lessonsCount = outline.modules.reduce((n, m) => n + m.lessons.length, 0);
    const quizCount = outline.modules.reduce((n, m) => n + m.lessons.filter((l) => l.type === "quiz").reduce((k, l) => k + (l.quiz?.questions?.length || 0), 0), 0);
    const sources = generation.sources || [];
    const provenance = h("div", { class: "card card-pad-sm stack-sm", "data-ai-provider": generation.provider, "data-ai-generation": generation.id }, [
      h("div", { class: "row-between wrap" }, [h("div", { class: "row-sm" }, [Badge("Draft", "warning", "edit"), Badge("Review before publishing", "")]), generation.deduplicated && Badge("Reused a recent identical generation", "teal")]),
      h("div", { class: "xs muted" }, `Generated by ${generation.provider} · ${generation.model} · prompt ${generation.promptVersion} · ${new Date(generation.createdAt).toLocaleString()}`),
      h("div", { class: "xs muted badge-list" }, sources.length ? ["Sources: ", ...sources.map((s) => Badge(`${s.name} · ${s.chars.toLocaleString()} chars${s.truncated ? " (truncated)" : ""}`, "teal"))] : "No source material was provided — content is drafted from the brief only; nothing is cited."),
    ]);
    const modulesEl = h("div", { class: "stack", "data-guide-target": "ai.outline" }, outline.modules.map((m, mi) => moduleCard(m, mi)));
    return h("div", { class: "stack-lg" }, [
      h("div", { class: "row-between wrap" }, [
        h("div", {}, [h("h2", {}, outline.title), h("div", { class: "small muted" }, `${pluralize(outline.modules.length, "module")} · ${pluralize(lessonsCount, "lesson")} · ${pluralize(quizCount, "quiz question")}`)]),
        h("div", { class: "row wrap" }, [
          Button({ label: "Edit brief", icon: "arrow-left", variant: "ghost", onClick: () => setPhase("form") }),
          Button({ label: "Regenerate", icon: "refresh", variant: "secondary", attrs: { "data-guide-target": "ai.regenerate" }, onClick: generate }),
          Button({ label: targetCourse ? "Add to course as draft" : "Save as Draft", icon: "check", variant: "primary", attrs: { "data-guide-target": "ai.save" }, onClick: save }),
        ]),
      ]),
      provenance,
      h("div", { class: "card card-pad stack-sm" }, [
        Field({ label: "Course title", control: Input({ value: outline.title, "aria-label": "Course title", "data-ai-field": "title", oninput: (e) => (outline.title = e.target.value) }) }),
        Field({ label: "Summary", control: Textarea({ rows: 2, value: outline.summary || "", "aria-label": "Course summary", oninput: (e) => (outline.summary = e.target.value) }) }),
      ]),
      modulesEl,
      h("div", { class: "row", style: "justify-content:flex-end" }, Button({ label: targetCourse ? "Add to course as draft" : "Save as Draft", icon: "check", variant: "primary", onClick: save })),
    ]);
  }

  function moduleCard(m, mi) {
    const card = h("div", { class: "card card-pad stack-sm", "data-ai-module": String(mi) });
    const paint = () => card.replaceChildren(
      h("div", { class: "row" }, [
        h("span", { class: "eyebrow", style: "min-width:80px" }, `Module ${mi + 1}`),
        h("div", { class: "grow" }, Input({ value: m.title, "aria-label": `Module ${mi + 1} title`, "data-ai-module-title": String(mi), oninput: (e) => (m.title = e.target.value) })),
        Button({ icon: "trash", variant: "ghost", size: "sm", title: "Remove module", onClick: () => { outline.modules.splice(mi, 1); draw(); } }),
      ]),
      Textarea({ rows: 1, value: m.description || "", "aria-label": `Module ${mi + 1} description`, oninput: (e) => (m.description = e.target.value) }),
      h("div", { class: "stack-sm" }, m.lessons.map((l, li) => h("div", { class: "ai-lesson", "data-ai-lesson": `${mi}.${li}` }, [
        h("span", { style: "display:inline-flex;color:var(--c-muted)" }, ico(LESSON_TYPES[l.type]?.icon || "file", 16)),
        Input({ value: l.title, "aria-label": `Lesson ${li + 1} title`, oninput: (e) => (l.title = e.target.value) }),
        Select({ options: Object.entries(LESSON_TYPES).map(([v, t]) => ({ value: v, label: t.label })), value: l.type, onChange: (v) => { l.type = v; paint(); }, attrs: { "aria-label": `Lesson ${li + 1} type` } }),
        Input({ type: "number", min: "1", max: "240", value: l.durationMin || 5, "aria-label": `Lesson ${li + 1} minutes`, style: "width:70px", oninput: (e) => (l.durationMin = +e.target.value || 5) }),
        h("span", { class: "xs muted ai-lesson-meta" }, l.type === "quiz" ? `${l.quiz?.questions?.length || 0} questions` : l.type === "assignment" ? "assignment" : `${(l.blocks || []).length} blocks · ${(l.activities || []).length} activities${(l.blocks || []).some((b) => b.sourceRef) ? " · cited" : ""}`),
        Button({ icon: "trash", variant: "ghost", size: "sm", title: "Remove lesson", attrs: { "data-ai-remove-lesson": `${mi}.${li}` }, onClick: () => { m.lessons.splice(li, 1); paint(); } }),
        h("div", { class: "ai-lesson-objective xs muted" }, l.objective ? `Objective: ${l.objective}` : ""),
      ]))),
    );
    paint();
    return card;
  }

  // ---------- 4. save as draft ----------
  async function save() {
    if (!outline.title.trim()) { toast("Give the course a title", { type: "error" }); return; }
    if (!outline.modules.length || outline.modules.some((m) => !m.lessons.length)) { toast("Every module needs at least one lesson", { type: "error" }); return; }
    try {
      const course = await applyOutline(outline, { user, courseId: targetCourse?.id || null, generationId: generation.id, difficulty: form.difficulty });
      toast(`Draft saved — review it and publish when you're ready`, { type: "success" });
      navigate(`/builder/${course.id}`);
    } catch (err) { toast(err.message || "Could not save the draft", { type: "error" }); }
  }

  function errorView() {
    clearInterval(stepTimer);
    return h("div", { class: "stack", "data-ai-error": "" }, [
      ErrorState({ title: "The draft couldn't be generated", description: error, onRetry: generate }),
      h("div", { class: "row", style: "justify-content:center" }, Button({ label: "Edit the brief", icon: "arrow-left", variant: "secondary", attrs: { "data-guide-target": "ai.edit-brief" }, onClick: () => setPhase("form") })),
    ]);
  }

  function draw() { body.replaceChildren(({ form: formView, generating: generatingView, review: reviewView, error: errorView }[phase])()); }

  aiStatus().then((s) => { status = s; if (phase === "form") draw(); }).catch(() => {});
  root.append(PageHeader({ title: targetCourse ? `Build into “${courseTitle(targetCourse)}” with AI` : "Create a course with AI", sub: "Describe what learners should be able to do; review the proposed outline; save it as a draft.", actions: [GuideButton("ai-course"), Button({ label: "Back to courses", icon: "arrow-left", href: "/courses" })] }), body);
  draw();
  return { title: "AI course builder", crumbs: [{ label: "Courses", href: "/courses" }, { label: "AI course builder" }], el: root, destroy: () => clearInterval(stepTimer) };
}
