// Skills: learner view (backend-persisted progress, levels, evidence, gaps, related courses), instructor view
// (library + mapping overview for their courses), admin view (manage the library and categories, see coverage).
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card, SectionTitle } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { MeterRow, ProgressRing } from "../components/Progress.js";
import { CourseCard } from "../components/Domain.js";
import { EmptyState } from "../components/States.js";
import { GuideButton } from "../components/GuideButton.js";
import { Field, Input, Textarea, Select } from "../components/Form.js";
import { openModal, confirmDialog, toast } from "../components/Overlay.js";
import { userSkills, recommended, courseProgress } from "../services/learning.js";
import { listCourses, courseTitle, lessonsOf } from "../services/courses.js";
import { load, isBackendOnline } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { api } from "../services/api.js";
import { hydrateSkillLibrary, LEVEL_LABELS } from "../services/skillsSync.js";
import { can } from "../services/permissions.js";

export function SkillsPage(ctx) {
  if (ctx.user.role === "admin") return AdminSkills(ctx.user);
  if (ctx.user.role === "instructor") return InstructorSkills(ctx.user);
  return LearnerSkills(ctx.user);
}

// ---------------- learner ----------------
function LearnerSkills(user) {
  const stage = h("div", { class: "stack-lg" });

  function draw() {
    const skills = userSkills(user.id).sort((a, b) => b.level - a.level);
    const gaps = skills.filter((s) => s.gap > 0).sort((a, b) => b.gap - a.gap);
    const strong = skills.filter((s) => s.gap === 0);
    const improving = skills.filter((s) => s.improving);
    const recs = recommended(user.id, 3);
    const overall = skills.length ? Math.round(skills.reduce((n, s) => n + s.level, 0) / skills.length) : 0;
    const byCategory = new Map();
    skills.forEach((s) => { const k = s.skill.category || "General"; if (!byCategory.has(k)) byCategory.set(k, []); byCategory.get(k).push(s); });
    const source = skills[0]?.source;

    stage.replaceChildren(
      h("div", { class: "dash-cols" }, [
        h("div", { class: "stack-lg" }, [
          skills.length === 0 && Card(EmptyState({ icon: "target", title: "No skills yet", description: "Enrol in a course to start building skills — every course you take is mapped to the skills it develops.", action: Button({ label: "Explore courses", variant: "primary", href: "/explore" }) })),
          ...[...byCategory.entries()].map(([cat, list]) => h("section", { class: "stack", "data-skill-category": cat }, [
            SectionTitle(cat, null, `${list.length} ${list.length === 1 ? "skill" : "skills"}`),
            h("div", { class: "grid grid-2" }, list.map((s, i) => LearnerSkillCard(user, s, i === 0 && cat === byCategory.keys().next().value))),
          ])),
          gaps.length > 0 && h("section", { class: "stack", "data-guide-target": "skills.gaps" }, [
            SectionTitle("Skill gaps", null, "Biggest distance to your target first"),
            h("div", { class: "stack-sm" }, gaps.map((s) => GapRow(user, s))),
          ]),
          strong.length > 0 && h("section", {}, [SectionTitle("On target"), h("div", { class: "row wrap" }, strong.map((s) => Badge(`${s.skill.name} · ${s.levelLabel}`, "success", "check")))]),
        ]),
        h("div", { class: "stack-lg" }, [
          Card(h("div", { class: "stack" }, [
            h("div", { class: "skill-ring-card" }, [ProgressRing(overall, { size: 84, stroke: 9 }), h("div", {}, [h("div", { class: "eyebrow" }, "Overall skill progress"), h("div", { class: "small muted" }, "Average progress across the skills your courses build.")])]),
            h("div", { class: "skill-stats" }, [
              h("div", { class: "skill-stat" }, [h("div", { class: "stat-value" }, String(skills.length)), h("div", { class: "xs muted" }, "Skills")]),
              h("div", { class: "skill-stat" }, [h("div", { class: "stat-value" }, String(improving.length)), h("div", { class: "xs muted" }, "Improving")]),
              h("div", { class: "skill-stat" }, [h("div", { class: "stat-value" }, String(gaps.length)), h("div", { class: "xs muted" }, "Gaps")]),
            ]),
            h("p", { class: "xs muted" }, source === "projected" ? "Showing an estimate — the server-recorded standing loads once you're back online." : "Levels are earned from evidence: completed lessons, passed quizzes and reviewed assignments."),
          ]), { attrs: { "data-guide-target": "skills.overview", "data-skills-source": source || "none" } }),
          h("section", { "data-guide-target": "skills.recommendation" }, [SectionTitle("Close a gap"), recs.length ? h("div", { class: "stack" }, recs.map((r) => CourseCard({ course: r.course, href: `/explore/${r.course.id}`, reason: r.reason }))) : Card(EmptyState({ icon: "sparkles", title: "Nothing to recommend right now" }))]),
        ]),
      ]),
    );
  }

  const offs = ["data:userSkills", "data:skills", "data:enrollments"].map((ev) => bus.on(ev, () => stage.isConnected && draw()));
  draw();
  const el = h("div", { class: "stack-lg" }, [
    PageHeader({ title: "My skills", sub: "Skills grow from evidence as you complete lessons, pass quizzes and get assignments reviewed.", actions: [GuideButton("my-skills")] }),
    stage,
  ]);
  return { title: "Skills", crumbs: [{ label: "Skills" }], el, destroy: () => offs.forEach((off) => off()) };
}

function LearnerSkillCard(user, s, first) {
  const status = s.gap === 0 && s.level > 0 ? ["On target", "success"] : s.improving ? ["Improving", "primary"] : s.gap > 40 ? ["Gap", "warning"] : ["Building", ""];
  const related = s.contributors.slice(0, 3);
  return h("div", { class: "card card-pad-sm stack-sm", "data-skill-card": s.skill.id, "data-guide-target": first ? "skills.card" : undefined }, [
    h("div", { class: "row-between" }, [h("div", { class: "row-sm" }, [h("span", { style: "display:inline-flex;color:var(--c-primary)" }, ico(s.skill.icon || "target", 18)), h("h4", {}, s.skill.name)]), Badge(status[0], status[1])]),
    h("p", { class: "small muted" }, s.skill.description),
    h("div", { class: "row-between xs" }, [h("span", { class: "strong" }, `Level ${s.currentLevel} · ${s.levelLabel}`), h("span", { class: "muted" }, `Target: ${LEVEL_LABELS[s.targetLevel]}`)]),
    MeterRow("Progress", s.level, { target: s.target }),
    related.length > 0 && h("div", { class: "row-sm wrap xs" }, ["Related: ", ...related.map((c) => h("a", { class: "chip", href: `#/explore/${c.course.id}`, title: `${c.pct}% complete` }, courseTitle(c.course)))]),
    s.evidence.length > 0 && h("details", { class: "xs" }, [h("summary", { class: "muted", style: "cursor:pointer" }, `${s.evidence.length} piece${s.evidence.length === 1 ? "" : "s"} of evidence`), h("ul", { class: "skill-evidence", style: "margin-top:6px" }, s.evidence.slice(0, 6).map((ev) => h("li", {}, [h("span", { class: "truncate" }, ev.label), h("span", { class: "strong" }, `+${ev.points}`)])))]),
  ]);
}

function GapRow(user, s) {
  const next = s.contributors.find((c) => c.pct < 100)?.course || listCourses({ status: "published" }).find((c) => (c.skills || []).some((x) => x.skillId === s.skill.id) && courseProgress(user.id, c.id).status !== "completed");
  return h("div", { class: "card card-pad-sm row wrap", style: "align-items:center", "data-skill-gap": s.skill.id }, [
    h("div", { class: "grow", style: "min-width:200px" }, [h("div", { class: "strong small" }, s.skill.name), h("div", { class: "xs muted" }, `${s.gap}% to ${LEVEL_LABELS[s.targetLevel]} · currently ${s.levelLabel}`)]),
    h("div", { style: "width:160px" }, MeterRow("", s.level, { target: s.target })),
    next ? Button({ label: `Close it: ${courseTitle(next)}`, size: "sm", variant: "secondary", icon: "arrow-right", href: `/explore/${next.id}` }) : h("span", { class: "xs muted" }, "No course builds this yet"),
  ]);
}

// ---------------- instructor ----------------
function InstructorSkills(user) {
  const stage = h("div", { class: "stack-lg" });
  function draw() {
    const skills = load("skills").filter((s) => s.active !== false);
    const mine = listCourses().filter((c) => can(user, "course.edit", c));
    stage.replaceChildren(
      h("section", { class: "stack" }, [
        SectionTitle("Your courses and the skills they build", null, "Map skills in the Course Builder"),
        mine.length ? h("div", { class: "stack-sm" }, mine.map((c) => {
          const ls = lessonsOf(c);
          const mapped = ls.filter((l) => (l.skills || []).length).length;
          return h("div", { class: "card card-pad-sm row wrap", style: "align-items:center", "data-skill-course": c.id }, [
            h("div", { class: "grow", style: "min-width:220px" }, [h("div", { class: "strong small" }, courseTitle(c)), h("div", { class: "xs muted" }, `${mapped} of ${ls.length} lessons mapped`)]),
            h("div", { class: "row-sm wrap" }, (c.skills || []).length ? c.skills.map((s) => Badge(`${skills.find((x) => x.id === s.skillId)?.name || s.skillId} · L${s.targetLevel || 3}`, "teal")) : [h("span", { class: "xs muted" }, "No skills mapped yet")]),
            Button({ label: "Map skills", size: "sm", variant: "secondary", icon: "target", href: `/builder/${c.id}` }),
          ]);
        })) : Card(EmptyState({ icon: "layers", title: "No courses yet", description: "Create a course, then map the skills it builds.", action: Button({ label: "Create course", variant: "primary", href: "/builder/new" }) })),
      ]),
      h("section", { class: "stack" }, [SectionTitle("Skills library", null, "Managed by your admin"), LibraryTable(skills, null)]),
    );
  }
  const offs = ["data:skills", "data:courses"].map((ev) => bus.on(ev, () => stage.isConnected && draw()));
  draw();
  return { title: "Skills", crumbs: [{ label: "Skills" }], el: h("div", { class: "stack-lg" }, [PageHeader({ title: "Skills", sub: "Which skills your courses build, and where lessons still need mapping." }), stage]), destroy: () => offs.forEach((off) => off()) };
}

// ---------------- admin ----------------
function AdminSkills(user) {
  const stage = h("div", { class: "stack-lg" });
  let showInactive = false;

  async function refresh() { try { await hydrateSkillLibrary(); } catch (err) { toast(err.message, { type: "error" }); } draw(); }

  function skillForm(existing) {
    const cats = load("skillCategories");
    const s = { name: existing?.name || "", description: existing?.description || "", categoryId: existing?.categoryId || cats[0]?.id || "", icon: existing?.icon || "target" };
    const content = h("div", { class: "stack" }, [
      Field({ label: "Name", control: Input({ value: s.name, "aria-label": "Skill name", placeholder: "e.g. Negotiation", oninput: (e) => (s.name = e.target.value) }) }),
      Field({ label: "Description", control: Textarea({ rows: 2, value: s.description, "aria-label": "Skill description", placeholder: "What does someone with this skill do well?", oninput: (e) => (s.description = e.target.value) }) }),
      h("div", { class: "grid grid-2" }, [
        Field({ label: "Category", control: Select({ options: cats.map((c) => ({ value: c.id, label: c.name })), value: s.categoryId, onChange: (v) => (s.categoryId = v), attrs: { "aria-label": "Skill category" } }) }),
        Field({ label: "Icon", control: Select({ options: ["target", "compass", "layers", "zap", "message", "users", "chart", "shield", "bulb", "star"].map((v) => ({ value: v, label: v })), value: s.icon, onChange: (v) => (s.icon = v), attrs: { "aria-label": "Skill icon" } }) }),
      ]),
      h("p", { class: "xs muted" }, "Levels: 1 Novice · 2 Developing · 3 Proficient · 4 Advanced. Proficient and Advanced require assessed evidence."),
    ]);
    openModal({
      title: existing ? `Edit “${existing.name}”` : "New skill", size: "sm", content,
      footer: (close) => [
        Button({ label: "Cancel", onClick: close }),
        Button({ label: existing ? "Save changes" : "Create skill", variant: "primary", attrs: { "data-skill-action": "save" }, onClick: async () => {
          if (!s.name.trim()) { toast("Give the skill a name", { type: "error" }); return; }
          if (!isBackendOnline()) { toast("Can't reach the server — the skills library is managed on the backend.", { type: "error" }); return; }
          try {
            if (existing) await api.updateSkill(existing.id, { name: s.name.trim(), description: s.description, categoryId: s.categoryId || null, icon: s.icon });
            else await api.createSkill({ name: s.name.trim(), description: s.description, categoryId: s.categoryId || null, icon: s.icon });
            close(); toast(existing ? "Skill updated" : `“${s.name.trim()}” added to the library`); await refresh();
          } catch (err) { toast(err.message, { type: "error" }); }
        } }),
      ],
    });
  }

  function categoryForm() {
    const c = { name: "", description: "" };
    openModal({
      title: "New category", size: "sm",
      content: h("div", { class: "stack" }, [Field({ label: "Name", control: Input({ "aria-label": "Category name", placeholder: "e.g. Product knowledge", oninput: (e) => (c.name = e.target.value) }) }), Field({ label: "Description", control: Input({ "aria-label": "Category description", oninput: (e) => (c.description = e.target.value) }) })]),
      footer: (close) => [Button({ label: "Cancel", onClick: close }), Button({ label: "Create category", variant: "primary", onClick: async () => {
        if (!c.name.trim()) { toast("Give the category a name", { type: "error" }); return; }
        try { await api.createSkillCategory({ name: c.name.trim(), description: c.description, position: load("skillCategories").length }); close(); toast("Category created"); await refresh(); }
        catch (err) { toast(err.message, { type: "error" }); }
      } })],
    });
  }

  async function toggleActive(s) {
    const deactivating = s.active !== false;
    if (deactivating && !(await confirmDialog({ title: `Deactivate “${s.name}”?`, message: "It stays on existing mappings and learner records, but can't be added to new courses.", confirmLabel: "Deactivate" }))) return;
    try { await (deactivating ? api.deactivateSkill(s.id) : api.activateSkill(s.id)); toast(deactivating ? "Skill deactivated" : "Skill reactivated", { type: "info" }); await refresh(); }
    catch (err) { toast(err.message, { type: "error" }); }
  }

  function draw() {
    const all = load("skills");
    const skills = all.filter((s) => showInactive || s.active !== false);
    const cats = load("skillCategories");
    const courses = listCourses();
    stage.replaceChildren(
      h("section", { class: "stack" }, [
        h("div", { class: "row-between wrap" }, [
          SectionTitle("Skills library", null, `${all.filter((s) => s.active !== false).length} active · ${all.filter((s) => s.active === false).length} inactive`),
          h("div", { class: "row-sm wrap" }, [
            Button({ label: showInactive ? "Hide inactive" : "Show inactive", size: "sm", variant: "ghost", onClick: () => { showInactive = !showInactive; draw(); } }),
            Button({ label: "New category", size: "sm", variant: "secondary", icon: "plus", onClick: categoryForm }),
            Button({ label: "New skill", size: "sm", variant: "primary", icon: "plus", attrs: { "data-guide-target": "skills.new" }, onClick: () => skillForm(null) }),
          ]),
        ]),
        LibraryTable(skills, { onEdit: (s) => skillForm(s), onToggle: toggleActive }, courses),
      ]),
      h("section", { class: "stack" }, [
        SectionTitle("Categories", null, `${cats.length}`),
        h("div", { class: "row wrap" }, cats.length ? cats.map((c) => Badge(`${c.name} · ${all.filter((s) => s.categoryId === c.id).length}`, "teal")) : [h("span", { class: "small muted" }, "No categories yet.")]),
      ]),
      h("section", { class: "stack" }, [
        SectionTitle("Course coverage", null, "Which published courses build each skill"),
        h("div", { class: "grid grid-2" }, skills.map((s) => {
          const builders = courses.filter((c) => c.status === "published" && (c.skills || []).some((x) => x.skillId === s.id));
          return h("div", { class: "card card-pad-sm stack-sm", "data-skill-coverage": s.id }, [
            h("div", { class: "row-between" }, [h("h4", {}, s.name), Badge(builders.length ? `${builders.length} course${builders.length === 1 ? "" : "s"}` : "Not covered", builders.length ? "success" : "warning")]),
            h("div", { class: "xs muted" }, builders.length ? builders.map((c) => `${courseTitle(c)} (L${c.skills.find((x) => x.skillId === s.id).targetLevel || 3})`).join(", ") : "No published course builds this skill yet — map it in a Course Builder."),
          ]);
        })),
      ]),
    );
  }

  const offs = ["data:skills", "data:skillCategories", "data:courses"].map((ev) => bus.on(ev, () => stage.isConnected && draw()));
  draw();
  return { title: "Skills", crumbs: [{ label: "Skills" }], el: h("div", { class: "stack-lg" }, [PageHeader({ title: "Skills", sub: "Manage the organisation's skills library and see which courses build each skill." }), stage]), destroy: () => offs.forEach((off) => off()) };
}

function LibraryTable(skills, actions, courses = listCourses()) {
  if (!skills.length) return Card(EmptyState({ icon: "target", title: "No skills in the library yet", description: actions ? "Create the first skill to start mapping courses to it." : "Ask your admin to add skills." }));
  return h("div", { class: "card", style: "overflow:auto" }, h("table", { class: "skill-table", "data-skill-table": "" }, [
    h("thead", {}, h("tr", {}, [h("th", {}, "Skill"), h("th", {}, "Category"), h("th", {}, "Courses"), h("th", {}, "Status"), actions && h("th", {}, "")])),
    h("tbody", {}, skills.map((s) => h("tr", { "data-skill-row": s.id }, [
      h("td", {}, [h("div", { class: "row-sm" }, [h("span", { style: "display:inline-flex;color:var(--c-primary)" }, ico(s.icon || "target", 16)), h("span", { class: "strong" }, s.name)]), h("div", { class: "xs muted" }, s.description)]),
      h("td", {}, s.category || "General"),
      h("td", {}, String(courses.filter((c) => (c.skills || []).some((x) => x.skillId === s.id)).length)),
      h("td", {}, Badge(s.active === false ? "Inactive" : "Active", s.active === false ? "" : "success")),
      actions && h("td", {}, h("div", { class: "row-sm", style: "justify-content:flex-end" }, [
        Button({ label: "Edit", size: "sm", variant: "ghost", icon: "edit", attrs: { "data-skill-action": "edit" }, onClick: () => actions.onEdit(s) }),
        Button({ label: s.active === false ? "Activate" : "Deactivate", size: "sm", variant: "ghost", attrs: { "data-skill-action": "toggle" }, onClick: () => actions.onToggle(s) }),
      ])),
    ]))),
  ]));
}
