// WorkEasy360 Assistant (floating AI agent), WorkEasy360 brand and the printable certificate (run one at a time: index.html?as=<role>&selftest=<suite>).
// The agent talks to the Learning Coach backend, which runs on the deterministic mock provider (AI_ENABLED=false).
import { loginReal, DEMO_EMAIL_BY_ROLE, DEMO_PASSWORD, load } from "/src/lib/store.js";
import { bus } from "/src/lib/events.js";
import { guideEngine } from "/src/guide/GuideEngine.js";

export function registerAgent({ suites, log, ok, sleep, q, click, type, waitFor, navigate }) {
  const T = (t) => q(`[data-guide-target="${t}"]`);
  const token = () => localStorage.getItem("we360.v2.token");
  const apiGet = (path) => fetch("http://localhost:8080/api" + path, { headers: { Authorization: "Bearer " + token() } }).then((r) => (r.ok ? r.json() : null));
  let lastRoute = 0; bus.on("route", () => (lastRoute = Date.now()));
  const settled = async (userId) => {
    if (userId) await waitFor(() => load("userSkills").some((r) => r.userId === userId), 10000, "post-login hydration");
    const t0 = Date.now();
    await waitFor(() => Date.now() - Math.max(lastRoute, t0) > 1500, 10000, "route quiet period");
  };
  const launcher = () => q("[data-agent-launcher]");
  const panel = () => q("[data-agent-panel]");
  const shown = (el) => !!el && !el.hidden && el.getBoundingClientRect().width > 0;
  const imgLoaded = (img) => waitFor(() => img && img.complete && img.naturalWidth > 0, 4000, "image " + img?.getAttribute("src"));
  const rgb = (el, prop = "backgroundColor") => getComputedStyle(el)[prop].replace(/\s+/g, "");
  async function ask(text) {
    const before = document.querySelectorAll('[data-agent-msg="COACH"]').length;
    type(q("[data-agent-input]"), text);
    ok(!q("[data-agent-send]").disabled, "send button enables once there is text");
    click(q("[data-agent-send]"));
    await waitFor(() => document.querySelectorAll('[data-agent-msg="COACH"]').length > before && panel().dataset.agentState === "ready", 30000, "assistant reply");
    return [...document.querySelectorAll('[data-agent-msg="COACH"]')].pop();
  }

  // Learner: launcher → panel → grounded reply → history → new chat → lesson context → error recovery → guided tour.
  suites.agent = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate("/"); await settled("u-maya");
    const l = await waitFor(() => shown(launcher()) && launcher(), 4000, "agent launcher");
    ok(!!l, "launcher is shown on Home");
    const img = l?.querySelector("img");
    ok(!!(await imgLoaded(img)) && /\/src\/assets\/brand\/agent-logo\.png$/.test(img.getAttribute("src")), "launcher shows the agent artwork (agent-logo.png)");
    const lr = l.getBoundingClientRect(), app = q("#app").getBoundingClientRect();
    ok(Math.abs(app.right - lr.right - 24) < 2 && Math.abs(app.bottom - lr.bottom - 24) < 2 && Math.round(lr.width) === 56, `launcher is 56px, 24px from the bottom-right corner (${Math.round(lr.width)}px)`);
    ok(l.getAttribute("aria-expanded") === "false" && panel().hidden, "panel starts closed");

    click(l);
    await waitFor(() => shown(panel()), 2000, "agent panel");
    ok(shown(panel()) && l.getAttribute("aria-expanded") === "true" && l.hidden, "launcher opens the panel (and steps aside)");
    await waitFor(() => document.activeElement === q("[data-agent-input]"), 1000, "input focus");
    ok(document.activeElement === q("[data-agent-input]"), "focus moves to the message box");
    ok(Math.round(panel().getBoundingClientRect().width) === 420, `panel is 420px wide on desktop (${Math.round(panel().getBoundingClientRect().width)})`);
    ok(document.querySelectorAll("[data-agent-prompt]").length === 4, "empty state offers 4 suggested questions");
    ok(document.querySelectorAll("[data-agent-tour]").length >= 1, "empty state offers guided tours for the role");
    ok(q("[data-agent-send]").disabled, "send is disabled while the box is empty");

    // A grounded reply from the coach backend, persisted as a conversation
    const question = `What should I learn next? (agent ${Date.now()})`;
    const reply = await ask(question);
    ok(!!reply && reply.textContent.trim().length > 20, "assistant replies in the panel");
    ok([...document.querySelectorAll('[data-agent-msg="USER"]')].some((m) => m.textContent.includes(question)), "the question shows as the user's bubble");
    const convs = (await apiGet("/coach/conversations")) || [];
    const conv = convs.find((c) => c.title && question.startsWith(c.title.replace(/…$/, "")));
    ok(!!conv, "conversation is saved on the backend under the learner's account");

    // History: the conversation can be reopened
    click(q("[data-agent-history]"));
    const row = await waitFor(() => conv && q(`[data-agent-conv="${conv.id}"]`), 6000, "history row");
    ok(!!row, "history lists the conversation");
    ok(!shown(q(".agent-compose")), "composer is hidden in the history view");
    click(row);
    await waitFor(() => document.querySelectorAll("[data-agent-msg]").length >= 2, 6000, "reopened conversation");
    ok(document.querySelectorAll("[data-agent-msg]").length >= 2 && shown(q(".agent-compose")), "reopening a conversation restores its messages");

    // New chat → empty state again
    click(q("[data-agent-new]"));
    ok(!!q("[data-agent-empty]") && !q("[data-agent-msg]"), "New conversation clears the thread");

    // Escape closes, focus returns to the launcher
    panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(100);
    ok(panel().hidden && shown(launcher()) && document.activeElement === launcher(), "Escape closes the panel and returns focus to the launcher");

    // Hidden on /coach (the full-page coach), back on other pages
    navigate("/coach"); await waitFor(() => q('[data-coach-state="ready"]'), 8000, "coach page");
    ok(!shown(launcher()) && panel().hidden, "launcher is hidden on the full Learning Coach page");
    ok(q(".coach-avatar")?.tagName === "IMG" && /agent-logo\.png$/.test(q(".coach-avatar").getAttribute("src")), "Learning Coach page uses the same agent artwork");
    navigate("/my-learning"); await sleep(400);
    ok(shown(launcher()), "launcher returns on the next page");

    // Lesson context: on a lesson the agent sends the lesson and offers lesson prompts
    const { courseId, lessonId } = await suites.__createMappedCourse("lesson", undefined, 20);
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD); await settled("u-maya");
    const tree = await apiGet(`/courses/${courseId}`);
    const lesson = tree.modules[0].lessons.find((x) => x.id === lessonId);
    navigate(`/explore/${courseId}`); await waitFor(() => T("course.start"), 6000, "course page");
    click(T("course.start")); await waitFor(() => location.hash.startsWith(`#/learn/${courseId}`) && T("player.coach"), 8000, "player");
    await sleep(300);
    ok(shown(launcher()), "launcher is shown in the lesson player");
    const bar = q(".player-bar"), lb = launcher().getBoundingClientRect();
    const covered = bar && [...bar.querySelectorAll("button, a")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.right > lb.left && r.left < lb.right && r.bottom > lb.top && r.top < lb.bottom; });
    ok(!covered || covered.length === 0, "launcher does not cover the player's buttons");
    click(launcher()); await waitFor(() => shown(panel()), 2000, "panel on lesson");
    ok(/lesson/i.test(q(".agent-sub")?.textContent || ""), "panel says it knows the current lesson");
    const lessonPrompt = [...document.querySelectorAll("[data-agent-prompt]")].find((b) => /Explain this lesson/.test(b.textContent));
    ok(!!lessonPrompt, "lesson-specific prompts are offered");
    const before = document.querySelectorAll('[data-agent-msg="COACH"]').length;
    click(lessonPrompt);
    await waitFor(() => document.querySelectorAll('[data-agent-msg="COACH"]').length > before && panel().dataset.agentState === "ready", 30000, "lesson reply");
    const lessonReply = [...document.querySelectorAll('[data-agent-msg="COACH"]')].pop()?.textContent || "";
    ok(lessonReply.includes(lesson.title), `reply is about the current lesson (${lesson.title})`);

    // Error recovery: the mock provider returns invalid JSON for this token → 422 → recoverable error bubble
    const errBefore = document.querySelectorAll("[data-agent-error]").length;
    type(q("[data-agent-input]"), "__malformed__ what next?"); click(q("[data-agent-send]"));
    await waitFor(() => q("[data-agent-error]") && panel().dataset.agentState === "error", 30000, "error bubble");
    ok(document.querySelectorAll("[data-agent-error]").length > errBefore && /Try again/.test(q("[data-agent-error]").textContent), "a failed reply shows a recoverable error with Try again");
    ok(!q("[data-agent-input]").disabled, "the message box stays usable after an error");

    // Guided tour from the agent opens the guide panel and closes the agent
    click(q("[data-agent-new]"));
    const tour = q("[data-agent-tour]");
    const tourId = tour?.dataset.agentTour;
    click(tour);
    await waitFor(() => guideEngine.isOpen(), 3000, "guide open");
    ok(guideEngine.isOpen() && guideEngine.state.guide?.id === tourId && panel().hidden, `guided tour "${tourId}" starts and the agent closes`);
    guideEngine.close();
  };

  // Admin: brand colours and logo in the shell, the agent for a non-learner role, phone width.
  suites.brand = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.admin, DEMO_PASSWORD);
    navigate("/"); await sleep(1500); await settled();
    ok(rgb(q("#sidebar")) === "rgb(19,34,46)", `sidebar is WorkEasy360 navy #13222E (${rgb(q("#sidebar"))})`);
    ok(rgb(document.body) === "rgb(246,248,249)", `page background is #F6F8F9 (${rgb(document.body)})`);
    const primary = q("#main .btn-primary");
    ok(!!primary && rgb(primary) === "rgb(0,191,98)", `primary buttons are WorkEasy360 green #00BF62 (${primary && rgb(primary)})`);
    const cta = q(".nav-cta .btn");
    ok(!!cta && rgb(cta) === "rgba(0,191,98,0.2)" && rgb(cta, "color") === "rgb(0,191,98)", `sidebar Create Course matches Booking's New Appointment (${cta && rgb(cta)})`);
    const logo = q("#sidebar [data-brand='product-logo'] img");
    ok(!!(await imgLoaded(logo)) && /workeasy360-logo-white\.png$/.test(logo.getAttribute("src")) && logo.naturalWidth === 742, "sidebar shows the official white WorkEasy360 logo");
    ok(/LMS/.test(q("#sidebar .product-logo-name")?.textContent || "") && rgb(q("#sidebar .product-logo-name"), "color") === "rgb(0,191,98)", "product name LMS sits under the logo in green");
    ok(!shown(q("#sidebar .brand-compact")), "the compact mark is hidden while the sidebar is full width");
    ok(/workeasy360-mark\.png$/.test(q("link[rel='icon']")?.getAttribute("href") || "") && q("meta[name='theme-color']")?.content === "#13222E", "favicon is the W mark, theme colour is navy");
    ok(/Priya/.test(q(".sidebar-user-name")?.textContent || "") && q(".sidebar-user-role")?.textContent === "Admin", "sidebar footer shows the signed-in person and role");

    // The agent works for a non-learner role too
    click(launcher()); await waitFor(() => shown(panel()), 2000, "agent panel");
    const tours = [...document.querySelectorAll("[data-agent-tour]")].map((b) => b.dataset.agentTour);
    ok(tours.length >= 1, `admin gets guided tours in the agent (${tours.join(", ")})`);
    const reply = await ask(`How am I doing? (brand ${Date.now()})`);
    ok(!!reply && reply.textContent.trim().length > 10, "admin gets a reply from the assistant");
    click(q("[data-agent-close]"));

    // Phone width: the panel fills the screen without horizontal overflow
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:390px;height:844px;border:0;position:fixed;top:0;left:0;z-index:9999;background:#fff";
    document.body.appendChild(frame);
    frame.src = "/#/";
    const doc = await waitFor(() => { const d = frame.contentDocument; const b = d?.querySelector("[data-agent-launcher]"); return b && !b.hidden && b.getBoundingClientRect().width > 0 ? d : null; }, 15000, "agent in 390px frame");
    if (doc) {
      const fl = doc.querySelector("[data-agent-launcher]").getBoundingClientRect();
      ok(fl.right <= 390 - 15 && fl.bottom <= 844 - 15, `launcher sits inside the phone screen (right ${Math.round(fl.right)}, bottom ${Math.round(fl.bottom)})`);
      doc.querySelector("[data-agent-launcher]").click();
      await sleep(300);
      const pr = doc.querySelector("[data-agent-panel]").getBoundingClientRect();
      const vw = doc.documentElement.clientWidth;
      ok(Math.round(pr.width) === vw && pr.left >= 0 && doc.documentElement.scrollWidth <= vw + 1, `panel fills the phone screen without overflow (${Math.round(pr.width)}px of ${vw}px)`);
    } else ok(false, "agent did not render in the 390px frame");
    frame.remove();
  };

  // Learner: the printable certificate carries the brand, real names from the backend and a working verification QR code.
  suites.certificate = async () => {
    await loginReal(DEMO_EMAIL_BY_ROLE.learner, DEMO_PASSWORD);
    navigate("/"); await settled("u-maya");
    const mine = (await apiGet("/certificates")) || [];
    const api = mine.find((c) => c.status === "VALID") || mine[0];
    ok(!!api && !!api.recipientName && !!api.courseTitle && !!api.issuer, `certificates carry recipient, course and issuer from the backend (${api?.recipientName}, ${api?.courseTitle}, ${api?.issuer})`);
    const pub = await fetch(`http://localhost:8080/api/certificates/verify/${encodeURIComponent(api.certificateNumber)}`).then((r) => r.json());
    ok(pub.recipientName === api.recipientName && pub.courseTitle === api.courseTitle && !("email" in pub) && !JSON.stringify(pub).includes("@"), "public verification shows the names without any e-mail address");

    navigate("/certificates");
    await waitFor(() => [...document.querySelectorAll("#main button")].some((b) => /View/.test(b.textContent)), 8000, "certificate wallet");
    const local = load("certificates").find((c) => c.id === api.certificateNumber);
    ok(!!local && local.recipientName === api.recipientName, "the wallet keeps the backend names locally");
    const { openCertificate } = await import("/src/pages/Certificates.js");
    openCertificate(local);
    const cert = await waitFor(() => q(`.modal [data-cert="${api.certificateNumber}"]`), 3000, "certificate modal");
    ok(!!cert, "View opens the certificate");
    const logo = cert.querySelector(".cert-logo");
    ok(!!(await imgLoaded(logo)) && /workeasy360-logo\.png$/.test(logo.getAttribute("src")) && logo.naturalWidth === 742, "certificate shows the official WorkEasy360 logo");
    ok(/Certificate/i.test(cert.querySelector(".cert-title")?.textContent) && /of Completion/i.test(cert.querySelector(".cert-subtitle")?.textContent), "titled Certificate of Completion");
    ok(cert.querySelector("[data-cert-name]")?.textContent === api.recipientName && cert.querySelector("[data-cert-course]")?.textContent === api.courseTitle, "recipient and course match the backend record");
    ok(cert.querySelector(".cert-signature")?.textContent === (api.instructorName || api.issuer), `signed by the course instructor (${api.instructorName})`);
    ok(cert.querySelector(".cert-meta")?.textContent.includes(api.issuer), "the issuing organisation is named");
    ok(cert.querySelector(".cert-id")?.textContent === api.certificateNumber, "certificate ID is printed");
    ok(!!cert.querySelector(".cert-seal svg image") && /workeasy360-mark\.png$/.test(cert.querySelector(".cert-seal svg image").getAttribute("href")), "gold seal carries the W mark");
    ok(getComputedStyle(cert.querySelector(".cert-name")).fontFamily.includes("Great Vibes") && getComputedStyle(cert.querySelector(".cert-title")).fontFamily.includes("Cinzel"), "certificate typefaces are applied");
    // The QR code encodes exactly this certificate's public verification link
    const { default: qrcode } = await import("/src/lib/vendor/qrcode.js");
    const url = `${location.origin}${location.pathname}#/verify/${encodeURIComponent(api.certificateNumber)}`;
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    let d = ""; for (let r = 0; r < qr.getModuleCount(); r++) for (let c = 0; c < qr.getModuleCount(); c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    ok(cert.querySelector("[data-cert-qr] path")?.getAttribute("d") === d && cert.querySelector("[data-cert-qr]").getAttribute("href") === `#/verify/${encodeURIComponent(api.certificateNumber)}`, "QR code encodes the certificate's verification link");
    const r = cert.getBoundingClientRect();
    ok(Math.abs(r.width / r.height - 1.414) < 0.01 && r.width >= 620, `A4 landscape proportions (${Math.round(r.width)}×${Math.round(r.height)})`);
    ok(!cert.querySelector("[data-cert-stamp]"), "a valid certificate has no stamp");
    document.querySelector(".modal")?.closest(".scrim")?.remove();
    // Revoked certificates are stamped (rendered from a copy, so no backend record changes)
    const { CertificateView } = await import("/src/pages/Certificates.js");
    const revoked = CertificateView({ ...local, revoked: true });
    document.body.append(revoked);
    ok(revoked.querySelector('[data-cert-stamp="revoked"]')?.textContent === "Revoked", "revoked certificates carry a Revoked stamp");
    revoked.remove();
  };
}
