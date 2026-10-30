// Certificates: learner wallet, admin certifications, public verification page.
import { h, fmtDate, mount } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Tabs } from "../components/Tabs.js";
import { PageHeader, Card, StatCard } from "../components/Card.js";
import { StatusBadge, Badge, Avatar } from "../components/Badge.js";
import { EmptyState } from "../components/States.js";
import { Input } from "../components/Form.js";
import { openModal, toast, confirmDialog } from "../components/Overlay.js";
import { certificatesFor, allCertificates, certStatus, verifyCertificateRemote, renewCertificate } from "../services/learning.js";
import { LoadingState } from "../components/States.js";
import { getCourse, courseTitle } from "../services/courses.js";
import { userById, settings } from "../services/people.js";
import { save } from "../lib/store.js";
import { navigate } from "../router.js";
import { BRAND_IMAGES } from "../components/Brand.js";
import qrcode from "../lib/vendor/qrcode.js";

const longDate = (ts) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

/** QR code (navy modules, white quiet zone) that opens this certificate's public verification page. */
function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text); qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges" aria-hidden="true"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#13222E"/></svg>`;
}

/** Gold seal with the WorkEasy360 "W" mark and green ribbon tails. */
let sealSeq = 0;
function sealSvg() {
  const id = `cert-seal-${++sealSeq}`;
  const star = Array.from({ length: 64 }, (_, i) => { const a = (Math.PI * 2 * i) / 64 - Math.PI / 2, r = i % 2 ? 86 : 95; return `${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`; }).join(" ");
  return `<svg viewBox="0 0 200 250" aria-hidden="true">
    <defs>
      <linearGradient id="${id}-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E3A1"/><stop offset=".5" stop-color="#D4AF37"/><stop offset="1" stop-color="#A67C1A"/></linearGradient>
      <path id="${id}-ring" d="M43,100 a57,57 0 1,1 114,0 a57,57 0 1,1 -114,0"/>
    </defs>
    <path d="M66 150 L46 238 L70 224 L86 246 L104 166 Z" fill="#008F49"/>
    <path d="M134 150 L154 238 L130 224 L114 246 L96 166 Z" fill="#00BF62"/>
    <polygon points="${star}" fill="url(#${id}-gold)"/>
    <circle cx="100" cy="100" r="78" fill="#13222E"/>
    <circle cx="100" cy="100" r="73" fill="none" stroke="url(#${id}-gold)" stroke-width="1.6"/>
    <circle cx="100" cy="100" r="46" fill="none" stroke="url(#${id}-gold)" stroke-width="1.6"/>
    <text font-family="Cinzel, Georgia, serif" font-size="11.5" font-weight="700" fill="#F6E3A1"><textPath href="#${id}-ring" textLength="350" lengthAdjust="spacing">WORKEASY360 • CERTIFIED • VERIFIED •</textPath></text>
    <circle cx="100" cy="100" r="42" fill="#fff"/>
    <image href="${BRAND_IMAGES.mark}" x="70" y="70" width="60" height="60"/>
  </svg>`;
}

/** The printable certificate (A4 landscape). Names come from the backend, so it reads correctly on any device. */
export function CertificateView(cert) {
  const user = userById(cert.userId), course = getCourse(cert.courseId), status = certStatus(cert);
  const name = cert.recipientName || user?.name || "";
  const title = cert.courseTitle || courseTitle(course || { title: "Course" });
  const instructor = cert.instructorName || (course?.instructorId && userById(course.instructorId)?.name) || null;
  const issuer = cert.issuer || settings()?.orgName || null;
  const issuerLogo = cert.issuerLogo || settings()?.orgLogo || null;
  const verifyHash = `#/verify/${encodeURIComponent(cert.id)}`;
  const inactive = status === "expired" || status === "revoked";
  const meta = [`Awarded on ${longDate(cert.issuedAt)}${issuer ? ` by ${issuer}` : ""}`, cert.expiresAt && `${status === "expired" ? "Expired" : "Valid until"} ${longDate(cert.expiresAt)}`].filter(Boolean).join("  ·  ");
  return h("div", { class: "cert-scroll" }, h("article", { class: ["cert", inactive && "is-expired"], "aria-label": `Certificate of completion awarded to ${name} for ${title}`, "data-cert": cert.id }, h("div", { class: "cert-frame" }, [
    ...["tl", "tr", "bl", "br"].map((p) => h("span", { class: `cert-corner cert-corner-${p}`, "aria-hidden": "true" })),
    h("img", { class: "cert-watermark", src: BRAND_IMAGES.mark, alt: "" }),
    // The top of the certificate belongs to the ISSUING organisation — the customer running this LMS: their
    // uploaded logo (Admin → Settings) or, without one, their name. Our own brand appears in the credit below.
    issuerLogo
      ? h("img", { class: "cert-org-logo", src: issuerLogo, alt: issuer || "Issuing organisation", "data-cert-issuer-logo": "" })
      : h("div", { class: "cert-org-name", "data-cert-issuer-name": "" }, issuer || "WorkEasyLMS"),
    h("div", { class: "cert-title" }, "Certificate"),
    h("div", { class: "cert-subtitle" }, "of Completion"),
    h("div", { class: "cert-presented" }, "This is to certify that"),
    h("div", { class: "cert-name", "data-cert-name": "" }, name),
    h("div", { class: "cert-text" }, "has successfully completed the course"),
    h("div", { class: "cert-course", "data-cert-course": "" }, title),
    h("div", { class: "cert-meta" }, meta),
    h("div", { class: "cert-foot" }, [
      h("div", { class: "cert-verify" }, [
        h("a", { class: "cert-qr", href: verifyHash, "aria-label": "Verify this certificate online", html: qrSvg(`${location.origin}${location.pathname}${verifyHash}`), "data-cert-qr": "" }),
        h("div", {}, [h("div", { class: "cert-label" }, "Certificate ID"), h("div", { class: "cert-id" }, cert.id), h("div", { class: "cert-label", style: "margin-top:0.6cqw" }, "Verify at"), h("div", { class: "cert-url" }, `${location.host}/${verifyHash}`)]),
      ]),
      h("div", { class: "cert-seal", html: sealSvg() }),
      h("div", { class: "cert-sign" }, [h("div", { class: "cert-signature" }, instructor || issuer || "WorkEasy360"), h("div", { class: "cert-sign-line" }), h("div", { class: "cert-label" }, instructor ? "Course Instructor" : "Authorised Signatory")]),
    ]),
    // Our advertisement on every certificate a customer hands out.
    h("div", { class: "cert-credit", "data-cert-credit": "" }, [h("img", { src: BRAND_IMAGES.mark, alt: "" }), h("span", {}, ["Powered by ", h("strong", {}, ["WorkEasy", h("b", {}, "LMS")]), " · workeasy360.com"])]),
    inactive && h("div", { class: "cert-stamp", "data-cert-stamp": status }, status === "revoked" ? "Revoked" : "Expired"),
  ])));
}

export function openCertificate(cert) {
  const link = `${location.origin}${location.pathname}#/verify/${cert.id}`;
  openModal({
    title: "Certificate", size: "lg",
    content: h("div", { class: "stack" }, [CertificateView(cert), h("div", { class: "row-between wrap no-print" }, [h("div", { class: "small muted" }, ["Verification link: ", h("a", { href: `#/verify/${cert.id}`, onclick: (e) => e.currentTarget.closest(".scrim")?.remove() }, `#/verify/${cert.id}`)])])]),
    footer: (close) => [
      Button({ label: "Copy link", icon: "copy", onClick: async () => { try { await navigator.clipboard.writeText(link); toast("Verification link copied"); } catch { toast("Copy failed — select the link manually", { type: "error" }); } } }),
      Button({ label: "Print / save PDF", icon: "download", variant: "primary", onClick: () => window.print() }),
    ],
  });
}

function certTile(cert, { onRenew } = {}) {
  const course = getCourse(cert.courseId), status = certStatus(cert);
  return h("div", { class: "card card-pad stack-sm" }, [
    h("div", { class: "row-between" }, [h("div", { class: "row-sm" }, [h("span", { class: "icon-tile" }, ico("award", 20)), h("div", {}, [h("h3", {}, cert.courseTitle || courseTitle(course || { title: "Course" })), h("div", { class: "xs muted" }, `Issued ${fmtDate(cert.issuedAt)}`)])]), StatusBadge(status)]),
    h("div", { class: "small muted" }, cert.expiresAt ? `${status === "expired" ? "Expired" : "Expires"} ${fmtDate(cert.expiresAt)}` : "Never expires"),
    h("div", { class: "xs muted", style: "font-family:var(--font-mono)" }, cert.id),
    h("div", { class: "row wrap" }, [Button({ label: "View", icon: "eye", size: "sm", onClick: () => openCertificate(cert) }), (status === "expiring" || status === "expired") && course?.certExpiryMonths ? Button({ label: "Renew", icon: "refresh", size: "sm", variant: "primary", onClick: () => onRenew?.(cert) }) : null]),
  ]);
}

export function CertificatesPage(ctx) {
  const list = h("div");
  const draw = () => {
    const certs = certificatesFor(ctx.user.id);
    list.replaceChildren(certs.length
      ? h("div", { class: "grid grid-auto" }, certs.map((c) => certTile(c, { onRenew: (cert) => { renewCertificate(cert.id); toast("Certificate renewed for another term"); draw(); } })))
      : Card(EmptyState({ icon: "award", title: "No certificates yet", description: "Complete a course to earn your first certificate.", action: Button({ label: "Explore courses", variant: "primary", href: "/explore" }) })));
  };
  draw();
  return { title: "Certificates", crumbs: [{ label: "Certificates" }], el: h("div", { class: "stack-lg" }, [PageHeader({ title: "Certificates", sub: "Proof of what you've achieved. Each has a verification ID anyone can check." }), list]) };
}

export function CertificationsAdminPage() {
  let tab = "all", q = "";
  const body = h("div");
  const draw = () => {
    const rows = allCertificates().filter((c) => tab === "all" || certStatus(c) === tab).sort((a, b) => b.issuedAt - a.issuedAt);
    body.replaceChildren(rows.length ? h("div", { class: "card table-wrap" }, h("table", { class: "table" }, [
      h("thead", {}, h("tr", {}, ["Learner", "Course", "Issued", "Expires", "Status", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, rows.map((c) => {
        const u = userById(c.userId), s = certStatus(c);
        return h("tr", {}, [
          h("td", {}, h("div", { class: "row-sm" }, [Avatar(u, "sm"), h("div", {}, [h("div", { class: "strong" }, u?.name || c.recipientName), h("div", { class: "xs muted" }, u?.dept)])])),
          h("td", {}, c.courseTitle || courseTitle(getCourse(c.courseId) || { title: "" })), h("td", {}, fmtDate(c.issuedAt)), h("td", {}, c.expiresAt ? fmtDate(c.expiresAt) : "—"), h("td", {}, StatusBadge(s)),
          h("td", {}, h("div", { class: "row-sm", style: "justify-content:flex-end" }, [
            Button({ label: "View", size: "sm", variant: "ghost", onClick: () => openCertificate(c) }),
            (s === "expiring" || s === "expired") && Button({ label: "Remind", size: "sm", onClick: () => toast(`Reminder sent to ${u?.name}`) }),
            s !== "revoked" && Button({ icon: "x", size: "sm", variant: "ghost", title: "Revoke certificate", onClick: async () => { if (await confirmDialog({ title: "Revoke certificate?", message: `${u?.name}'s certificate will no longer verify.`, confirmLabel: "Revoke", danger: true })) { c.revoked = true; save("certificates"); draw(); } } }),
          ])),
        ]);
      })),
    ])) : Card(EmptyState({ icon: "award", title: "No certificates in this view" })));
  };
  const all = allCertificates();
  const count = (s) => all.filter((c) => certStatus(c) === s).length;
  draw();
  return { title: "Certifications", crumbs: [{ label: "Certifications" }], el: h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Certifications", sub: "Track validity, expiry and renewals across the organisation." }),
    h("div", { class: "grid grid-4" }, [StatCard({ label: "Issued", value: all.length, icon: "award" }), StatCard({ label: "Valid", value: count("valid"), icon: "check-circle", tone: "success" }), StatCard({ label: "Expiring soon", value: count("expiring"), icon: "clock", tone: "warning" }), StatCard({ label: "Expired", value: count("expired"), icon: "alert", tone: "danger" })]),
    Tabs({ tabs: [{ id: "all", label: "All" }, { id: "valid", label: "Valid" }, { id: "expiring", label: "Expiring" }, { id: "expired", label: "Expired" }, { id: "revoked", label: "Revoked" }], active: tab, onChange: (t) => { tab = t; draw(); }, label: "Certificate status" }),
    body,
  ]) };
}

// Public verification page — the seam for QR codes / verifiable credentials later.
export function VerifyPage(ctx) {
  const result = h("div");
  const input = Input({ value: ctx.params.id || "", placeholder: "e.g. WE360-2026-MAYA01", "aria-label": "Certificate ID" });
  // Backend-authoritative: the Java verify endpoint decides valid / expiring / expired / revoked / unknown.
  let seq = 0;
  const lookup = async (code) => {
    if (!code.trim()) return result.replaceChildren();
    const mine = ++seq;
    result.replaceChildren(LoadingState("Checking certificate…"));
    let r;
    try { r = await verifyCertificateRemote(code); }
    catch (err) {
      if (mine !== seq) return;
      return result.replaceChildren(h("div", { class: "card card-pad callout danger", role: "alert" }, [ico("alert", 18), h("div", {}, [h("strong", {}, "We couldn't verify this certificate right now. "), err.message || "Please try again."])]));
    }
    if (mine !== seq) return;
    result.replaceChildren(!r
      ? h("div", { class: "card card-pad callout danger", role: "alert", "data-verify": "not-found" }, [ico("alert", 18), h("div", {}, [h("strong", {}, "No certificate found. "), "Check the ID and try again."])])
      : h("div", { class: "stack", "data-verify": r.status }, [
        h("div", { class: ["callout", r.status === "valid" || r.status === "expiring" ? "tip" : "danger"], role: "status" }, [ico(r.status === "valid" || r.status === "expiring" ? "shield" : "alert", 18), h("div", {}, [h("strong", {}, r.status === "valid" ? "Valid certificate" : r.status === "expiring" ? "Valid — expires soon" : r.status === "expired" ? "This certificate has expired" : "This certificate was revoked")])]),
        CertificateView(r.cert),
      ]));
  };
  const el = h("div", { class: "verify stack-lg", style: "padding:32px 16px" }, [
    h("div", { class: "center stack-sm" }, [h("span", { class: "icon-tile", style: "margin:0 auto" }, ico("shield", 22)), h("h1", { id: "page-title", tabindex: "-1" }, "Verify a certificate"), h("p", { class: "muted" }, "Enter the certificate ID to confirm it's genuine.")]),
    h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); navigate(`/verify/${encodeURIComponent(input.value.trim())}`); } }, [h("div", { class: "grow" }, input), Button({ label: "Verify", variant: "primary", attrs: { type: "submit" } })]),
    result,
  ]);
  lookup(ctx.params.id || "");
  return { title: "Verify certificate", crumbs: [{ label: "Verify certificate" }], el, public: true };
}
