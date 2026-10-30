import { route, notFound, startRouter, navigate, refreshRoute, currentRoute } from "./router.js";
import { getUser, login, DEMO_USER_BY_ROLE, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, DEMO_ENABLED, loginReal, isBackendOnline } from "./lib/store.js";
import { bus } from "./lib/events.js";
import { hydrateMyCourses, hydrateCatalog } from "./services/courseSync.js";
import { hydrateMyLearning } from "./services/learningSync.js";
import { hydrateCommunity } from "./services/communitySync.js";
import { hydrateSkills } from "./services/skillsSync.js";
import { hydrateUsers, hydrateNotifications, hydrateSettings } from "./services/people.js";
import "./services/realtime.js"; // live cross-panel updates: SSE stream → targeted re-hydration
import { h, mount } from "./lib/dom.js";
import { initShell, setPage } from "./layout/Shell.js";
import { initGuidePanel } from "./guide/GuidePanel.js";
import { initSpotlight } from "./guide/GuideSpotlight.js";
import { guideEngine } from "./guide/GuideEngine.js";
import { ErrorState, EmptyState } from "./components/States.js";
import { Button } from "./components/Button.js";
import { toast } from "./components/Overlay.js";
import { createCourse } from "./services/courses.js";

import { LoginPage } from "./pages/Login.js";
import { SignupPage } from "./pages/Signup.js";
import { ForgotPage, ResetPage } from "./pages/Reset.js";
import { CheckoutPage } from "./pages/Checkout.js";
import { DashboardPage } from "./pages/Dashboard.js";
import { CourseListPage } from "./pages/CourseList.js";
import { CourseBuilderPage } from "./pages/CourseBuilder.js";
import { AiCourseBuilderPage } from "./pages/AiCourseBuilder.js";
import { ExplorePage, CourseDetailPage } from "./pages/Explore.js";
import { MyLearningPage } from "./pages/MyLearning.js";
import { PlayerPage } from "./pages/Player.js";
import { JourneyPage } from "./pages/Journey.js";
import { SkillsPage } from "./pages/Skills.js";
import { MyProgressPage } from "./pages/MyProgress.js";
import { CoachPage } from "./pages/Coach.js";
import { CertificatesPage, CertificationsAdminPage, VerifyPage } from "./pages/Certificates.js";
import { AchievementsPage, NotificationsPage } from "./pages/Achievements.js";
import { CommunityPage } from "./pages/Community.js";
import { AssessmentsPage, LearnersPage } from "./pages/Instructor.js";
import { AnalyticsPage } from "./pages/Analytics.js";
import { PeoplePage, AutomationPage, IntegrationsPage, SettingsPage } from "./pages/Admin.js";

const $ = (id) => document.getElementById(id);
let currentPage = null;

const ALL = ["learner", "instructor", "admin"];
const AUTHOR = ["instructor", "admin"];
const LEARNER = ["learner"];

// path, page factory, options { roles, public }
route("/login", null, { public: true, auth: true });
route("/signup", null, { public: true, auth: true, signup: true });
route("/forgot", null, { public: true, auth: true, forgot: true });
route("/reset/:token", null, { public: true, auth: true, reset: true });
route("/checkout/:orderId", CheckoutPage, { roles: ALL });
route("/", DashboardPage, { roles: ALL });
route("/courses", CourseListPage, { roles: AUTHOR });
route("/builder/new", (ctx) => {
  const c = createCourse({ title: "", instructorId: ctx.user.id });
  navigate(`/builder/${c.id}`, { replace: true });
  return null;
}, { roles: AUTHOR });
route("/builder/ai", AiCourseBuilderPage, { roles: AUTHOR });
route("/builder/ai/:courseId", AiCourseBuilderPage, { roles: AUTHOR });
route("/builder/:id", CourseBuilderPage, { roles: AUTHOR });

// learner
route("/my-learning", MyLearningPage, { roles: LEARNER });
route("/explore", ExplorePage, { roles: LEARNER });
route("/explore/:id", CourseDetailPage, { roles: ALL });
route("/learn/:courseId/:lessonId?", PlayerPage, { roles: ALL });
route("/journeys", JourneyPage, { roles: LEARNER });
route("/progress", MyProgressPage, { roles: LEARNER });
route("/coach", CoachPage, { roles: LEARNER });
route("/achievements", AchievementsPage, { roles: LEARNER });
route("/certificates", CertificatesPage, { roles: LEARNER });
route("/notifications", NotificationsPage, { roles: ALL });

// shared
route("/skills", SkillsPage, { roles: ALL });
route("/community", CommunityPage, { roles: ALL });
route("/analytics", AnalyticsPage, { roles: AUTHOR });
route("/verify/:id?", VerifyPage, { public: true });

// instructor
route("/assessments", AssessmentsPage, { roles: AUTHOR });
route("/learners", LearnersPage, { roles: AUTHOR });

// admin
route("/people", PeoplePage, { roles: ["admin"] });
route("/certifications", CertificationsAdminPage, { roles: ["admin"] });
route("/automation", AutomationPage, { roles: ["admin"] });
route("/integrations", IntegrationsPage, { roles: ["admin"] });
route("/settings", SettingsPage, { roles: ["admin"] });

notFound(() => ({
  title: "Not found", crumbs: [{ label: "Not found" }],
  el: EmptyState({ icon: "compass", title: "We couldn't find that page", description: "The link may be broken or the page may have moved.", action: Button({ label: "Go home", variant: "primary", href: "/" }) }),
}));

function showAuth(el) {
  $("frame").hidden = true;
  $("auth-root").hidden = false;
  document.body.classList.remove("guide-open");
  return el;
}

function dispatch(match) {
  const user = getUser();
  const r = match.route;
  currentPage?.destroy?.();
  currentPage = null;

  if (r?.opts.auth) {
    if (user) return navigate("/", { replace: true });
    showAuth();
    if (r.opts.signup) { SignupPage($("auth-root")); document.title = "Create account · WorkEasyLMS"; return; }
    if (r.opts.forgot) { ForgotPage($("auth-root")); document.title = "Reset password · WorkEasyLMS"; return; }
    if (r.opts.reset) { ResetPage($("auth-root"), match.params.token); document.title = "Choose a new password · WorkEasyLMS"; return; }
    LoginPage($("auth-root"));
    document.title = "Sign in · WorkEasyLMS";
    return;
  }
  if (!user && !r?.opts.public) return navigate("/login", { replace: true });
  if (!user) {
    // Public page (e.g. certificate verification) for signed-out visitors
    const page = r.handler({ ...match, user: null });
    currentPage = page;
    showAuth();
    mount($("auth-root"), h("div", { class: "login" }, h("div", { class: "login-inner" }, [h("a", { href: "#/login", class: "small", style: "display:block;text-align:center;margin-bottom:16px" }, "← Back to sign in"), page.el])));
    document.title = `${page.title} · WorkEasyLMS`;
    return;
  }

  if (r?.opts.roles && !r.opts.roles.includes(user.role)) {
    toast("That page isn't available for your role.", { type: "info" });
    return navigate("/", { replace: true });
  }

  $("auth-root").hidden = true;
  $("frame").hidden = false;
  if (guideEngine.isOpen()) document.body.classList.add("guide-open");

  let page;
  try {
    page = r ? r.handler({ ...match, user }) : null;
    if (page === null && r) return; // handler redirected
    if (!r) page = notFoundPage();
  } catch (err) {
    console.error(err);
    page = { title: "Error", crumbs: [{ label: "Error" }], el: ErrorState({ description: "This page hit an unexpected problem.", onRetry: () => location.reload() }) };
  }
  currentPage = page;
  setPage(page, match.path);
}

const notFoundPage = () => ({
  title: "Not found", crumbs: [{ label: "Not found" }],
  el: EmptyState({ icon: "compass", title: "We couldn't find that page", description: "The link may be broken or the page may have moved.", action: Button({ label: "Go home", variant: "primary", href: "/" }) }),
});

// Demo shortcut: index.html?as=instructor signs in as that role (handy for demos and automated checks).
const asRole = new URLSearchParams(location.search).get("as");
if (DEMO_ENABLED && asRole && DEMO_USER_BY_ROLE[asRole]) {
  login(DEMO_USER_BY_ROLE[asRole]); // instant local session so the app boots even if the backend is down
  loginReal(DEMO_EMAIL_BY_ROLE[asRole], DEMO_PASSWORD).catch((err) => console.warn("[boot] backend unavailable:", err.message));
}

initShell();
initSpotlight();
initGuidePanel();
startRouter(dispatch);
guideEngine.init();

// Pull the signed-in author's real courses from the backend — on login, and on a plain page refresh where a
// session/token already existed — so "refresh the browser, log back in, still see the saved data" holds from
// the actual UI, not just the API. Re-renders the current route once hydration lands.
function hydrateIfAuthor() {
  const u = getUser();
  if (!u || !isBackendOnline()) return;
  // Courses first so enrollment/progress rows can be keyed to real lessons/blocks, then the rest in parallel.
  const courses = u.role === "learner" ? hydrateCatalog() : hydrateMyCourses();
  const tasks = [courses.then(() => hydrateMyLearning()).then(() => hydrateSkills()), hydrateCommunity(), hydrateUsers(), hydrateNotifications(), hydrateSettings()];
  Promise.all(tasks).then(() => {
    if (getUser()?.id !== u.id) return; // the person signed out (or switched account) while this hydration was in flight
    // Re-render list-style pages so freshly pulled data shows up. Interactive pages are left alone: a re-render
    // there would discard in-progress state (a half-answered quiz, a playing video, unsaved typing) — the Player
    // pulls its own authoritative progress on load, and the Builder reads its course when it mounts.
    // Analytics / My Progress fetch their own backend data on mount, so a re-mount would only reset the user's tab and
    // filters; a course's detail page (its learning journey) refreshes itself from the data events instead.
    // …and never re-mount under someone who is already typing: it would discard their input.
    const a = document.activeElement;
    const typing = !!a && !!a.closest?.("#main") && (a.isContentEditable || (/^(INPUT|TEXTAREA)$/.test(a.tagName) && !!a.value));
    if (!typing && !/^\/(learn\/|builder\/|analytics|progress|coach|explore\/[^/]+)/.test(currentRoute().path)) refreshRoute();
  });
}
bus.on("session", hydrateIfAuthor);
hydrateIfAuthor();

if (new URLSearchParams(location.search).get("selftest")) import("/tests/selftest.js");
