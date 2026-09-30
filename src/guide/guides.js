// Guide definitions.
//
// Guide      { id, title, description, type, role, estimatedMinutes, outcome, contextRoutes, triggers, nextActions, steps[] }
// GuideStep  { id, guideId, order, title, description, tip, target, route, action, completion, nextStep, estimatedDuration, settleMs }
//
// completion = { events: [...bus events that re-check this step], check(ctx, payload) => boolean }
//   - the step completes only when the user really performs the action (validated against app state)
//   - `check` is also evaluated on step entry / route change / data change, so pre-completed state is recognised.
// route = { match: RegExp, go: () => "/path", label } — the screen the step lives on; the guide can take the user there.

export const GUIDE_TYPES = {
  interactive: "Interactive guide",
  quick: "Quick guide",
  "step-by-step": "Step-by-step guide",
  feature: "Feature guide",
  "role-based": "Role-based guide",
  "first-time": "First-time user guide",
  ai: "AI guide (soon)",
};

// Future trigger hooks (not wired to automation yet): first-visit, first-login, role-assignment, new-feature,
// help-request, inactivity, failed-action, admin-recommendation.

const has = (target) => !!document.querySelector(`[data-guide-target="${target}"]`);
const builderRoute ={ match: /^\/builder\/[^/]+$/, go: () => "/builder/new", label: "Open the Course Builder" };
const ready = (ctx) => !!ctx.course;

const raw = {
  "create-first-course": {
    title: "Create Your First Course",
    description: "Name a course, add a module and a lesson, preview it and publish — by doing each step for real.",
    type: "interactive",
    roles: ["instructor", "admin"],
    estimatedMinutes: 4,
    outcome: "You created and published your first course.",
    contextRoutes: [/^\/courses/, /^\/builder/, /^\/$/],
    triggers: ["first-visit", "role-assignment", "help-request"],
    nextActions: [
      { label: "Add more lessons", icon: "plus", href: (ctx) => (ctx.course ? `/builder/${ctx.course.id}` : "/courses") },
      { label: "See it as a learner", icon: "eye", href: (ctx) => (ctx.course ? `/explore/${ctx.course.id}` : "/courses") },
    ],
    steps: [
      {
        id: "name", title: "Name your course", target: "course.name", route: builderRoute, action: "Type a name",
        description: "A clear name tells learners what they'll get. Click the highlighted field and type a course name.",
        tip: "Try something outcome-focused, like “Handling Customer Objections”.",
        estimatedDuration: 20, settleMs: 1000,
        completion: { events: ["course.title.changed"], check: (ctx) => ready(ctx) && ctx.course.title.trim().length >= 3 },
      },
      {
        id: "module", title: "Add a module", target: "course.add-module", route: builderRoute, action: "Click “Add module”",
        description: "Modules group related lessons into chapters. Click the highlighted button to add your first module.",
        tip: "Most courses have 3–6 modules. You can rename and reorder them any time.",
        estimatedDuration: 10,
        completion: { events: ["module.added"], check: (ctx) => ready(ctx) && ctx.course.modules.length > 0 },
      },
      {
        id: "lesson", title: "Add a lesson", target: "course.add-lesson", route: builderRoute, action: "Click “Add lesson”",
        description: "Lessons hold the actual learning content. Add one to your new module.",
        tip: "Use the ▾ next to the button for videos, quizzes, assignments and discussions.",
        estimatedDuration: 10,
        completion: { events: ["lesson.added"], check: (ctx) => ready(ctx) && ctx.course.modules.some((m) => m.lessons.length > 0) },
      },
      {
        id: "preview", title: "Preview your course", target: "course.preview", route: builderRoute, action: "Click “Preview”",
        description: "See the course exactly as a learner would before anyone else does.",
        tip: "Use “Back to editing” in the preview bar to return.",
        estimatedDuration: 15,
        completion: { events: ["course.previewed"] },
      },
      {
        id: "publish", title: "Publish your course", target: "course.publish", route: builderRoute, action: "Click “Publish”",
        description: "Publishing makes the course visible in the catalog. Click Publish to go live.",
        tip: "You can unpublish any time — learner progress is kept.",
        estimatedDuration: 10,
        completion: { events: ["course.published"], check: (ctx) => ready(ctx) && ctx.course.status === "published" },
      },
    ],
  },

  "add-first-video": {
    title: "Add Your First Video",
    description: "Upload a video straight into WorkEasy360 — no YouTube or Vimeo account needed — then preview and save it.",
    type: "interactive",
    roles: ["instructor", "admin"],
    estimatedMinutes: 3,
    outcome: "Your video is uploaded, processed and saved in a lesson.",
    contextRoutes: [/^\/builder/],
    triggers: ["help-request", "new-feature"],
    nextActions: [
      { label: "Publish the course", icon: "rocket", href: (ctx) => (ctx.course ? `/builder/${ctx.course.id}` : "/courses") },
      { label: "Add a quiz next", icon: "clipboard", href: (ctx) => (ctx.course ? `/builder/${ctx.course.id}` : "/courses") },
    ],
    steps: [
      {
        id: "builder", title: "Open the Course Builder", target: ["courses.new", "courses.new-dashboard", "courses.new-bottom", "nav.create-course"], action: "Click “Create Course”", estimatedDuration: 8,
        description: "Every course is built in the Course Builder. Create a course to open it — or continue in one you already have open.",
        tip: "Instructors and admins both start from Create Course — no settings pages needed.",
        completion: { events: [], check: (ctx) => /^\/builder\/[^/]+$/.test(ctx.route.path) },
      },
      {
        id: "lesson", title: "Add a lesson", target: ["course.add-lesson", "course.add-module"], route: builderRoute, action: "Add a module, then a lesson", estimatedDuration: 12,
        description: "Lessons live inside modules. If your course has no module yet, add one first — then add a lesson to it.",
        tip: "The lesson opens in the editor on the right, ready for content.",
        completion: { events: ["lesson.added"], check: (ctx) => ready(ctx) && ctx.course.modules.some((m) => m.lessons.length > 0) },
      },
      {
        id: "video", title: "Select Video", target: ["block.video", "block.add"], route: builderRoute, action: "Add content block → Video", estimatedDuration: 8,
        description: "Open “Add content block” and choose Video. The video source chooser opens straight away.",
        tip: "Blocks stack in the order you add them and can be reordered.",
        completion: { events: ["video.block.added"], check: (ctx) => ready(ctx) && ctx.course.modules.some((m) => m.lessons.some((l) => l.blocks.some((b) => b.type === "video"))) },
      },
      {
        id: "source", title: "Choose Upload Video", target: "video.source-upload", route: builderRoute, action: "Click “Upload Video”", estimatedDuration: 6,
        description: "Upload Video puts the file directly into WorkEasy360. YouTube, Vimeo and external URLs are there too if you need them.",
        tip: "Uploaded videos get progress tracking, resume, captions and completion rules.",
        completion: { events: ["video.source.selected"], check: (ctx, p) => p?.source === "native" || has("video.browse") || has("video.progress") || has("video.preview") },
      },
      {
        id: "file", title: "Choose a video file", target: "video.browse", route: builderRoute, action: "Browse or drop a file", estimatedDuration: 15,
        description: "Drag a video onto the drop zone or click Browse Files. MP4, WebM and MOV are supported.",
        tip: "The maximum size is set by your administrator.",
        completion: { events: ["video.file.chosen"], check: () => has("video.progress") || has("video.preview") },
      },
      {
        id: "process", title: "Wait for upload & processing", target: "video.progress", route: builderRoute, passive: true, action: "Sit tight — this finishes by itself", estimatedDuration: 20,
        description: "Your video uploads, then WorkEasy360 reads its details and generates a thumbnail. This step completes automatically.",
        tip: "You can cancel any time before it finishes.",
        completion: { events: ["video.ready"], check: () => has("video.preview") },
      },
      {
        id: "preview", title: "Preview the video", target: "video.preview", route: builderRoute, action: "Press play", estimatedDuration: 10,
        description: "Press play to check it looks and sounds right. Add a title, thumbnail and captions below if you like.",
        tip: "Keyboard: Space plays/pauses, ← → seek, F toggles fullscreen, C toggles captions.",
        completion: { events: ["video.previewed"] },
      },
      {
        id: "save", title: "Save the lesson", target: ["video.save", "lesson.save"], route: builderRoute, action: "Click “Save video”", estimatedDuration: 8,
        description: "Save the video to attach it to your lesson. Changes are also autosaved as you work.",
        tip: "Next you can set a completion rule, such as “Complete when the video reaches 90%”.",
        completion: { events: ["lesson.saved"] },
      },
    ],
  },

  "first-lesson": {
    title: "Take Your First Lesson",
    description: "Find a course, start learning and complete a lesson to see your progress, skills and journey update.",
    type: "first-time",
    roles: ["learner"],
    estimatedMinutes: 3,
    outcome: "You completed your first lesson — watch your progress and skills grow.",
    contextRoutes: [/^\/$/, /^\/explore/, /^\/my-learning/, /^\/learn/],
    triggers: ["first-login", "role-assignment", "help-request"],
    nextActions: [
      { label: "See my skills", icon: "target", href: () => "/skills" },
      { label: "View my journey", icon: "route", href: () => "/journeys" },
    ],
    steps: [
      {
        id: "explore", title: "Open Explore", target: "nav.explore", action: "Click “Explore”", estimatedDuration: 8,
        description: "Explore is the catalog of everything you can learn. Open it from the sidebar.",
        tip: "Your recommendations are based on your skill gaps.",
        completion: { events: [], check: (ctx) => /^\/explore/.test(ctx.route.path) || /^\/learn/.test(ctx.route.path) },
      },
      {
        id: "pick", title: "Pick a course", target: "explore.first-course", action: "Open a course", estimatedDuration: 10,
        route: { match: /^\/explore(\/[^/]+)?$/, go: () => "/explore", label: "Open Explore" },
        description: "Choose any course to see what's inside. Click the highlighted card.",
        tip: "Progress bars show what you've already started.",
        completion: { events: [], check: (ctx) => /^\/explore\/[^/]+$/.test(ctx.route.path) || /^\/learn/.test(ctx.route.path) },
      },
      {
        id: "start", title: "Start learning", target: "course.start", action: "Click the main button", estimatedDuration: 8,
        route: { match: /^\/(explore\/[^/]+|learn\/.+)$/, go: () => "/explore", label: "Open Explore" },
        description: "Enrol and jump into the first lesson — or continue where you left off.",
        tip: "You can leave and come back; your place is always saved.",
        completion: { events: [], check: (ctx) => /^\/learn\//.test(ctx.route.path) },
      },
      {
        id: "complete", title: "Complete the lesson", target: "player.complete", action: "Click “Mark complete”", estimatedDuration: 30,
        route: { match: /^\/learn\//, go: () => "/my-learning", label: "Go to My Learning" },
        description: "Read or watch the lesson, then mark it complete. The next lesson unlocks and your progress updates.",
        tip: "Quiz lessons complete when you pass them.",
        completion: { events: ["lesson.completed"] },
      },
    ],
  },
  "my-skills": {
    title: "Understand Your Skills",
    description: "See how lessons, quizzes and assignments build real skill evidence, find your biggest gap and pick the course that closes it.",
    type: "feature",
    roles: ["learner"],
    estimatedMinutes: 2,
    outcome: "You know where you stand on each skill and have started the course that closes your biggest gap.",
    contextRoutes: [/^\/skills/],
    triggers: ["help-request", "new-feature"],
    nextActions: [
      { label: "View my journey", icon: "route", href: () => "/journeys" },
      { label: "Back to my skills", icon: "target", href: () => "/skills" },
    ],
    steps: [
      {
        id: "open", title: "Open Skills", target: "nav.skills", action: "Click “Skills”", estimatedDuration: 5,
        description: "Your skills page shows every skill your courses build, with the level you've earned so far.",
        tip: "Levels come from evidence — completed lessons, passed quizzes and reviewed assignments — never from time spent.",
        completion: { events: [], check: (ctx) => /^\/skills/.test(ctx.route.path) },
      },
      {
        id: "overview", title: "Read your overall progress", target: "skills.overview", passive: true, action: "Take a look", estimatedDuration: 6,
        route: { match: /^\/skills/, go: () => "/skills", label: "Open Skills" },
        description: "The ring is your average progress across skills. “Improving” counts skills that moved in the last two weeks.",
        tip: "Proficient and Advanced levels need at least one passed quiz or reviewed assignment.",
        completion: { events: [], check: () => has("skills.overview") },
      },
      {
        id: "gap", title: "Pick a course that closes a gap", target: "skills.gaps", action: "Open a recommended course", estimatedDuration: 10,
        route: { match: /^\/skills/, go: () => "/skills", label: "Open Skills" },
        description: "Your biggest gaps are listed first, each with a course that builds that skill. Open one.",
        tip: "Related courses are the ones mapped to that skill by your instructors.",
        completion: { events: [], check: (ctx) => /^\/explore\/[^/]+$/.test(ctx.route.path) || /^\/learn\//.test(ctx.route.path) },
      },
      {
        id: "start", title: "Start learning", target: ["journey.next", "course.start"], action: "Click the main button", estimatedDuration: 8,
        route: { match: /^\/(explore\/[^/]+|learn\/.+)$/, go: () => "/skills", label: "Open Skills" },
        description: "The learning journey shows exactly what to do next. Start the course — your skill evidence updates as you complete lessons.",
        completion: { events: [], check: (ctx) => /^\/learn\//.test(ctx.route.path) },
      },
    ],
  },
  "understand-analytics": {
    title: "Understand Analytics",
    description: "Read the learning metrics, follow the course funnel, and find the factual signals behind course health.",
    type: "feature",
    roles: ["instructor", "admin"],
    estimatedMinutes: 3,
    outcome: "You can read the analytics, narrow them with filters and spot which course needs attention — and why.",
    contextRoutes: [/^\/analytics/],
    triggers: ["help-request", "new-feature"],
    nextActions: [
      { label: "Open a course in the Builder", icon: "layers", href: () => "/courses" },
      { label: "Back to analytics", icon: "chart", href: () => "/analytics" },
    ],
    steps: [
      {
        id: "open", title: "Open Analytics", target: "nav.analytics", action: "Click “Analytics”", estimatedDuration: 5,
        description: "Every number here is computed from what learners actually did — enrolments, completed lessons, quiz attempts, submissions and certificates.",
        completion: { events: [], check: (ctx) => /^\/analytics/.test(ctx.route.path) },
      },
      {
        id: "metrics", title: "Read the key metrics", target: "analytics.metrics", passive: true, action: "Take a look", estimatedDuration: 8,
        route: { match: /^\/analytics/, go: () => "/analytics", label: "Open Analytics" },
        description: "Completion rate, average progress, quiz pass rate and certificates for the courses you manage (or the whole organisation as an admin).",
        tip: "Active learners = anyone with learning activity in the selected period.",
        completion: { events: [], check: () => has("analytics.metrics") },
      },
      {
        id: "filter", title: "Narrow the period", target: "analytics.filters", action: "Change the date range", estimatedDuration: 8,
        route: { match: /^\/analytics/, go: () => "/analytics", label: "Open Analytics" },
        description: "Filters are applied by the server, so the metrics, the trend and the funnel all change together. Pick a different range.",
        completion: { events: ["analytics.filtered"] },
      },
      {
        id: "funnel", title: "Follow the funnel", target: "analytics.funnel", passive: true, action: "Read the stages", estimatedDuration: 8,
        route: { match: /^\/analytics/, go: () => "/analytics", label: "Open Analytics" },
        description: "Enrolled → Started → Progressing → Completed → Certified. Each stage shows the count and the share of enrolled learners; a big step down is where learners stall.",
        completion: { events: [], check: () => has("analytics.funnel") },
      },
      {
        id: "health", title: "Check course health", target: ["analytics.tab-health", "analytics.health"], action: "Open “Course health”", estimatedDuration: 10,
        route: { match: /^\/analytics/, go: () => "/analytics", label: "Open Analytics" },
        description: "Signals are factual: the metric that triggered them is shown next to each one (for example “Quiz pass rate: 42%”). Nothing here judges a course — it points at what to look into.",
        completion: { events: ["analytics.tab"], check: () => has("analytics.health") },
      },
    ],
  },
  "ai-course": {
    title: "Create a Course with AI",
    description: "Describe the course, let the AI propose an outline, review and edit it, then save it as a draft you own.",
    type: "feature",
    roles: ["instructor", "admin"],
    estimatedMinutes: 3,
    outcome: "You have an AI-drafted course saved as a draft, ready to refine and publish through the normal workflow.",
    contextRoutes: [/^\/builder\/ai/, /^\/courses/],
    triggers: ["help-request", "new-feature"],
    nextActions: [
      { label: "Keep editing in the Builder", icon: "layers", href: (ctx) => (ctx.course ? `/builder/${ctx.course.id}` : "/courses") },
      { label: "Generate quiz questions with AI", icon: "sparkles", href: (ctx) => (ctx.course ? `/builder/${ctx.course.id}` : "/courses") },
    ],
    steps: [
      {
        id: "open", title: "Open the AI course builder", target: ["courses.ai", "nav.courses"], action: "Click “Create with AI”", estimatedDuration: 6,
        description: "From My Courses, choose “Create with AI”. You describe the course; the AI proposes a structure.",
        tip: "AI output is always a draft — nothing is published until you publish it.",
        completion: { events: [], check: (ctx) => /^\/builder\/ai/.test(ctx.route.path) },
      },
      {
        id: "brief", title: "Describe the course", target: "ai.topic", action: "Type a topic and at least one objective", estimatedDuration: 30,
        route: { match: /^\/builder\/ai/, go: () => "/builder/ai", label: "Open the AI course builder" },
        description: "Give a topic, the audience and the learning objectives (one per line). Optional source material is used and cited; nothing else is cited.",
        completion: { events: ["ai.input"], check: (ctx, payload) => payload?.field === "topic" && String(payload.value || "").trim().length >= 3 },
      },
      {
        id: "generate", title: "Generate the outline", target: "ai.generate", action: "Click “Generate with AI”", estimatedDuration: 15,
        route: { match: /^\/builder\/ai/, go: () => "/builder/ai", label: "Open the AI course builder" },
        description: "The provider drafts modules, lessons, activities and quiz questions. Progress shows what it's working on.",
        completion: { events: ["ai.generated"] },
      },
      {
        id: "review", title: "Review and edit the outline", target: "ai.outline", passive: true, action: "Check titles, lesson types and remove what you don't want", estimatedDuration: 40,
        route: { match: /^\/builder\/ai/, go: () => "/builder/ai", label: "Open the AI course builder" },
        description: "Everything is editable: rename modules and lessons, change lesson types, remove lessons, or regenerate. The provenance card shows which provider, model and sources produced it.",
        completion: { events: [], check: () => has("ai.outline") },
      },
      {
        id: "save", title: "Save as a draft", target: "ai.save", action: "Click “Save as Draft”", estimatedDuration: 8,
        route: { match: /^\/builder\/ai/, go: () => "/builder/ai", label: "Open the AI course builder" },
        description: "The outline becomes an ordinary draft course in the Course Builder — same review and publish steps as any other course.",
        completion: { events: ["ai.course.applied"] },
      },
    ],
  },
  "ai-quiz": {
    title: "Generate a Quiz with AI",
    description: "Draft quiz questions for a lesson with AI, then edit, reorder and accept the ones you want.",
    type: "feature",
    roles: ["instructor", "admin"],
    estimatedMinutes: 2,
    outcome: "Reviewed AI-drafted questions are in your quiz lesson, still unpublished.",
    contextRoutes: [/^\/builder\/[^/]+$/],
    triggers: ["help-request", "new-feature"],
    nextActions: [
      { label: "Try the quiz as a learner", icon: "play", href: (ctx) => (ctx.course ? `/builder/${ctx.course.id}` : "/courses") },
      { label: "Back to My Courses", icon: "layers", href: () => "/courses" },
    ],
    steps: [
      {
        id: "open", title: "Open a quiz lesson's AI generator", target: ["quiz.ai", "course.add-lesson"], action: "In a quiz lesson, click “Generate with AI”", estimatedDuration: 10,
        route: builderRoute,
        description: "Select (or add) a quiz lesson in the Course Builder. The quiz editor has a “Generate with AI” button.",
        completion: { events: ["ai.quiz.opened"] },
      },
      {
        id: "generate", title: "Generate questions", target: "quiz.ai.generate", action: "Click “Generate questions”", estimatedDuration: 12,
        route: builderRoute,
        description: "Choose how many questions, the difficulty and the type (multiple choice, multi select, true/false, short answer or mixed).",
        completion: { events: ["ai.quiz.generated"] },
      },
      {
        id: "review", title: "Review, edit, reorder", target: "quiz.ai.review", passive: true, action: "Fix wording, delete weak questions, reorder", estimatedDuration: 30,
        route: builderRoute,
        description: "Each question shows its difficulty, objective and whether a source was cited. Edit any field, delete or move questions, or regenerate the set.",
        completion: { events: [], check: () => has("quiz.ai.review") },
      },
      {
        id: "accept", title: "Add the questions", target: "quiz.ai.accept", action: "Click “Add … to quiz”", estimatedDuration: 5,
        route: builderRoute,
        description: "Accepted questions join the lesson's quiz. The course stays in its current state — publishing is still your call.",
        completion: { events: ["ai.quiz.added"] },
      },
    ],
  },
  "meet-coach": {
    title: "Meet Your Learning Coach",
    description: "Ask the coach what to learn next, see why it's recommended, and go straight into the course.",
    type: "first-time",
    roles: ["learner"],
    estimatedMinutes: 3,
    outcome: "You asked your coach a question, saw a recommendation built from your own progress, and continued learning.",
    contextRoutes: [/^\/coach/, /^\/$/],
    triggers: ["first-login", "help-request", "new-feature"],
    nextActions: [
      { label: "See my recommendations on Home", icon: "home", href: () => "/" },
      { label: "Back to the coach", icon: "sparkles", href: () => "/coach" },
    ],
    steps: [
      {
        id: "open", title: "Open the Coach", target: "nav.coach", action: "Click “Coach”", estimatedDuration: 5,
        description: "Your Learning Coach only uses your own record — enrolments, progress, skills, journeys, certificates — never anyone else's.",
        completion: { events: [], check: (ctx) => /^\/coach/.test(ctx.route.path) },
      },
      {
        id: "ask", title: "Ask a question", target: "coach.input", action: "Ask e.g. “What should I learn next?”", estimatedDuration: 15,
        route: { match: /^\/coach/, go: () => "/coach", label: "Open the Coach" },
        description: "Type a question or pick a suggested one. The reply is grounded in your data and links to real courses and lessons.",
        tip: "If the AI provider is unavailable, your recommendations still work.",
        completion: { events: ["coach.replied"] },
      },
      {
        id: "recommendation", title: "See your recommendation", target: "coach.recommendation", passive: true, action: "Read your next step and why", estimatedDuration: 10,
        route: { match: /^\/coach/, go: () => "/coach", label: "Open the Coach" },
        description: "“Your next step” is chosen deterministically from your progress, due dates, skill gaps and journeys — the reason cites your actual numbers.",
        completion: { events: [], check: () => has("coach.recommendation") },
      },
      {
        id: "open-course", title: "Open the recommended course", target: ["rec.cta", "coach.recommendation"], action: "Click the recommendation's button", estimatedDuration: 6,
        route: { match: /^\/(coach|explore\/[^/]+|learn\/.+)$/, go: () => "/coach", label: "Open the Coach" },
        description: "The button takes you to the exact lesson or course the recommendation refers to.",
        completion: { events: [], check: (ctx) => /^\/(learn\/|explore\/)/.test(ctx.route.path) },
      },
      {
        id: "continue", title: "Continue learning", target: ["player.complete", "course.start"], action: "Complete a lesson or start the course", estimatedDuration: 30,
        route: { match: /^\/(learn\/|explore\/)/, go: () => "/", label: "Go home" },
        description: "Your progress, skills and recommendations update as soon as you complete the lesson.",
        completion: { events: ["lesson.completed"] },
      },
    ],
  },
  "understand-recommendations": {
    title: "Understand Your Recommendations",
    description: "See how “Your next step” and the recommendation cards are chosen, and shape them with feedback.",
    type: "feature",
    roles: ["learner"],
    estimatedMinutes: 2,
    outcome: "You know why each recommendation appears and how to tell the system what's relevant.",
    contextRoutes: [/^\/$/],
    triggers: ["help-request", "new-feature"],
    nextActions: [
      { label: "Ask the coach", icon: "sparkles", href: () => "/coach" },
      { label: "See my skills", icon: "target", href: () => "/skills" },
    ],
    steps: [
      {
        id: "home", title: "Go to Home", target: "nav.home", action: "Click “Home”", estimatedDuration: 5,
        description: "Home leads with one primary next step, then up to five recommendations.",
        completion: { events: [], check: (ctx) => ctx.route.path === "/" },
      },
      {
        id: "next", title: "Read your next step", target: "home.next-step", passive: true, action: "Read the title and “Why”", estimatedDuration: 8,
        route: { match: /^\/$/, go: () => "/", label: "Go home" },
        description: "Ranking is deterministic: active courses first, then journey steps, due dates, skill gaps, assessment weaknesses, recent activity and your feedback. No hidden score.",
        completion: { events: [], check: () => has("home.next-step") },
      },
      {
        id: "why", title: "Check the reason", target: "rec.reason", passive: true, action: "Read the “Why” line", estimatedDuration: 6,
        route: { match: /^\/$/, go: () => "/", label: "Go home" },
        description: "Every reason is built from your real numbers — lessons completed, percentages, due dates, skill levels — never generic advice.",
        completion: { events: [], check: () => has("rec.reason") },
      },
      {
        id: "feedback", title: "Give feedback", target: "rec.feedback", action: "Mark a card Helpful, Not relevant or Dismiss", estimatedDuration: 8,
        route: { match: /^\/$/, go: () => "/", label: "Go home" },
        description: "Helpful moves similar suggestions up; Not relevant or Dismiss hides that target for two weeks. Nothing is sent to an external model.",
        completion: { events: ["rec.feedback"] },
      },
      {
        id: "open", title: "Open a recommendation", target: ["rec.cta", "home.next-step"], action: "Click a recommendation's button", estimatedDuration: 5,
        route: { match: /^\/(|explore\/[^/]+|learn\/.+)$/, go: () => "/", label: "Go home" },
        description: "You land on the exact lesson or course — the app performs the action, the recommendation only pointed the way.",
        completion: { events: [], check: (ctx) => /^\/(learn\/|explore\/|certificates|skills|journeys)/.test(ctx.route.path) },
      },
    ],
  },
  "understand-progress": {
    title: "Understand My Progress",
    description: "See what you've accomplished, what you're learning now, and the one thing to do next.",
    type: "feature",
    roles: ["learner"],
    estimatedMinutes: 2,
    outcome: "You know where you stand and have started your next step.",
    contextRoutes: [/^\/progress/],
    triggers: ["help-request", "new-feature"],
    nextActions: [
      { label: "See my skills", icon: "target", href: () => "/skills" },
      { label: "Back to my progress", icon: "chart", href: () => "/progress" },
    ],
    steps: [
      {
        id: "open", title: "Open My Progress", target: "nav.progress", action: "Click “My Progress”", estimatedDuration: 5,
        description: "Your progress page is built from your own learning record on the server: lessons, quizzes, assignments, certificates and skills.",
        completion: { events: [], check: (ctx) => /^\/progress/.test(ctx.route.path) },
      },
      {
        id: "accomplished", title: "What have I accomplished?", target: "progress.overview", passive: true, action: "Take a look", estimatedDuration: 6,
        route: { match: /^\/progress/, go: () => "/progress", label: "Open My Progress" },
        description: "Your streak, lessons completed, minutes learned, finished courses and certificates.",
        tip: "The streak counts consecutive days with any learning activity.",
        completion: { events: [], check: () => has("progress.overview") },
      },
      {
        id: "learning", title: "What am I learning now?", target: "progress.courses", passive: true, action: "Review your courses", estimatedDuration: 6,
        route: { match: /^\/progress/, go: () => "/progress", label: "Open My Progress" },
        description: "Courses in progress with how far you've got, and the skills that moved in the last two weeks.",
        completion: { events: [], check: () => has("progress.courses") },
      },
      {
        id: "next", title: "What should I do next?", target: "progress.next", action: "Click the next action", estimatedDuration: 8,
        route: { match: /^\/progress/, go: () => "/progress", label: "Open My Progress" },
        description: "The next action is chosen deterministically: the soonest due course, else the course you were last active in, else something you enrolled in but haven't started.",
        completion: { events: [], check: (ctx) => /^\/(learn|explore)/.test(ctx.route.path) },
      },
    ],
  },
};

export const guides = Object.fromEntries(
  Object.entries(raw).map(([id, g]) => [id, {
    id, ...g,
    steps: g.steps.map((s, i, arr) => ({ ...s, guideId: id, order: i + 1, nextStep: arr[i + 1]?.id || null })),
  }])
);

export const guidesForRole = (role) => Object.values(guides).filter((g) => g.roles.includes(role));
export const contextGuide = (path, role) => guidesForRole(role).find((g) => g.contextRoutes.some((r) => r.test(path))) || guidesForRole(role)[0] || null;
