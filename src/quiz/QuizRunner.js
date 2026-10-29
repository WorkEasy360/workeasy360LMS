// QuestionView + QuizRunner: Question → Answer → Feedback → Next → Result → Recommended next action.
import { h, uid } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { ProgressRing, Progress } from "../components/Progress.js";
import { EmptyState } from "../components/States.js";
import { isAnswered, checkAnswer, scoreQuiz } from "./engine.js";

// QuestionView: renders the inputs for any question type. `state` = {value}; reveal → shows correctness.
export function QuestionView(q, { value, onChange, reveal = false }) {
  const name = uid("qn");
  const optionCard = (id, text, isChosen, kind) => {
    const correct = reveal && (q.type === "multi" ? q.answer.includes(id) : q.answer === id || (q.type === "tf" && q.answer === (id === "true")));
    const wrong = reveal && isChosen && !correct;
    return h("label", { class: ["qopt", isChosen && "is-chosen", reveal && correct && "is-correct", wrong && "is-wrong"] }, [
      h("input", { type: kind, name, value: id, checked: isChosen, disabled: reveal, onchange: (e) => {
        if (kind === "radio") onChange(q.type === "tf" ? id === "true" : id);
        else onChange(e.target.checked ? [...(value || []), id] : (value || []).filter((x) => x !== id));
      } }),
      h("span", { class: "grow" }, text || "(empty option)"),
      reveal && correct && ico("check-circle", 20),
      wrong && ico("x", 20),
    ]);
  };
  let inputs;
  if (q.type === "mc") inputs = q.options.map((o) => optionCard(o.id, o.text, value === o.id, "radio"));
  else if (q.type === "multi") inputs = q.options.map((o) => optionCard(o.id, o.text, (value || []).includes(o.id), "checkbox"));
  else if (q.type === "tf") inputs = [optionCard("true", "True", value === true, "radio"), optionCard("false", "False", value === false, "radio")];
  else inputs = [h("textarea", { class: "textarea", rows: 3, placeholder: "Type your answer…", "aria-label": "Your answer", value: value || "", disabled: reveal, oninput: (e) => onChange(e.target.value) })];
  return h("fieldset", { class: "qview" }, [
    h("legend", { class: "qprompt" }, q.prompt || "Untitled question"),
    q.type === "multi" && h("div", { class: "hint", style: "margin-bottom:8px" }, "Select all that apply"),
    h("div", { class: "stack-sm" }, inputs),
  ]);
}

export function Feedback(q, value) {
  const { correct, expected } = checkAnswer(q, value);
  return h("div", { class: ["qfeedback", correct ? "is-correct" : "is-wrong"], role: "status" }, [
    h("div", { class: "row-sm strong" }, [ico(correct ? "check-circle" : "alert", 20), correct ? "Correct!" : "Not quite"]),
    !correct && h("div", { class: "small" }, ["Correct answer: ", h("strong", {}, expected)]),
    q.explanation && h("div", { class: "small", style: "margin-top:4px" }, q.explanation),
  ]);
}

/**
 * QuizRunner({ questions, passScore, title, onFinish(result), onContinue, onRetry, continueLabel, reviewLabel, onReview })
 * onFinish fires once when results are shown (host persists the score).
 */
export function QuizRunner({ questions, passScore = 70, title = "Quiz", onFinish, onContinue, continueLabel = "Continue", onRetry, onReview, reviewLabel = "Review the lesson", preview = false }) {
  const root = h("div", { class: "quiz" });
  let i = 0, answers = {}, phase = "answering", finished = false;

  if (!questions.length) return h("div", { class: "card" }, EmptyState({ icon: "clipboard", title: "This quiz has no questions yet", description: "Add questions in the Course Builder." }));

  const draw = () => {
    root.replaceChildren();
    if (phase === "result") return root.appendChild(result());
    const q = questions[i];
    const value = answers[q.id];
    const revealed = phase === "feedback";
    const primary = Button({
      label: revealed ? (i === questions.length - 1 ? "See results" : "Next question") : "Check answer", iconRight: "arrow-right", variant: "primary", disabled: !revealed && !isAnswered(q, value),
      attrs: { "data-quiz-action": revealed ? "next" : "check" },
      onClick: () => {
        if (!revealed) { phase = "feedback"; draw(); return; }
        if (i === questions.length - 1) { phase = "result"; draw(); return; }
        i++; phase = "answering"; draw();
      },
    });
    root.append(
      h("div", { class: "stack-sm" }, [
        h("div", { class: "row-between small muted strong" }, [h("span", {}, `${title} · Question ${i + 1} of ${questions.length}`), h("span", {}, `${passScore}% to pass`)]),
        Progress(((i + (revealed ? 1 : 0)) / questions.length) * 100, { size: "sm", label: "Quiz progress" }),
      ]),
      h("div", { class: "card card-pad stack", style: "margin-top:16px" }, [
        QuestionView(q, { value, reveal: revealed, onChange: (v) => { answers[q.id] = v; primary.disabled = !isAnswered(q, v); if (q.type === "short") return; draw(); } }),
        revealed && Feedback(q, value),
        h("div", { class: "row", style: "justify-content:flex-end" }, primary),
      ])
    );
    if (q.type === "short" && !revealed) root.querySelector("textarea")?.focus();
  };

  function result() {
    const r = scoreQuiz(questions, answers);
    const passed = r.score >= passScore;
    if (!finished) { finished = true; onFinish?.({ ...r, answers, passed }); }
    const missed = r.results.filter((x) => !x.correct);
    return h("div", { class: "stack-lg quiz-result" }, [
      h("div", { class: "card card-pad center stack", style: "align-items:center" }, [
        ProgressRing(r.score, { size: 120, stroke: 10, color: passed ? "var(--c-success)" : "var(--c-warning)" }),
        h("h2", { tabindex: "-1", id: "quiz-result-title" }, passed ? "You passed! 🎉" : r.score >= passScore - 15 ? "Almost there" : r.score > 0 ? "Keep practising" : "Let's review and try again"),
        h("p", { class: "muted" }, `${r.correct} of ${r.total} correct · ${passScore}% needed to pass${preview ? " · preview only, not saved" : ""}`),
        // Recommended next action
        h("div", { class: "row wrap", style: "justify-content:center" }, [
          passed && onContinue && Button({ label: continueLabel, icon: "arrow-right", variant: "primary", onClick: onContinue, attrs: { "data-guide-target": "quiz.continue" } }),
          !passed && onReview && Button({ label: reviewLabel, icon: "book", variant: "secondary", onClick: onReview }),
          Button({ label: passed ? "Retake for a better score" : "Try again", icon: "refresh", variant: passed ? "ghost" : "primary", onClick: () => { i = 0; answers = {}; phase = "answering"; finished = false; draw(); onRetry?.(); } }),
        ]),
      ]),
      missed.length > 0 && h("div", { class: "stack-sm" }, [h("h3", {}, "Worth another look"), ...missed.map((m) => h("div", { class: "card card-pad-sm" }, [h("div", { class: "strong small" }, m.q.prompt), h("div", { class: "small muted" }, ["Correct: ", m.expected]), m.q.explanation && h("div", { class: "xs muted" }, m.q.explanation)]))]),
    ]);
  }

  draw();
  return root;
}
