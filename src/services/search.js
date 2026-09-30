// Unified local search across courses, lessons, skills, journeys, discussions, people and certificates.
// Publication state is respected: learners only see published courses and their lessons.
import { load } from "../lib/store.js";
import { listCourses, lessonsOf, courseTitle } from "./courses.js";
import { users, userById } from "./people.js";
import { allCertificates, certificatesFor, journeysFor } from "./learning.js";

export const courseHref = (course, role) => (role === "learner" ? `/explore/${course.id}` : `/builder/${course.id}`);

export function search(query, user, limit = 5) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const role = user?.role || "learner";
  const has = (...parts) => parts.join(" ").toLowerCase().includes(q);
  const groups = [];
  const push = (label, items) => items.length && groups.push({ label, items: items.slice(0, limit) });

  const courses = listCourses().filter((c) => (role !== "learner" || c.status === "published") && has(c.title, c.description, c.category));
  push("Courses", courses.map((c) => ({ id: c.id, title: courseTitle(c), subtitle: `${c.category} · ${c.level}`, icon: "book", href: courseHref(c, role) })));

  const lessons = [];
  listCourses().filter((c) => role !== "learner" || c.status === "published").forEach((c) => lessonsOf(c).forEach((l) => has(l.title) && lessons.push({ id: l.id, title: l.title, subtitle: courseTitle(c), icon: "file", href: role === "learner" ? `/learn/${c.id}/${l.id}` : `/builder/${c.id}` })));
  push("Lessons", lessons);

  push("Skills", load("skills").filter((s) => has(s.name, s.description)).map((s) => ({ id: s.id, title: s.name, subtitle: s.category, icon: "target", href: "/skills" })));
  if (role === "learner") push("Journeys", journeysFor(user.id).filter((j) => has(j.title, j.description)).map((j) => ({ id: j.id, title: j.title, subtitle: `${j.nodes.length} steps · ${j.pct}% complete`, icon: "route", href: "/journeys" })));
  push("Discussions", load("posts").filter((p) => has(p.title, p.body)).map((p) => ({ id: p.id, title: p.title, subtitle: `${userById(p.authorId)?.name} · ${p.kind}`, icon: "message", href: `/community?post=${p.id}` })));
  push("People", users().filter((u) => has(u.name, u.title, u.dept)).map((u) => ({ id: u.id, title: u.name, subtitle: `${u.title} · ${u.dept}`, icon: "user", href: role === "admin" ? "/people" : "/community" })));
  const certs = role === "admin" ? allCertificates() : role === "learner" ? certificatesFor(user.id) : [];
  push("Certificates", certs.filter((c) => has(c.id, courseTitle(listCourses().find((x) => x.id === c.courseId) || { title: "" }))).map((c) => ({ id: c.id, title: c.id, subtitle: userById(c.userId)?.name, icon: "award", href: role === "admin" ? "/certifications" : "/certificates" })));
  return groups;
}
