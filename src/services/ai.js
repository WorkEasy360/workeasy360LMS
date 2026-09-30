// AI course builder / quiz generator — frontend side. Generation happens on the backend (services/api.js →
// /api/ai/*), which records every request. Applying a result reuses the existing local-first course model
// (createCourse / addModule / addLesson / blocks / quiz questions) and the normal course sync, so an AI-built
// course is an ordinary DRAFT that goes through the usual review → publish workflow. Nothing here publishes.
import { api } from "./api.js";
import { uid } from "../lib/dom.js";
import { bus } from "../lib/events.js";
import { createCourse, addModule, addLesson, mutate, getCourse, findLesson } from "./courses.js";
import { flushSyncNow } from "./courseSync.js";
import { isBackendOnline } from "../lib/store.js";

export const aiStatus = () => api.aiStatus();
export const generateCourseOutline = (input) => api.aiGenerateCourse(input);
export const generateQuizQuestions = (input) => api.aiGenerateQuiz(input);
export const getGeneration = (id) => api.aiGeneration(id);

export const DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"];
export const QUESTION_TYPE_OPTIONS = [{ value: "mixed", label: "Mixed" }, { value: "mc", label: "Multiple choice" }, { value: "multi", label: "Multi select" }, { value: "tf", label: "True / false" }, { value: "short", label: "Short answer" }];

/** Generated content blocks → the Builder's block shapes (provenance kept on the block as `sourceRef`). */
export function outlineToBlocks(blocks = [], activities = []) {
  const out = [];
  for (const b of blocks) {
    const base = { id: uid("b"), sourceRef: b.sourceRef || null, aiGenerated: true };
    if (b.type === "heading") out.push({ ...base, type: "heading", text: b.text || "" });
    else if (b.type === "callout") out.push({ ...base, type: "callout", tone: "info", text: b.text || "" });
    else if (b.type === "checklist") out.push({ ...base, type: "checklist", items: (b.items || []).map((t) => ({ id: uid("i"), text: t })) });
    else out.push({ ...base, type: "text", text: b.text || "" });
  }
  if (activities.length) out.push({ id: uid("b"), type: "checklist", aiGenerated: true, sourceRef: null, items: [{ id: uid("i"), text: "Suggested activities" }, ...activities.map((a) => ({ id: uid("i"), text: a }))] });
  return out;
}

/** Generated question → the quiz engine's question shape. */
export function questionToLocal(q) {
  const base = { id: uid("q"), type: q.type, prompt: q.prompt || "", explanation: q.explanation || "", difficulty: q.difficulty || "medium", objective: q.objective || "", sourceRef: q.sourceRef || null, aiGenerated: true };
  if (q.type === "mc") { const options = (q.options || []).map((t) => ({ id: uid("o"), text: t })); return { ...base, options, answer: options[q.correctIndex]?.id || options[0]?.id }; }
  if (q.type === "multi") { const options = (q.options || []).map((t) => ({ id: uid("o"), text: t })); return { ...base, options, answer: (q.correctIndices || []).map((i) => options[i]?.id).filter(Boolean) }; }
  if (q.type === "tf") return { ...base, answer: !!q.answer };
  return { ...base, answer: [...(q.acceptedAnswers || [])] };
}

const bg = (label, p) => { if (isBackendOnline()) p.catch((err) => console.warn(`[ai] ${label} failed:`, err.message)); };

/**
 * Applies a reviewed outline as a DRAFT course (new, or appended to an existing course the user manages).
 * Returns the local course; the backend copy is synced through the normal course sync.
 */
export async function applyOutline(outline, { user, courseId = null, generationId = null, difficulty = null } = {}) {
  const course = courseId ? getCourse(courseId) : createCourse({ title: outline.title, instructorId: user.id });
  if (!course) throw new Error("Course not found");
  mutate(course.id, (c) => {
    if (!courseId) { c.title = outline.title; c.description = outline.summary || ""; if (difficulty) c.level = difficulty; }
    c.aiGenerationId = generationId;
    c.status = "draft"; // AI output is a draft, always
  });
  for (const mod of outline.modules || []) {
    const m = addModule(course.id);
    mutate(course.id, (c) => { const mm = c.modules.find((x) => x.id === m.id); mm.title = mod.title; mm.description = mod.description || ""; });
    for (const lesson of mod.lessons || []) {
      const l = addLesson(course.id, m.id, lesson.type || "lesson");
      mutate(course.id, (c) => {
        const ll = findLesson(c, l.id);
        ll.title = lesson.title; ll.duration = lesson.durationMin || 5; ll.description = lesson.objective || ""; ll.aiGenerated = true;
        if (lesson.type === "quiz") ll.quiz = { passScore: lesson.quiz?.passScore ?? 70, questions: (lesson.quiz?.questions || []).map(questionToLocal) };
        else if (lesson.type === "assignment") ll.assignment = { brief: lesson.assignment?.brief || "", rubric: [...(lesson.assignment?.rubric || [])] };
        else {
          const generated = outlineToBlocks(lesson.blocks || [], lesson.activities || []);
          ll.blocks = lesson.type === "video" ? [...ll.blocks.filter((b) => b.type === "video"), ...generated] : generated;
        }
      });
    }
  }
  await flushSyncNow(course.id);
  if (generationId) bg("apply", api.aiApply(generationId, { courseId: course.id }));
  bus.emit("ai.course.applied", { courseId: course.id, generationId });
  return getCourse(course.id);
}

/** Appends reviewed questions to a lesson's quiz (draft content; the course's status is untouched). */
export async function applyQuestions(courseId, lessonId, localQuestions, generationId = null) {
  mutate(courseId, (c) => { const l = findLesson(c, lessonId); if (!l) return null; l.quiz ||= { passScore: 70, questions: [] }; l.quiz.questions.push(...localQuestions); return null; });
  await flushSyncNow(courseId);
  if (generationId) bg("apply", api.aiApply(generationId, { courseId, lessonId }));
  bus.emit("ai.quiz.added", { courseId, lessonId, count: localQuestions.length });
}
