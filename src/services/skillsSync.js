// Pulls the skills library, the signed-in learner's skill standing and the learning paths from the backend into
// the local cache — the same additive hydration pattern as courseSync.js / learningSync.js, so "refresh, log back
// in, still see the same skill progress" holds from the real UI. Skill progress is never computed locally as a
// source of truth: the backend recalculates it from stored evidence and this just mirrors the result.
import { api } from "./api.js";
import { isBackendOnline, load, replace, getUser } from "../lib/store.js";

// Mirror of SkillService.levelFor thresholds — used only to draw a target level as a % tick on a meter.
const LEVEL_PCT = { 1: 0, 2: 25, 3: 55, 4: 80 };
export const levelToPct = (lvl) => LEVEL_PCT[lvl] ?? 55;
export const LEVEL_LABELS = ["", "Novice", "Developing", "Proficient", "Advanced"];

const toLocalSkill = (s) => ({ id: s.id, name: s.name, description: s.description || "", category: s.category || "General", categoryId: s.categoryId || null, icon: s.icon || "target", levels: s.levels || [], active: s.active !== false });

/** Whole library (including inactive, so admins can reactivate). Server wins — it is the source of truth. */
export async function hydrateSkillLibrary() {
  if (!isBackendOnline()) return;
  const [skills, categories] = await Promise.all([api.skills(true), api.skillCategories().catch(() => [])]);
  if (Array.isArray(skills) && skills.length) replace("skills", skills.map(toLocalSkill));
  if (Array.isArray(categories)) replace("skillCategories", categories);
}

/** The signed-in user's skill rows (progress %, level, evidence, targets), keyed by userId in the cache. */
export async function hydrateMySkills() {
  const u = getUser();
  if (!u || !isBackendOnline()) return;
  const rows = await api.mySkills();
  const others = load("userSkills").filter((r) => r.userId !== u.id);
  replace("userSkills", [...others, ...rows.map((r) => ({ userId: u.id, ...r }))]);
}

/** Learning paths → the existing `journeys` shape (journeysFor() keeps resolving status/progress per node). */
export async function hydrateLearningPaths() {
  if (!isBackendOnline()) return;
  const paths = await api.learningPaths();
  if (!Array.isArray(paths) || !paths.length) return;
  replace("journeys", paths.map((p) => ({
    id: p.id, title: p.title, description: p.description || "",
    nodes: (p.nodes || []).map((n) => ({ id: n.id, type: n.type, courseId: n.courseId || undefined, title: n.title || undefined, description: n.description || undefined, requires: n.requires || [] })),
  })));
}

export async function hydrateSkills() {
  if (!isBackendOnline()) return;
  const results = await Promise.allSettled([hydrateSkillLibrary(), hydrateMySkills(), hydrateLearningPaths()]);
  results.filter((r) => r.status === "rejected").forEach((r) => console.warn("[skillsSync] could not hydrate:", r.reason?.message));
}

/** After a progress event lands on the server, re-pull the authoritative standing (Skills page updates via data:userSkills). */
export const refreshMySkills = () => hydrateMySkills().catch((err) => console.warn("[skillsSync] refresh failed:", err.message));
