// "Generate Quiz with AI" inside the Course Builder's quiz editor: brief → generate → review/edit/reorder/delete
// → add the accepted questions to the lesson's quiz. Questions are drafts until the instructor accepts them.
import { h, pluralize } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { Badge } from "../components/Badge.js";
import { Field, Input, Textarea, Select } from "../components/Form.js";
import { openModal, toast } from "../components/Overlay.js";
import { QuestionEditor } from "./QuestionEditor.js";
import { generateQuizQuestions, questionToLocal, applyQuestions, QUESTION_TYPE_OPTIONS } from "../services/ai.js";
import { courseTitle } from "../services/courses.js";

export function openAiQuizPanel({ course, lesson, onAdded }) {
  const form = { count: 5, difficulty: "medium", questionType: "mixed", objectives: lesson.description || "", context: `${courseTitle(course)} · ${lesson.title}` };
  let phase = "form", generation = null, questions = [], error = null;
  const body = h("div", { class: "stack", "data-ai-quiz-phase": phase });
  const footer = h("div", { class: "row wrap", style: "justify-content:flex-end" });
  let closeModal = () => {};

  const setPhase = (p) => { phase = p; body.dataset.aiQuizPhase = p; draw(); };
  const objectives = () => form.objectives.split("\n").map((s) => s.trim()).filter(Boolean);

  async function generate() {
    setPhase("generating");
    try {
      generation = await generateQuizQuestions({ courseId: course.id, lessonId: lesson.id, context: form.context, objectives: objectives(), count: form.count, difficulty: form.difficulty, questionType: form.questionType, sources: [] });
      questions = generation.result.questions.map(questionToLocal);
      error = null;
      bus.emit("ai.quiz.generated", { generationId: generation.id, count: questions.length });
      setPhase("review");
    } catch (err) { error = err.message || "Generation failed"; setPhase("error"); }
  }

  async function accept() {
    if (!questions.length) { toast("No questions to add", { type: "error" }); return; }
    const bad = questions.find((q) => !q.prompt.trim() || (q.options && q.options.some((o) => !o.text.trim())));
    if (bad) { toast("Every question needs a prompt and every option needs text", { type: "error" }); return; }
    await applyQuestions(course.id, lesson.id, questions, generation?.id);
    toast(`${pluralize(questions.length, "question")} added to the quiz — it stays a draft until you publish`, { type: "success" });
    onAdded?.(questions);
    closeModal();
  }

  function formView() {
    footer.replaceChildren(Button({ label: "Cancel", onClick: () => closeModal() }), Button({ label: "Generate questions", icon: "sparkles", variant: "primary", attrs: { "data-guide-target": "quiz.ai.generate" }, onClick: generate }));
    return h("div", { class: "stack" }, [
      h("p", { class: "small muted" }, "The AI drafts questions from this lesson's content and your objectives. You review, edit and choose what to keep."),
      h("div", { class: "grid grid-3" }, [
        Field({ label: "Questions", control: Input({ type: "number", min: "1", max: "25", value: form.count, "aria-label": "Number of questions", oninput: (e) => (form.count = Math.max(1, Math.min(25, +e.target.value || 5))) }) }),
        Field({ label: "Difficulty", control: Select({ options: [{ value: "easy", label: "Easy" }, { value: "medium", label: "Medium" }, { value: "hard", label: "Hard" }], value: form.difficulty, onChange: (v) => (form.difficulty = v), attrs: { "aria-label": "Difficulty" } }) }),
        Field({ label: "Question type", control: Select({ options: QUESTION_TYPE_OPTIONS, value: form.questionType, onChange: (v) => (form.questionType = v), attrs: { "aria-label": "Question type" } }) }),
      ]),
      Field({ label: "Learning objectives", hint: "One per line", control: Textarea({ rows: 3, value: form.objectives, placeholder: "What should this quiz check?", "aria-label": "Quiz objectives", oninput: (e) => (form.objectives = e.target.value) }) }),
      Field({ label: "Context", control: Input({ value: form.context, "aria-label": "Quiz context", oninput: (e) => (form.context = e.target.value) }) }),
    ]);
  }

  function generatingView() {
    footer.replaceChildren(Button({ label: "Cancel", onClick: () => closeModal() }));
    return h("div", { class: "stack", "aria-live": "polite" }, [h("div", { class: "row-sm small" }, [ico("refresh", 16), `Drafting ${pluralize(form.count, "question")}…`]), ...[1, 2, 3].map(() => h("div", { class: "skeleton", style: "height:64px" }))]);
  }

  function reviewView() {
    footer.replaceChildren(
      Button({ label: "Back", variant: "ghost", onClick: () => setPhase("form") }),
      Button({ label: "Regenerate", icon: "refresh", variant: "secondary", attrs: { "data-guide-target": "quiz.ai.regenerate" }, onClick: generate }),
      Button({ label: `Add ${pluralize(questions.length, "question")} to quiz`, icon: "check", variant: "primary", attrs: { "data-guide-target": "quiz.ai.accept" }, onClick: accept }),
    );
    const list = h("div", { class: "stack", "data-guide-target": "quiz.ai.review" });
    const paint = () => list.replaceChildren(...questions.map((q, i) => {
      const holder = h("div", { class: "ai-q stack-sm", "data-ai-question": String(i) });
      const draw = () => holder.replaceChildren(
        h("div", { class: "row-between wrap xs muted" }, [
          h("span", { class: "row-sm" }, [Badge(q.difficulty, ""), q.objective && h("span", {}, `Objective: ${q.objective}`), q.sourceRef ? Badge(`Source: ${q.sourceRef}`, "teal") : h("span", {}, "No source cited")]),
          h("span", { class: "row-sm" }, [
            Button({ icon: "arrow-up", variant: "ghost", size: "sm", title: "Move up", disabled: i === 0, onClick: () => { [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]]; paint(); } }),
            Button({ icon: "arrow-down", variant: "ghost", size: "sm", title: "Move down", disabled: i === questions.length - 1, onClick: () => { [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]]; paint(); } }),
          ]),
        ]),
        QuestionEditor(q, { index: i, commit: () => {}, redraw: draw, onDelete: () => { questions.splice(i, 1); paint(); } }),
      );
      draw();
      return holder;
    }), !questions.length && h("p", { class: "small muted" }, "All questions removed — regenerate or go back."));
    paint();
    return h("div", { class: "stack" }, [
      h("div", { class: "row-between wrap" }, [h("div", { class: "row-sm" }, [Badge("Draft", "warning", "edit"), h("span", { class: "xs muted" }, `Generated by ${generation.provider} · ${generation.model} · prompt ${generation.promptVersion}`)]), generation.deduplicated && Badge("Reused a recent identical generation", "teal")]),
      list,
    ]);
  }

  function errorView() {
    footer.replaceChildren(Button({ label: "Edit the brief", variant: "secondary", onClick: () => setPhase("form") }), Button({ label: "Try again", icon: "refresh", variant: "primary", onClick: generate }));
    return h("div", { class: "callout danger", role: "alert", "data-ai-quiz-error": "" }, [ico("alert", 18), h("div", {}, [h("strong", {}, "The questions couldn't be generated. "), error])]);
  }

  function draw() { body.replaceChildren(({ form: formView, generating: generatingView, review: reviewView, error: errorView }[phase])()); }
  draw();
  bus.emit("ai.quiz.opened", { lessonId: lesson.id });
  openModal({ title: "Generate quiz with AI", size: "lg", content: body, footer: (close) => { closeModal = close; return [footer]; } });
}
