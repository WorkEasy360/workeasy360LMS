// Quiz engine foundation: a registry of question types. Add a type by adding an entry here
// (planned: matching, ordering, hotspot, scenario, video response, file submission, coding).
import { uid } from "../lib/dom.js";

const opt = (text = "") => ({ id: uid("o"), text });

export const QUESTION_TYPES = {
  mc: {
    label: "Multiple choice", hint: "One correct answer",
    create() { const o = [opt(), opt(), opt()]; return { id: uid("q"), type: "mc", prompt: "", options: o, answer: o[0].id, explanation: "" }; },
    answered: (q, a) => !!a,
    check: (q, a) => a === q.answer,
    expected: (q) => q.options.find((o) => o.id === q.answer)?.text || "",
  },
  multi: {
    label: "Multiple select", hint: "Several correct answers",
    create() { const o = [opt(), opt(), opt(), opt()]; return { id: uid("q"), type: "multi", prompt: "", options: o, answer: [o[0].id], explanation: "" }; },
    answered: (q, a) => Array.isArray(a) && a.length > 0,
    check: (q, a) => Array.isArray(a) && a.length === q.answer.length && q.answer.every((x) => a.includes(x)),
    expected: (q) => q.options.filter((o) => q.answer.includes(o.id)).map((o) => o.text).join(" · "),
  },
  tf: {
    label: "True / False", hint: "A statement to judge",
    create: () => ({ id: uid("q"), type: "tf", prompt: "", answer: true, explanation: "" }),
    answered: (q, a) => typeof a === "boolean",
    check: (q, a) => a === q.answer,
    expected: (q) => (q.answer ? "True" : "False"),
  },
  short: {
    label: "Short answer", hint: "Matches accepted keywords",
    create: () => ({ id: uid("q"), type: "short", prompt: "", answer: [], explanation: "" }),
    answered: (q, a) => typeof a === "string" && a.trim().length > 0,
    check: (q, a) => !q.answer.length || q.answer.some((k) => String(a).toLowerCase().includes(String(k).toLowerCase().trim())),
    expected: (q) => (q.answer.length ? q.answer.join(" / ") : "Any thoughtful answer"),
  },
};

export const newQuestion = (type = "mc") => QUESTION_TYPES[type].create();
export const isAnswered = (q, a) => QUESTION_TYPES[q.type].answered(q, a);
export const checkAnswer = (q, a) => ({ correct: QUESTION_TYPES[q.type].check(q, a), expected: QUESTION_TYPES[q.type].expected(q) });

export function scoreQuiz(questions, answers) {
  const results = questions.map((q) => ({ q, answer: answers[q.id], ...checkAnswer(q, answers[q.id]) }));
  const correct = results.filter((r) => r.correct).length;
  return { results, correct, total: questions.length, score: questions.length ? Math.round((correct / questions.length) * 100) : 0 };
}
