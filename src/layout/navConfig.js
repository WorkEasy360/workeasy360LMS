// Role-aware navigation. Sections map to the product areas: Learn / Create / Engage / Measure / Automate.
export const navByRole = {
  learner: [
    { section: "Learn", items: [
      { label: "Home", path: "/", icon: "home" },
      { label: "My Learning", path: "/my-learning", icon: "book" },
      { label: "Explore", path: "/explore", icon: "compass" },
      { label: "Journeys", path: "/journeys", icon: "route" },
      { label: "Coach", path: "/coach", icon: "sparkles" },
    ] },
    { section: "Grow", items: [
      { label: "My Progress", path: "/progress", icon: "chart" },
      { label: "Skills", path: "/skills", icon: "target" },
      { label: "Achievements", path: "/achievements", icon: "star" },
      { label: "Certificates", path: "/certificates", icon: "award" },
    ] },
    { section: "Engage", items: [
      { label: "Community", path: "/community", icon: "message" },
      { label: "Notifications", path: "/notifications", icon: "bell", count: "notifications" },
    ] },
  ],
  instructor: [
    { section: "Create", items: [
      { label: "Dashboard", path: "/", icon: "home" },
      { label: "My Courses", path: "/courses", icon: "layers" },
      { label: "Assessments", path: "/assessments", icon: "clipboard" },
    ] },
    { section: "Teach", items: [
      { label: "Learners", path: "/learners", icon: "users" },
      { label: "Skills", path: "/skills", icon: "target" },
      { label: "Community", path: "/community", icon: "message" },
    ] },
    { section: "Measure", items: [{ label: "Analytics", path: "/analytics", icon: "chart" }] },
  ],
  admin: [
    { section: "Overview", items: [{ label: "Overview", path: "/", icon: "home" }] },
    { section: "Manage", items: [
      { label: "Learning", path: "/courses", icon: "layers" },
      { label: "People", path: "/people", icon: "users" },
      { label: "Skills", path: "/skills", icon: "target" },
      { label: "Community", path: "/community", icon: "message" },
      { label: "Certifications", path: "/certifications", icon: "award" },
    ] },
    { section: "Measure", items: [{ label: "Analytics", path: "/analytics", icon: "chart" }] },
    { section: "Automate", items: [
      { label: "Automation", path: "/automation", icon: "workflow" },
      { label: "Integrations", path: "/integrations", icon: "plug" },
      { label: "Settings", path: "/settings", icon: "settings" },
    ] },
  ],
};

export const ROLE_LABEL = { learner: "Learner", instructor: "Instructor", admin: "Admin" };

// Which path in the nav should be highlighted for a given route path.
export function activeNavPath(path, role) {
  const flat = navByRole[role].flatMap((s) => s.items.map((i) => i.path));
  if (path.startsWith("/builder")) return "/courses";
  if (path.startsWith("/explore") || path.startsWith("/learn")) return role === "learner" ? (path.startsWith("/learn") ? "/my-learning" : "/explore") : "/courses";
  if (path.startsWith("/verify")) return null;
  const hit = flat.filter((p) => p !== "/" && (path === p || path.startsWith(p + "/"))).sort((a, b) => b.length - a.length)[0];
  return hit || (path === "/" ? "/" : null);
}
