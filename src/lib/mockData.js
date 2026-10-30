// Realistic seed data for the local/mock backend. Everything is generated once, then persisted by store.js.
const DAY = 86400000;

let _n = 0;
const id = (p) => `${p}-${(++_n).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- content helpers ----
const text = (t) => ({ id: id("b"), type: "text", text: t });
const heading = (t) => ({ id: id("b"), type: "heading", text: t });
const callout = (t, tone = "info") => ({ id: id("b"), type: "callout", tone, text: t });
const quote = (t, by) => ({ id: id("b"), type: "quote", text: t, by });
const checklist = (...items) => ({ id: id("b"), type: "checklist", items: items.map((t) => ({ id: id("i"), text: t })) });
const accordion = (...items) => ({ id: id("b"), type: "accordion", items: items.map(([title, body]) => ({ id: id("i"), title, body })) });
const video = (caption, url = "") => ({ id: id("b"), type: "video", url, caption });
const link = (label, url) => ({ id: id("b"), type: "link", label, url });
const check = (q) => ({ id: id("b"), type: "knowledge", question: q });

let _q = 0;
const qid = () => `q${++_q}`;
const opts = (arr) => arr.map((t, i) => ({ id: "o" + i, text: t }));
const mc = (prompt, options, correct, explanation) => ({ id: qid(), type: "mc", prompt, options: opts(options), answer: "o" + correct, explanation });
const multi = (prompt, options, correct, explanation) => ({ id: qid(), type: "multi", prompt, options: opts(options), answer: correct.map((i) => "o" + i), explanation });
const tf = (prompt, answer, explanation) => ({ id: qid(), type: "tf", prompt, answer, explanation });
const short = (prompt, accepted, explanation) => ({ id: qid(), type: "short", prompt, answer: accepted, explanation });

const lesson = (title, type, duration, blocks = [], extra = {}) => ({ id: id("l"), title, type, duration, blocks, ...extra });
const quizLesson = (title, questions, passScore = 70, blocks = []) => lesson(title, "quiz", questions.length * 2, blocks, { quiz: { passScore, questions } });
const assignLesson = (title, brief, rubric, duration = 20) => lesson(title, "assignment", duration, [], { assignment: { brief, rubric } });
const mod = (title, lessons) => ({ id: id("m"), title, lessons });

function buildCourses(now) {
  const sales = {
    id: "c-sales", title: "Sales Foundations", category: "Sales", level: "Beginner", status: "published", instructorId: "u-daniel",
    description: "Master the modern sales conversation — from discovery questions to a first outreach message that actually gets replies.",
    cover: { hue: 250, icon: "target" }, skills: [{ skillId: "prospecting", points: 45 }, { skillId: "comms", points: 25 }],
    updatedAt: now - 20 * DAY, createdAt: now - 90 * DAY, sequential: true, certExpiryMonths: 0,
    modules: [
      mod("The modern sales conversation", [
        lesson("Why buyers buy", "video", 6, [
          text("Buyers rarely buy a product. They buy a **better version of their own situation**. This lesson shows how to spot the change your buyer is really after."),
          video("Why buyers buy — 6 minute walkthrough"),
          callout("Tip: before every call, write down the one outcome the buyer is hoping to reach.", "tip"),
        ]),
        lesson("Discovery questions that work", "reading", 8, [
          heading("Ask about the problem, not the product"),
          text("Great discovery feels like a conversation. Use open questions that start with *what*, *how* and *tell me about*.\n\n- What prompted you to look at this now?\n- How are you handling it today?\n- What happens if nothing changes?"),
          quote("The quality of your questions determines the quality of your deal.", "Sales enablement proverb"),
          checklist("Prepare 3 open questions", "Listen for a trigger event", "Confirm the impact in numbers"),
          check(mc("Which is the strongest discovery question?", ["Do you need a CRM?", "What prompted you to look at this now?", "Can I send you pricing?"], 1, "Open questions reveal the trigger and urgency behind a purchase.")),
        ]),
        quizLesson("Check your understanding", [
          mc("What is the main goal of discovery?", ["Present the product", "Understand the buyer's situation and impact", "Get a signature", "Handle objections"], 1, "Discovery is about learning the situation and the impact of the problem."),
          multi("Which are open questions? (select all)", ["What prompted this?", "Do you have budget?", "How are you solving it today?", "Is Friday OK?"], [0, 2], "Open questions can't be answered with yes/no."),
          tf("You should pitch features before you understand the problem.", false, "Understand first; pitch second."),
          short("Name one trigger event that makes a buyer act.", ["new role", "new manager", "funding", "deadline", "audit", "growth", "merger", "reorg", "budget", "acquisition", "restructure"], "Trigger events include a new role, funding, a deadline, growth, or an audit."),
        ]),
      ]),
      mod("Prospecting with purpose", [
        lesson("Build an ideal customer profile", "lesson", 10, [
          text("An **Ideal Customer Profile (ICP)** describes the accounts where you win most often and keep customers longest."),
          accordion(["Firmographics", "Industry, size, geography and growth stage."], ["Situation", "The trigger events and pains that create urgency."], ["Buying group", "Who champions, decides and signs?"]),
        ]),
        assignLesson("Write your first outreach message", "Write a 4–5 sentence outreach message to a prospect that fits your ICP. Lead with their situation, not your product, and end with one clear question.", ["Opens with the prospect's situation", "One clear call to action", "Under 100 words"]),
        lesson("Discuss: your best opener", "discussion", 10, [text("Share the opening line that has worked best for you and why you think it landed. Reply to two teammates with one improvement idea.")]),
      ]),
    ],
  };

  const crm = {
    id: "c-crm", title: "CRM Mastery", category: "Sales", level: "Intermediate", status: "published", instructorId: "u-daniel",
    description: "Turn your CRM into a reliable pipeline engine: clean data, honest stages, accurate forecasts and automated follow-ups.",
    cover: { hue: 205, icon: "layers" }, skills: [{ skillId: "crm", points: 60 }, { skillId: "data", points: 10 }],
    updatedAt: now - 8 * DAY, createdAt: now - 70 * DAY, sequential: true, certExpiryMonths: 0,
    modules: [
      mod("CRM basics", [
        lesson("Pipeline stages explained", "lesson", 9, [heading("Stages describe buyer progress, not seller activity"), text("Each stage should have an **exit criterion** the buyer has demonstrated — a meeting held, a stakeholder confirmed, a proposal reviewed."), callout("If you can't prove a stage exit, the deal hasn't left the stage.", "warning")]),
        lesson("Clean data habits", "reading", 7, [text("Clean data compounds. Adopt three habits:\n\n- Log every meeting within 24 hours\n- One owner per account\n- Next step + date on every open deal"), checklist("Every deal has a next step", "Close dates are realistic", "Contacts have roles")]),
        quizLesson("Pipeline quick quiz", [
          mc("What should define a pipeline stage?", ["Seller activity", "Buyer-verified progress", "Manager preference"], 1, "Buyer-verified exit criteria keep stages honest."),
          tf("Every open deal should have a next step with a date.", true, "Deals without a dated next step tend to stall."),
          short("What is the single most important CRM field for forecasting? (one or two words)", ["close date", "amount", "stage", "next step"], "Close date, amount and stage drive forecasts."),
        ]),
      ]),
      mod("Working the pipeline", [
        lesson("Forecasting with confidence", "video", 12, [video("Forecast categories and how to defend them"), text("Split your forecast into **commit**, **best case** and **pipeline** — and review the gaps weekly.")]),
        lesson("Automating follow-ups", "lesson", 10, [text("Use CRM tasks and sequences to make follow-up the default."), accordion(["Task rules", "Create a task 2 days after every meeting."], ["Sequences", "Use 3–4 touch sequences for stalled deals."])]),
        assignLesson("Pipeline review assignment", "Pick five open deals. For each, write the buyer-verified stage evidence and the next step with date. Highlight the deal most at risk.", ["Evidence for every stage", "Dated next steps", "Clear risk call-out"], 30),
      ]),
    ],
  };

  const nego = {
    id: "c-nego", title: "Negotiation Essentials", category: "Sales", level: "Intermediate", status: "published", instructorId: "u-daniel",
    description: "Prepare, anchor and trade concessions with confidence. Practice on realistic scenarios and leave every deal better than you found it.",
    cover: { hue: 18, icon: "zap" }, skills: [{ skillId: "negotiation", points: 55 }, { skillId: "comms", points: 15 }],
    updatedAt: now - 12 * DAY, createdAt: now - 60 * DAY, sequential: true, certExpiryMonths: 0,
    modules: [
      mod("Prepare", [
        lesson("Know your BATNA", "lesson", 8, [text("Your **BATNA** — Best Alternative To a Negotiated Agreement — is your source of leverage. Know yours, and estimate theirs."), callout("Never negotiate without knowing your walk-away point.", "warning")]),
        lesson("Set goals and limits", "reading", 6, [text("Define three numbers before you start: your **target**, your **acceptable**, and your **walk-away**.")]),
        quizLesson("Preparation check", [
          mc("What does BATNA stand for?", ["Best Alternative To a Negotiated Agreement", "Basic Agreement To Negotiate Actively", "Buyer And Negotiator Tactic Approach"], 0, "BATNA = Best Alternative To a Negotiated Agreement."),
          tf("You should reveal your walk-away point early to build trust.", false, "Your walk-away point is private leverage."),
        ]),
      ]),
      mod("Negotiate", [
        lesson("Anchoring and concessions", "video", 11, [video("Anchoring, trading and concession patterns"), text("Make the first credible offer when you have good information, and **never concede without getting something back**.")]),
        lesson("Handling pushback", "lesson", 9, [accordion(["\"Your price is too high\"", "Explore value first: *compared to what?* Then trade scope or terms rather than price."], ["\"We need a discount to sign this quarter\"", "Ask what the discount unlocks. Offer a concession tied to commitment."])]),
        assignLesson("Negotiation role-play", "Record or write a 5-turn dialogue where a buyer asks for a 15% discount. Show how you explore value and trade a concession.", ["Explores value before conceding", "Trades, doesn't give", "Keeps a collaborative tone"], 25),
      ]),
    ],
  };

  const lead = {
    id: "c-lead", title: "Leading High-Performing Teams", category: "Leadership", level: "Advanced", status: "published", instructorId: "u-daniel",
    description: "Coach, delegate and build trust. A practical toolkit for first-time and growing managers.",
    cover: { hue: 330, icon: "users" }, skills: [{ skillId: "leadership", points: 50 }, { skillId: "comms", points: 20 }],
    updatedAt: now - 30 * DAY, createdAt: now - 120 * DAY, sequential: true, certExpiryMonths: 0,
    modules: [
      mod("Lead yourself", [
        lesson("Your leadership operating manual", "lesson", 8, [text("Write down how you like to work, how you give feedback, and what you need from your team.")]),
        lesson("Managing your energy", "reading", 6, [text("Leaders set the emotional climate. Track your energy across the week and protect your best hours.")]),
      ]),
      mod("Lead others", [
        lesson("Delegation that develops people", "video", 10, [video("The delegation ladder")]),
        lesson("Coaching conversations", "lesson", 12, [text("Use the **GROW** model: Goal, Reality, Options, Way forward."), check(mc("What does the R in GROW stand for?", ["Result", "Reality", "Review"], 1, "Reality: where are we now?"))]),
        quizLesson("Leadership check", [
          mc("Best first step in a coaching conversation?", ["Give advice", "Clarify the goal", "Assign tasks"], 1, "Start with the person's goal."),
          tf("Delegating means giving up accountability.", false, "You stay accountable; you transfer the work."),
        ]),
      ]),
    ],
  };

  const sec = {
    id: "c-sec", title: "Security Awareness 2026", category: "Compliance", level: "Beginner", status: "published", instructorId: "u-daniel",
    description: "Annual compliance training: spot phishing, handle data safely and know exactly what to do when something looks wrong.",
    cover: { hue: 160, icon: "shield" }, skills: [{ skillId: "security", points: 60 }],
    updatedAt: now - 15 * DAY, createdAt: now - 200 * DAY, sequential: true, certExpiryMonths: 12, compliance: true,
    modules: [
      mod("Spot the threat", [
        lesson("Phishing in the wild", "lesson", 8, [text("Phishing works because it borrows **urgency** and **authority**. Slow down, verify the sender, hover before you click."), checklist("Check sender address", "Hover over links", "Never share codes")]),
        lesson("Report it fast", "reading", 5, [text("Use the **Report phishing** button. Speed matters more than certainty.")]),
        quizLesson("Phishing quiz", [
          mc("An urgent email from the CEO asks for gift cards. You…", ["Buy them", "Report it as phishing", "Reply asking why"], 1, "Urgency + authority + unusual request = report it."),
          multi("Which are warning signs? (select all)", ["Generic greeting", "Mismatched link", "Known sender, expected content", "Unusual urgency"], [0, 1, 3], "Generic greetings, mismatched links and urgency are classic signs."),
        ], 80),
      ]),
      mod("Handle data safely", [
        lesson("Classifying company data", "lesson", 7, [accordion(["Public", "Safe to share."], ["Internal", "Company only."], ["Confidential", "Need-to-know, encrypted."])]),
        lesson("Working remotely, securely", "reading", 6, [text("Use the company VPN, lock your screen, and keep personal devices patched.")]),
      ]),
    ],
  };

  const data = {
    id: "c-data", title: "Data Storytelling for Teams", category: "Analytics", level: "Beginner", status: "published", instructorId: "u-daniel",
    description: "Turn numbers into decisions. Learn to pick the right chart and tell a clear story with your team's data.",
    cover: { hue: 285, icon: "chart" }, skills: [{ skillId: "data", points: 45 }, { skillId: "comms", points: 20 }],
    updatedAt: now - 25 * DAY, createdAt: now - 80 * DAY, sequential: false, certExpiryMonths: 0,
    modules: [
      mod("See the story", [
        lesson("Start with the question", "lesson", 7, [text("Every good chart answers one question. Write the question first.")]),
        lesson("Choosing the right chart", "reading", 9, [text("Trends → line. Comparisons → bar. Parts of a whole → stacked bar (not pie).")]),
      ]),
      mod("Tell the story", [
        lesson("Headline, evidence, action", "lesson", 8, [text("Lead with the headline. Show the evidence. End with the action you want.")]),
        quizLesson("Storytelling check", [tf("A pie chart is always the best way to show trends.", false, "Use line charts for trends.")]),
      ]),
    ],
  };

  const onboard = {
    id: "c-onboard", title: "New Hire Onboarding", category: "Onboarding", level: "Beginner", status: "published", instructorId: "u-daniel",
    description: "Everything a new employee needs in their first 30 days — culture, tools and who to ask.",
    cover: { hue: 38, icon: "rocket" }, skills: [{ skillId: "comms", points: 10 }],
    updatedAt: now - 40 * DAY, createdAt: now - 150 * DAY, sequential: false, certExpiryMonths: 0,
    modules: [
      mod("Welcome & culture", [
        lesson("Welcome from our CEO", "video", 4, [video("A welcome from our CEO")]),
        lesson("Company values in practice", "reading", 6, [text("Our values are more than posters. Here's how they show up in daily decisions.")]),
      ]),
      mod("Tools & systems", [
        lesson("Setting up your accounts", "lesson", 10, [checklist("Set up SSO", "Join Slack channels", "Install the VPN")]),
        lesson("Who to ask for what", "reading", 5, [text("Your buddy, your manager and the help desk — and when to use each.")]),
      ]),
    ],
  };

  const cs = {
    id: "c-cs", title: "Customer Success Playbook", category: "Customer Success", level: "Intermediate", status: "draft", instructorId: "u-daniel",
    description: "A draft playbook for onboarding and expanding customer accounts.",
    cover: { hue: 178, icon: "message" }, skills: [{ skillId: "comms", points: 30 }],
    updatedAt: now - 2 * DAY, createdAt: now - 6 * DAY, sequential: true, certExpiryMonths: 0,
    modules: [mod("Onboarding customers", [lesson("The first 30 days", "lesson", 8, [text("Outline the kickoff, milestones and success plan.")]), lesson("Success plans", "lesson", 8, [])])],
  };

  return [sales, crm, nego, lead, sec, data, onboard, cs];
}

export function makeSeed() {
  const now = Date.now();
  const R = rng(7);
  const courses = buildCourses(now);
  const byId = Object.fromEntries(courses.map((c) => [c.id, c]));
  const lessonsOf = (c) => c.modules.flatMap((m) => m.lessons);

  const skills = [
    { id: "prospecting", name: "Prospecting", category: "Sales", description: "Finding and engaging the right accounts." },
    { id: "crm", name: "CRM", category: "Sales", description: "Running a clean, honest pipeline." },
    { id: "negotiation", name: "Negotiation", category: "Sales", description: "Preparing, anchoring and trading concessions." },
    { id: "comms", name: "Communication", category: "Core", description: "Clear, persuasive written and spoken communication." },
    { id: "leadership", name: "Leadership", category: "Leadership", description: "Coaching, delegating and building trust." },
    { id: "data", name: "Data Literacy", category: "Analytics", description: "Reading, choosing and presenting data." },
    { id: "security", name: "Security Awareness", category: "Compliance", description: "Protecting people, data and systems." },
  ];

  const mk = (id, name, role, title, dept, hue, extra = {}) => ({
    id, name, role, title, dept, hue, email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@acme.example",
    joinedAt: now - Math.round(60 + R() * 600) * DAY, streak: Math.round(R() * 9), ...extra,
  });
  const users = [
    mk("u-maya", "Maya Chen", "learner", "Account Executive", "Sales", 250, {
      streak: 5, managerId: "u-omar", joinedAt: now - 180 * DAY,
      base: { prospecting: 20, crm: 50, negotiation: 40, comms: 45, leadership: 30, data: 15, security: 25 },
      targets: { prospecting: 75, crm: 90, negotiation: 80, comms: 80, leadership: 70, data: 50, security: 80 },
    }),
    mk("u-daniel", "Daniel Ortiz", "instructor", "Learning Lead", "Enablement", 20),
    mk("u-priya", "Priya Nair", "admin", "L&D Administrator", "People", 165),
    mk("u-sam", "Sam Rivera", "learner", "Sales Development Rep", "Sales", 210, { managerId: "u-omar" }),
    mk("u-lena", "Lena Fischer", "learner", "Support Specialist", "Support", 330),
    mk("u-omar", "Omar Haddad", "learner", "Sales Manager", "Sales", 40),
    mk("u-aisha", "Aisha Bello", "learner", "Marketing Manager", "Marketing", 290),
    mk("u-tom", "Tom Becker", "learner", "Software Engineer", "Engineering", 185),
    mk("u-grace", "Grace Kim", "learner", "Customer Success Manager", "Customer Success", 145, { managerId: "u-omar" }),
    mk("u-luis", "Luis Romero", "learner", "Account Executive", "Sales", 5, { managerId: "u-omar" }),
    mk("u-nina", "Nina Petrova", "learner", "Financial Analyst", "Finance", 270),
    mk("u-ben", "Ben Carter", "learner", "Support Specialist", "Support", 100),
  ];
  users.forEach((u) => {
    u.base ||= Object.fromEntries(skills.map((s) => [s.id, Math.round(10 + R() * 40)]));
    u.targets ||= Object.fromEntries(skills.map((s) => [s.id, 60 + Math.round(R() * 30)]));
  });

  // ---- enrollments ----
  const enrollments = [];
  const enroll = (userId, courseId, done, extra = {}) => {
    const c = byId[courseId];
    const ls = lessonsOf(c);
    const completed = ls.slice(0, Math.min(done, ls.length)).map((l) => l.id);
    const quiz = {};
    ls.slice(0, done).filter((l) => l.type === "quiz").forEach((l) => (quiz[l.id] = { score: 75 + Math.round(R() * 23), passed: true, attempts: 1, at: now - Math.round(R() * 20) * DAY }));
    const submissions = {};
    ls.slice(0, done).filter((l) => l.type === "assignment").forEach((l) => {
      const reviewed = R() > 0.55;
      submissions[l.id] = { text: "Submitted for review.", at: now - Math.round(R() * 6) * DAY, status: reviewed ? "reviewed" : "submitted", feedback: reviewed ? "Nice work — clear and specific." : "" };
    });
    enrollments.push({
      id: id("e"), userId, courseId, completed, quiz, submissions, notes: {}, bookmarks: [],
      startedAt: now - Math.round(5 + R() * 60) * DAY, lastLessonId: completed[completed.length - 1] || null,
      completedAt: completed.length === ls.length && ls.length ? now - Math.round(2 + R() * 30) * DAY : null,
      lastActiveAt: now - Math.round(R() * 9) * DAY, dueAt: null, ...extra,
    });
  };
  const salesN = lessonsOf(byId["c-sales"]).length;
  enroll("u-maya", "c-sales", salesN, { completedAt: now - 20 * DAY, startedAt: now - 60 * DAY, lastActiveAt: now - 20 * DAY });
  enroll("u-maya", "c-crm", 3, { startedAt: now - 14 * DAY, lastActiveAt: now - 1 * DAY });
  enroll("u-maya", "c-nego", 1, { startedAt: now - 4 * DAY, lastActiveAt: now - 2 * DAY });
  enroll("u-maya", "c-sec", 0, { startedAt: now - 3 * DAY, dueAt: now + 6 * DAY, lastActiveAt: null });

  const plan = {
    "u-sam": [["c-sales", 6], ["c-sec", 5], ["c-crm", 2]],
    "u-lena": [["c-sec", 5], ["c-onboard", 4], ["c-data", 1]],
    "u-omar": [["c-sales", 6], ["c-crm", 6], ["c-lead", 3], ["c-nego", 2]],
    "u-aisha": [["c-data", 5], ["c-sec", 5], ["c-onboard", 4]],
    "u-tom": [["c-sec", 5], ["c-data", 2], ["c-onboard", 4]],
    "u-grace": [["c-crm", 6], ["c-sec", 3], ["c-cs", 0]],
    "u-luis": [["c-sales", 3], ["c-onboard", 4], ["c-sec", 0]],
    "u-nina": [["c-data", 4], ["c-sec", 5]],
    "u-ben": [["c-onboard", 2], ["c-sec", 1], ["c-nego", 0]],
  };
  Object.entries(plan).forEach(([uid, list]) => list.forEach(([cid, n]) => {
    if (cid === "c-cs") return;
    enroll(uid, cid, n, cid === "c-sec" && n < 5 ? { dueAt: now + Math.round(R() * 14 - 5) * DAY } : {});
  }));

  // ---- certificates ----
  const cert = (userId, courseId, issuedDaysAgo, code) => {
    const c = byId[courseId];
    const issuedAt = now - issuedDaysAgo * DAY;
    return {
      id: code, userId, courseId, issuedAt,
      expiresAt: c.certExpiryMonths ? issuedAt + c.certExpiryMonths * 30.4 * DAY : null, revoked: false,
    };
  };
  const certificates = [
    cert("u-maya", "c-sales", 20, "WE360-2026-MAYA01"),
    cert("u-sam", "c-sales", 33, "WE360-2026-SAM044"),
    cert("u-omar", "c-sales", 70, "WE360-2026-OMAR12"),
    cert("u-omar", "c-crm", 40, "WE360-2026-OMAR27"),
    cert("u-grace", "c-crm", 25, "WE360-2026-GRACE9"),
    cert("u-sam", "c-sec", 350, "WE360-2025-SAMSEC"),
    cert("u-lena", "c-sec", 400, "WE360-2025-LENSEC"),
    cert("u-tom", "c-sec", 60, "WE360-2026-TOMSEC"),
    cert("u-aisha", "c-data", 12, "WE360-2026-AISHA3"),
  ];

  // ---- journeys ----
  const journeys = [
    {
      id: "j-sales", title: "Sales Leader Path", description: "From solid foundations to a leadership-ready sales professional.",
      nodes: [
        { id: "n1", type: "course", courseId: "c-sales", requires: [] },
        { id: "n2", type: "course", courseId: "c-crm", requires: ["n1"] },
        { id: "n3", type: "course", courseId: "c-nego", requires: ["n2"] },
        { id: "n4", type: "course", courseId: "c-lead", requires: ["n2"] },
        { id: "n5", type: "milestone", title: "Sales Skill Mastery", description: "Awarded when you complete both Negotiation and Leadership.", requires: ["n3", "n4"] },
      ],
    },
    {
      id: "j-team", title: "Data-Ready Team Member", description: "The essentials every team member needs to work safely with data.",
      nodes: [
        { id: "n1", type: "course", courseId: "c-onboard", requires: [] },
        { id: "n2", type: "course", courseId: "c-sec", requires: ["n1"] },
        { id: "n3", type: "course", courseId: "c-data", requires: ["n1"] },
        { id: "n4", type: "milestone", title: "Data-Ready", description: "Security and data storytelling complete.", requires: ["n2", "n3"] },
      ],
    },
  ];

  // ---- community ----
  const groups = [
    { id: "g-sales", name: "Sales Guild", description: "Tactics, war stories and wins from the sales floor.", hue: 250, members: ["u-maya", "u-sam", "u-omar", "u-luis", "u-daniel"] },
    { id: "g-cs", name: "Customer Success", description: "Retention, expansion and customer love.", hue: 165, members: ["u-grace", "u-ben", "u-lena"] },
    { id: "g-new", name: "New Hires", description: "Questions welcome. There are no dumb ones here.", hue: 38, members: ["u-luis", "u-ben", "u-maya", "u-tom"] },
    { id: "g-lead", name: "Leadership Circle", description: "For current and aspiring people managers.", hue: 330, members: ["u-omar", "u-aisha", "u-daniel"] },
  ];
  const crmL = lessonsOf(byId["c-crm"]);
  const salesL = lessonsOf(byId["c-sales"]);
  const negoL = lessonsOf(byId["c-nego"]);
  const cm = (authorId, body, ago, parentId = null, likes = []) => ({ id: id("cm"), authorId, body, at: now - ago * 3600000, parentId, likes });
  const post = (authorId, kind, title, body, ago, groupId, extra = {}) => ({
    id: id("p"), authorId, kind, title, body, at: now - ago * 3600000, groupId, courseId: null, lessonId: null, pinned: false,
    reactions: { like: [], insight: [], celebrate: [] }, comments: [], ...extra,
  });
  const p1 = post("u-daniel", "discussion", "Welcome to the WorkEasy360 community 👋", "This is the place to ask questions, share what's working and help each other grow. Introduce yourself below and tell us one skill you want to build this quarter.", 240, "g-new", { pinned: true });
  p1.reactions.like = ["u-maya", "u-sam", "u-luis", "u-ben"]; p1.reactions.celebrate = ["u-tom"];
  p1.comments = [cm("u-luis", "Hi all! Luis from Sales — I want to level up my negotiation skills.", 200), cm("u-maya", "Welcome Luis! Negotiation Essentials is great — the BATNA lesson changed how I prepare.", 190)];
  p1.comments[1].parentId = p1.comments[0].id;
  const p2 = post("u-sam", "question", "How do you handle 'send me pricing' on the first call?", "I keep getting asked for pricing before I've done discovery. What's your go-to response without sounding evasive?", 30, "g-sales");
  p2.comments = [cm("u-omar", "I say: 'Happy to — so I send the right thing, can I ask two quick questions about what you're trying to solve?' Works 8/10 times.", 26, null, ["u-sam", "u-maya"]), cm("u-daniel", "Expert tip: anchor on value first, then share a range. The Discovery lesson in Sales Foundations covers this.", 20)];
  p2.reactions.like = ["u-maya", "u-luis"]; p2.reactions.insight = ["u-omar"];
  const p3 = post("u-maya", "discussion", "Pipeline hygiene: what's your Friday ritual?", "I block 30 minutes every Friday to update next steps and close dates. Curious what other people do.", 52, "g-sales", { courseId: "c-crm", lessonId: crmL[1].id });
  p3.comments = [cm("u-omar", "Same — plus I sort by 'no next step' first.", 48), cm("u-grace", "We use a weekly automated report of deals with no activity in 7 days.", 40)];
  p3.reactions.like = ["u-omar", "u-grace", "u-sam"];
  const p4 = post("u-luis", "question", "What's a reasonable first concession?", "In the role-play I gave away too much too early. Is there a rule of thumb?", 70, "g-sales", { courseId: "c-nego", lessonId: negoL[3].id });
  p4.comments = [cm("u-daniel", "Never concede without a trade. Ask 'if I do X, can you commit to Y?' Start small and slow down each concession.", 60)];
  const p5 = post("u-grace", "post", "Shipped: our new customer onboarding checklist 🎉", "After 3 weeks of iteration we cut time-to-value from 21 to 14 days. Happy to share the template.", 100, "g-cs");
  p5.reactions.celebrate = ["u-ben", "u-lena", "u-daniel"]; p5.reactions.like = ["u-omar"];
  const p6 = post("u-omar", "discussion", "Discovery: the best question you've ever asked?", "Mine: 'What happens if nothing changes in the next 6 months?' Share yours.", 150, "g-sales", { courseId: "c-sales", lessonId: salesL[1].id, pinned: true });
  p6.comments = [cm("u-maya", "'What made you take this meeting today?' — it surfaces the trigger event immediately.", 140, null, ["u-omar"]), cm("u-sam", "'Who else feels this pain?' opens the buying group.", 120)];
  p6.reactions.insight = ["u-maya", "u-sam", "u-luis"];
  const p7 = post("u-tom", "question", "Is it OK to use personal devices for work email?", "Security Awareness mentions the company VPN but not personal phones. What's the policy?", 200, "g-new");
  const p8 = post("u-aisha", "discussion", "Reading list: books for first-time managers", "Sharing my top 5. Add yours!", 300, "g-lead");
  p8.comments = [cm("u-omar", "'The Making of a Manager' by Julie Zhuo is still my #1.", 280)];
  const posts = [p1, p2, p3, p4, p5, p6, p7, p8];

  const notifications = [
    { id: id("n"), userId: "u-maya", kind: "due", title: "Security Awareness 2026 is due in 6 days", body: "About 26 minutes to complete.", href: "/learn/c-sec", at: now - 3 * 3600000, read: false },
    { id: id("n"), userId: "u-maya", kind: "reply", title: "Omar replied to your discussion", body: "\"Same — plus I sort by 'no next step' first.\"", href: "/community", at: now - 48 * 3600000, read: false },
    { id: id("n"), userId: "u-maya", kind: "achievement", title: "You earned the Sales Foundations certificate", body: "Nice work — it's ready to share.", href: "/certificates", at: now - 20 * DAY, read: true },
    { id: id("n"), userId: "u-daniel", kind: "submission", title: "3 assignments are waiting for review", body: "CRM Mastery · Pipeline review assignment", href: "/learners", at: now - 5 * 3600000, read: false },
    { id: id("n"), userId: "u-daniel", kind: "reply", title: "Luis asked a question in Negotiation Essentials", body: "What's a reasonable first concession?", href: "/community", at: now - 70 * 3600000, read: false },
    { id: id("n"), userId: "u-priya", kind: "expiry", title: "2 certificates need attention", body: "1 expiring in 15 days, 1 already expired.", href: "/certifications", at: now - 2 * 3600000, read: false },
    { id: id("n"), userId: "u-priya", kind: "insight", title: "Security Awareness completion is at 56%", body: "Deadline is in 9 days.", href: "/analytics", at: now - 26 * 3600000, read: true },
  ];

  const settings = { maxVideoMB: 200, instructorPublish: true, orgName: "WorkEasy360", orgLogo: null, supportEmail: "support@workeasy360.com", certExpiryDefault: 12, guidesEnabled: true, communityEnabled: true, brandHue: 250 };

  // Historical guide analytics from other users so the admin view isn't empty
  const guideAnalytics = [];
  const G = R;
  const gEv = (guideId, event, userId, ts, extra = {}) => guideAnalytics.push({ guideId, event, userId, at: ts, ...extra });
  const others = ["u-sam", "u-lena", "u-omar", "u-aisha", "u-tom", "u-grace", "u-luis", "u-nina", "u-ben", "u-daniel"];
  others.forEach((uid, i) => {
    const t0 = now - (i + 2) * DAY;
    gEv("create-first-course", "guide.opened", uid, t0);
    gEv("create-first-course", "guide.started", uid, t0 + 1000);
    const reached = i < 4 ? 5 : 1 + Math.floor(G() * 4);
    for (let s = 1; s <= reached; s++) gEv("create-first-course", "step.completed", uid, t0 + s * 60000, { step: s });
    if (reached === 5) gEv("create-first-course", "guide.completed", uid, t0 + 5 * 60000, { durationMs: (240 + Math.round(G() * 200)) * 1000 });
    else gEv("create-first-course", "guide.abandoned", uid, t0 + reached * 70000, { step: reached });
  });
  ["u-sam", "u-luis", "u-ben", "u-tom", "u-lena"].forEach((uid, i) => {
    const t0 = now - (i + 1) * DAY;
    gEv("first-lesson", "guide.opened", uid, t0);
    gEv("first-lesson", "guide.started", uid, t0 + 1000);
    for (let s = 1; s <= 4; s++) gEv("first-lesson", "step.completed", uid, t0 + s * 40000, { step: s });
    if (i !== 4) gEv("first-lesson", "guide.completed", uid, t0 + 4 * 41000, { durationMs: (140 + Math.round(G() * 90)) * 1000 });
    else gEv("first-lesson", "guide.abandoned", uid, t0 + 4 * 41000, { step: 4 });
  });

  return {
    users, skills, courses, enrollments, certificates, journeys, groups, posts, notifications,
    settings: [settings], guideAnalytics, guideProgress: {},
  };
}
