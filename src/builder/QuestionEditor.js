// Question editor used by quiz lessons and inline knowledge-check blocks.
import { h, uid } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Field, Input, Textarea, Select } from "../components/Form.js";
import { QUESTION_TYPES } from "../quiz/engine.js";

// commit(): persist (no re-render). redraw(): re-render this editor (structure changed).
export function QuestionEditor(q, { commit, redraw, onDelete, index }) {
  const typeSelect = Select({
    options: Object.entries(QUESTION_TYPES).map(([value, t]) => ({ value, label: t.label })), value: q.type,
    onChange: (t) => {
      const fresh = QUESTION_TYPES[t].create();
      Object.assign(q, { type: t, options: fresh.options, answer: fresh.answer });
      if (!fresh.options) delete q.options;
      commit(); redraw();
    },
    attrs: { "aria-label": "Question type" },
  });

  const optionRows = () => {
    if (q.type !== "mc" && q.type !== "multi") return null;
    return h("div", { class: "stack-sm" }, [
      h("div", { class: "label" }, q.type === "mc" ? "Answer options (select the correct one)" : "Answer options (tick all correct ones)"),
      ...q.options.map((o, i) => {
        const chosen = q.type === "mc" ? q.answer === o.id : q.answer.includes(o.id);
        return h("div", { class: "row-sm" }, [
          h("input", { type: q.type === "mc" ? "radio" : "checkbox", name: "ans-" + q.id, checked: chosen, "aria-label": `Mark option ${i + 1} as correct`, style: "width:18px;height:18px;accent-color:var(--c-success)",
            onchange: (e) => { if (q.type === "mc") q.answer = o.id; else q.answer = e.target.checked ? [...q.answer, o.id] : q.answer.filter((x) => x !== o.id); commit(); } }),
          h("input", { class: "input", value: o.text, placeholder: `Option ${i + 1}`, "aria-label": `Option ${i + 1}`, oninput: (e) => { o.text = e.target.value; commit(); } }),
          Button({ icon: "x", variant: "ghost", size: "sm", title: "Remove option", disabled: q.options.length <= 2, onClick: () => { q.options = q.options.filter((x) => x !== o); if (q.type === "mc" && q.answer === o.id) q.answer = q.options[0].id; else if (q.type === "multi") q.answer = q.answer.filter((x) => x !== o.id); commit(); redraw(); } }),
        ]);
      }),
      q.options.length < 6 && Button({ label: "Add option", icon: "plus", variant: "ghost", size: "sm", cls: "align-self-start", onClick: () => { q.options.push({ id: uid("o"), text: "" }); commit(); redraw(); } }),
    ]);
  };

  const tf = q.type === "tf" && h("div", { class: "row", role: "radiogroup", "aria-label": "Correct answer" }, [true, false].map((v) =>
    h("label", { class: "check" }, [h("input", { type: "radio", name: "tf-" + q.id, checked: q.answer === v, onchange: () => { q.answer = v; commit(); } }), h("span", {}, v ? "True is correct" : "False is correct")])));

  const short = q.type === "short" && Field({ label: "Accepted keywords (comma separated)", hint: "An answer is correct if it contains any keyword. Leave empty to accept any answer.", control: Input({ value: q.answer.join(", "), placeholder: "e.g. discovery, qualification", oninput: (e) => { q.answer = e.target.value.split(",").map((s) => s.trim()).filter(Boolean); commit(); } }) });

  return h("div", { class: "qeditor card card-pad-sm stack" }, [
    h("div", { class: "row-between" }, [h("span", { class: "eyebrow" }, `Question ${index + 1}`), h("div", { class: "row-sm" }, [typeSelect, Button({ icon: "trash", variant: "ghost", size: "sm", title: "Delete question", onClick: onDelete })])]),
    Field({ label: "Question", control: Textarea({ rows: 2, value: q.prompt, placeholder: "Ask something that checks understanding", oninput: (e) => { q.prompt = e.target.value; commit(); } }) }),
    optionRows(), tf, short,
    Field({ label: "Feedback shown after answering (optional)", control: Input({ value: q.explanation || "", placeholder: "Explain why the answer is right", oninput: (e) => { q.explanation = e.target.value; commit(); } }) }),
  ]);
}
