// Backend-powered learning analytics (services/api.js → /api/analytics/*). The server decides the scope
// (organisation / own courses / self) and applies the filters, so nothing here recomputes numbers locally.
import { api } from "./api.js";

/** Date-range presets shared by the Analytics and My Progress screens → {from, to} ISO dates (UTC). */
export function rangeFor(preset) {
  if (!preset || preset === "all") return {};
  const days = { "7d": 7, "30d": 30, "90d": 90 }[preset] || 30;
  const to = new Date(), from = new Date(Date.now() - (days - 1) * 86400000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export const loadOverview = (filters) => api.analyticsOverview(filters);
export const loadCourses = (filters) => api.analyticsCourses(filters);
export const loadCourse = (courseId, filters) => api.analyticsCourse(courseId, filters);
export const loadLearners = (filters) => api.analyticsLearners(filters);
export const loadLearner = (userId, filters) => api.analyticsLearner(userId, filters);
export const loadSkills = (filters) => api.analyticsSkills(filters);
export const loadActivity = (filters) => api.analyticsActivity(filters);
export const loadHealth = (filters) => api.analyticsHealth(filters);
export const loadMyProgress = () => api.myProgress();
export const loadGuideAnalytics = () => api.analyticsGuides();
export const loadCoachAnalytics = () => api.analyticsCoach();

/** Day labels for charts: "Sep 3". */
export const dayLabel = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
