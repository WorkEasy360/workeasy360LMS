// Learning Coach, recommendations and learning plans — thin wrappers over the backend (services/api.js). All
// personalisation is computed server-side from the learner's own record; the deterministic recommendations keep
// working when the AI provider is unavailable (only the chat needs it).
import { api } from "./api.js";
import { bus } from "../lib/events.js";

export const TYPE_LABELS = { CONTINUE_COURSE: "Continue", COMPLETE_LESSON: "Finish course", SKILL_GAP: "Skill gap", REVIEW: "Review", PRACTICE: "Practice", ASSESSMENT: "Assessment", LEARNING_PATH: "Learning path", NEW_COURSE: "New course", CERTIFICATION: "Certification" };
export const TYPE_ICONS = { CONTINUE_COURSE: "play", COMPLETE_LESSON: "flag", SKILL_GAP: "target", REVIEW: "refresh", PRACTICE: "edit", ASSESSMENT: "clipboard", LEARNING_PATH: "route", NEW_COURSE: "compass", CERTIFICATION: "award" };
export const CTA_LABELS = { CONTINUE_COURSE: "Continue", COMPLETE_LESSON: "Finish it", SKILL_GAP: "View course", REVIEW: "Review lesson", PRACTICE: "Open assignment", ASSESSMENT: "Take the quiz", LEARNING_PATH: "View course", NEW_COURSE: "Explore course", CERTIFICATION: "View certificates" };

export const loadRecommendations = () => api.recommendations();
export const loadCoachContext = (lessonId) => api.coachContext(lessonId);
export const sendCoachMessage = (body) => api.coachMessage(body);
export const loadConversations = () => api.coachConversations();
export const loadConversation = (id) => api.coachConversation(id);
export const loadPlans = () => api.learningPlans();
export const createPlan = (minutes, courseId) => api.createLearningPlan({ minutes, courseId });
export const planAction = (id, action) => api.learningPlanAction(id, action);
export const planItemDone = (id, itemId) => api.learningPlanItemDone(id, itemId);

export async function giveFeedback(id, value) {
  const r = value === "DISMISSED" ? await api.recommendationDismiss(id) : await api.recommendationFeedback(id, value);
  bus.emit("rec.feedback", { id, value });
  return r;
}

export const SUGGESTED_PROMPTS = ["What should I learn next?", "Why is this recommended?", "Help me improve my weakest skill.", "Create a 20-minute learning plan.", "What am I close to completing?", "What am I behind on?"];
export const LESSON_PROMPTS = ["Explain this lesson simply", "What should I remember?", "How does this relate to my skill?", "Give me a practice question", "What should I do after this lesson?"];
