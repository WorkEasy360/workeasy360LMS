// Thin fetch wrapper around the Java/Spring Boot backend (backend/). One place for base URL, auth header,
// and error shape — nothing else in the app should call fetch() directly against /api.
//
// Errors thrown here always have {status, message} so call sites can render a real error state
// ("Unable to save course [Retry]") instead of failing silently, per the app's error-handling contract.
// Deployments on another host set `window.WE360_API_BASE` in index.html before src/app.js loads.
export const API_BASE = (typeof window !== "undefined" && window.WE360_API_BASE) || "http://localhost:8080/api";

const TOKEN_KEY = "we360.v3.token";

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

async function request(path, { method = "GET", body, form, headers = {}, keepalive = false } = {}) {
  const token = getToken();
  const opts = { method, headers: { ...headers }, keepalive }; // keepalive: lets a final progress save outlive page unload
  if (token) opts.headers.Authorization = "Bearer " + token;
  if (form) opts.body = form; // browser sets multipart boundary
  else if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }

  let res;
  try {
    res = await fetch(API_BASE + path, opts);
  } catch (err) {
    throw new ApiError(0, "Can't reach the server. Check that the backend is running.");
  }
  if (res.status === 401) {
    // Only the token this request was sent with can be declared expired: a request that left before sign-in
    // finished (no token, or an older one) must not wipe the token a newer sign-in has stored since. A 401 from
    // the login/register endpoints means bad credentials, not an expired session, so it never signs anyone out.
    if (token && getToken() === token && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) onUnauthorized();
    throw new ApiError(401, token ? "Your session expired. Please sign in again." : "Sign in to continue.");
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (payload && payload.message) || `Request failed (${res.status}) on ${method} ${path}`);
  return payload;
}

const get = (path) => request(path);
const post = (path, body) => request(path, { method: "POST", body });
const put = (path, body) => request(path, { method: "PUT", body });
const del = (path) => request(path, { method: "DELETE" });
const clean = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "")); // drop empty filters

export const api = {
  // auth
  login: (email, password) => post("/auth/login", { email, password }),
  register: (name, email, password) => post("/auth/register", { name, email, password }), // public; always creates a LEARNER
  me: () => get("/auth/me"),
  forgotPassword: (email) => post("/auth/forgot", { email }), // always 200; {sent} only says whether this server e-mails
  resetPassword: (token, password) => post("/auth/reset", { token, password }), // signs in on success
  userResetToken: (id) => post(`/users/${id}/reset-token`), // admin: one-time reset link (also e-mailed when SMTP is on)
  changePassword: (currentPassword, newPassword) => post("/auth/password", { currentPassword, newPassword }), // signed-in, proves the current password

  // users / settings
  users: (role) => get("/users" + (role ? `?role=${role}` : "")),
  createUser: (body) => post("/users", body), // admin; returns {user, temporaryPassword} (password shown once, never stored in clear)
  updateUser: (id, patch) => put(`/users/${id}`, patch), // admin: role/title/dept/status
  notifications: () => get("/notifications"),
  markNotificationRead: (id) => post(`/notifications/${id}/read`),
  markAllNotificationsRead: () => post("/notifications/read-all"),
  systemStatus: () => get("/system/status"), // admin: database, storage, AI provider, CORS — no secrets
  settings: () => get("/settings"),
  updateSettings: (patch) => put("/settings", patch),

  // courses
  listCourses: ({ status, mine } = {}) => get(`/courses?${new URLSearchParams({ ...(status && { status }), ...(mine && { mine: "true" }) })}`),
  catalog: () => get("/courses/catalog"),
  getCourse: (id) => get(`/courses/${id}`),
  courseTrees: () => get("/courses/trees"), // every course tree in the caller's scope, one request (hydration)
  readiness: (id) => get(`/courses/${id}/readiness`),
  createCourse: (id, title) => post("/courses", { id, title }),
  updateCourse: (id, patch) => put(`/courses/${id}`, patch),
  publishCourse: (id) => post(`/courses/${id}/publish`),
  unpublishCourse: (id) => post(`/courses/${id}/unpublish`),
  archiveCourse: (id) => post(`/courses/${id}/archive`),
  restoreCourse: (id) => post(`/courses/${id}/restore`),
  assignInstructor: (id, instructorId) => post(`/courses/${id}/assign-instructor`, { instructorId }),
  deleteCourse: (id) => del(`/courses/${id}`),

  // modules
  addModule: (courseId, id, title) => post(`/courses/${courseId}/modules`, { id, title }),
  updateModule: (id, patch) => put(`/modules/${id}`, patch),
  reorderModules: (courseId, orderedIds) => put(`/courses/${courseId}/modules/reorder`, { orderedIds }),
  deleteModule: (id) => del(`/modules/${id}`),

  // lessons
  addLesson: (moduleId, id, title, type) => post(`/modules/${moduleId}/lessons`, { id, title, type }),
  updateLesson: (id, patch) => put(`/lessons/${id}`, patch),
  moveLesson: (id, toModuleId, toIndex) => post(`/lessons/${id}/move`, { toModuleId, toIndex }),
  duplicateLesson: (id) => post(`/lessons/${id}/duplicate`),
  deleteLesson: (id) => del(`/lessons/${id}`),

  // video
  uploadVideo: (form) => request("/videos", { method: "POST", form }),
  addExternalVideo: (courseId, body) => post(`/videos/external?courseId=${encodeURIComponent(courseId)}`, body),
  getVideo: (id) => get(`/videos/${id}`),
  updateVideo: (id, patch) => put(`/videos/${id}`, patch),
  deleteVideo: (id) => del(`/videos/${id}`),
  videoStreamUrl: (id) => `${API_BASE}/videos/${id}/stream?access_token=${encodeURIComponent(getToken() || "")}`,

  // enrollment / progress
  enroll: (courseId, dueAt) => post(`/courses/${courseId}/enroll`, { dueAt }),
  myEnrollments: () => get("/me/courses"),
  courseLearners: (courseId) => get(`/courses/${courseId}/learners`),
  removeLearner: (courseId, userId) => del(`/courses/${courseId}/learners/${userId}`),
  assignLearner: (courseId, userId, dueAt) => post(`/courses/${courseId}/learners/${userId}`, { dueAt }), // instructor/admin enrols a learner

  // course access + purchases (entitlement is decided server-side; the mock outcome endpoint only exists with the mock provider)
  courseAccess: (courseId) => get(`/courses/${courseId}/access`),
  paymentsStatus: () => get("/payments/status"),
  createOrder: (courseId) => post("/orders", { courseId }),
  myOrders: () => get("/orders"),
  allOrders: () => get("/orders?all=true"),
  getOrder: (id) => get(`/orders/${id}`),
  cancelOrder: (id) => post(`/orders/${id}/cancel`),
  mockOrderOutcome: (id, outcome) => post(`/orders/${id}/mock-outcome`, { outcome }),
  courseProgress: (courseId, userId) => get(`/courses/${courseId}/progress` + (userId ? `?userId=${userId}` : "")),
  progressDetail: (courseId) => get(`/courses/${courseId}/progress/detail`),
  updateLessonProgress: (lessonId, patch, { keepalive = false } = {}) => request(`/lessons/${lessonId}/progress`, { method: "POST", body: patch, keepalive }),

  // certificates
  certificates: (all) => get("/certificates" + (all ? "?all=true" : "")),
  verifyCertificate: (number) => get(`/certificates/verify/${encodeURIComponent(number)}`),
  revokeCertificate: (id) => post(`/certificates/${id}/revoke`),
  renewCertificate: (id) => post(`/certificates/${id}/renew`),

  // quizzes
  submitQuizAttempt: (lessonId, body) => post(`/lessons/${lessonId}/quiz-attempts`, body),
  quizAttempts: (lessonId) => get(`/lessons/${lessonId}/quiz-attempts`),

  // assignments
  submitAssignment: (lessonId, body) => post(`/lessons/${lessonId}/submissions`, { body }),
  mySubmission: (lessonId) => get(`/lessons/${lessonId}/submissions/me`),
  pendingSubmissions: (courseId) => get(`/courses/${courseId}/submissions`),
  reviewSubmission: (id, feedback) => post(`/submissions/${id}/review`, { feedback }),

  // community
  posts: ({ groupId, courseId, lessonId, kind } = {}) => get(`/community/posts?${new URLSearchParams({ ...(groupId && { groupId }), ...(courseId && { courseId }), ...(lessonId && { lessonId }), ...(kind && { kind }) })}`),
  createPost: (body) => post("/community/posts", body),
  addComment: (postId, id, body, parentId) => post(`/community/posts/${postId}/comments`, { id, body, parentId }),
  reactToPost: (postId, type) => post(`/community/posts/${postId}/reactions`, { type }),
  reactToComment: (commentId, postId, type) => post(`/community/comments/${commentId}/reactions?postId=${postId}`, { type }),
  togglePinPost: (postId) => post(`/community/posts/${postId}/pin`),
  groups: () => get("/community/groups"),
  toggleGroupMembership: (groupId) => post(`/community/groups/${groupId}/toggle-membership`),

  // skills library + mappings + learner standing + learning paths
  skills: (includeInactive) => get("/skills" + (includeInactive ? "?includeInactive=true" : "")),
  createSkill: (body) => post("/skills", body),
  updateSkill: (id, body) => put(`/skills/${id}`, body),
  deactivateSkill: (id) => post(`/skills/${id}/deactivate`),
  activateSkill: (id) => post(`/skills/${id}/activate`),
  skillCategories: () => get("/skills/categories"),
  createSkillCategory: (body) => post("/skills/categories", body),
  courseSkills: (courseId) => get(`/courses/${courseId}/skills`),
  setCourseSkills: (courseId, list) => put(`/courses/${courseId}/skills`, list),
  lessonSkills: (lessonId) => get(`/lessons/${lessonId}/skills`),
  setLessonSkills: (lessonId, list) => put(`/lessons/${lessonId}/skills`, list),
  mySkills: () => get("/me/skills"),
  recalculateMySkills: () => post("/me/skills/recalculate"),
  userSkills: (userId) => get(`/users/${userId}/skills`),
  learningPaths: () => get("/learning-paths"),

  // analytics (read-only; scope + authorisation decided server-side)
  analyticsOverview: (p = {}) => get(`/analytics/overview?${new URLSearchParams(clean(p))}`),
  analyticsCourses: (p = {}) => get(`/analytics/courses?${new URLSearchParams(clean(p))}`),
  analyticsCourse: (courseId, p = {}) => get(`/analytics/courses/${courseId}?${new URLSearchParams(clean(p))}`),
  analyticsLearners: (p = {}) => get(`/analytics/learners?${new URLSearchParams(clean(p))}`),
  analyticsLearner: (userId, p = {}) => get(`/analytics/learners/${userId}?${new URLSearchParams(clean(p))}`),
  analyticsSkills: (p = {}) => get(`/analytics/skills?${new URLSearchParams(clean(p))}`),
  analyticsActivity: (p = {}) => get(`/analytics/activity?${new URLSearchParams(clean(p))}`),
  analyticsHealth: (p = {}) => get(`/analytics/health?${new URLSearchParams(clean(p))}`),
  myProgress: () => get("/analytics/me"),
  analyticsGuides: () => get("/analytics/guides"),
  analyticsCoach: () => get("/analytics/coach"), // admin: privacy-safe coach / recommendation / AI adoption counts

  // AI course builder / quiz generator (drafts only; never publishes)
  aiStatus: () => get("/ai/status"),
  aiGenerateCourse: (body) => post("/ai/course/generate", body),
  aiGenerateQuiz: (body) => post("/ai/quiz/generate", body),
  aiGenerations: () => get("/ai/generations"),
  aiGeneration: (id) => get(`/ai/generations/${id}`),
  aiApply: (id, body) => post(`/ai/generations/${id}/apply`, body),

  // learning coach / recommendations / learning plans (learner-private; ownership enforced server-side)
  coachContext: (lessonId) => get("/coach/context" + (lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : "")),
  coachMessage: (body) => post("/coach/message", body),
  coachConversations: () => get("/coach/conversations"),
  coachConversation: (id) => get(`/coach/conversations/${id}`),
  recommendations: () => get("/recommendations"),
  recommendationFeedback: (id, value) => post(`/recommendations/${id}/feedback`, { value }),
  recommendationDismiss: (id) => post(`/recommendations/${id}/dismiss`),
  learningPlans: () => get("/learning-plans"),
  createLearningPlan: (body) => post("/learning-plans", body),
  learningPlan: (id) => get(`/learning-plans/${id}`),
  learningPlanAction: (id, action) => post(`/learning-plans/${id}/${action}`),
  learningPlanItemDone: (id, itemId) => post(`/learning-plans/${id}/items/${itemId}/done`),

  // guides
  guideProgress: () => get("/guides/progress"),
  updateGuideProgress: (guideId, body) => put(`/guides/${guideId}/progress`, body),
  logGuideEvent: (guideId, body) => post(`/guides/${guideId}/analytics`, body),
};
