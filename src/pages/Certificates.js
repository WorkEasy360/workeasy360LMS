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
import { userById } from "../services/people.js";
import { save } from "../lib/store.js";
import { navigate } from "../router.js";

export function CertificateView(cert) {
  const user = userById(cert.userId), course = getCourse(cert.courseId), status = certStatus(cert);
  return h("div", { class: ["cert", (status === "expired" || status === "revoked") && "is-expired"] }, [
    h("div", { class: "eyebrow" }, "WorkEasy360 · Certificate of completion"),
    h("div", { class: "small muted", style: "margin-top:10px" }, "This certifies that"),
    h("div", { class: "cert-name" }, user?.name),
    h("div", { class: "small muted" }, "has successfully completed"),
    h("h2", { style: "margin:6px 0 14px;font-size:clamp(18px,2.6vw,26px)" }, courseTitle(course || { title: "Course" })),
    h("span", { class: "cert-seal" }, ico("award", 30)),
    h("div", { class: "row wrap xs muted", style: "justify-content:center;margin-top:14px;gap:6px 18px" }, [`Issued ${fmtDate(cert.issuedAt)}`, cert.expiresAt ? `${status === "expired" ? "Expired" : "Valid until"} ${fmtDate(cert.expiresAt)}` : "No expiry", `ID ${cert.id}`]),
    status === "revoked" && h("div", { class: "badge badge-danger", style: "margin-top:8px" }, "Revoked"),
  ]);
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
    h("div", { class: "row-between" }, [h("div", { class: "row-sm" }, [h("span", { class: "icon-tile" }, ico("award", 20)), h("div", {}, [h("h3", {}, courseTitle(course || { title: "Course" })), h("div", { class: "xs muted" }, `Issued ${fmtDate(cert.issuedAt)}`)])]), StatusBadge(status)]),
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
          h("td", {}, h("div", { class: "row-sm" }, [Avatar(u, "sm"), h("div", {}, [h("div", { class: "strong" }, u?.name), h("div", { class: "xs muted" }, u?.dept)])])),
          h("td", {}, courseTitle(getCourse(c.courseId) || { title: "" })), h("td", {}, fmtDate(c.issuedAt)), h("td", {}, c.expiresAt ? fmtDate(c.expiresAt) : "—"), h("td", {}, StatusBadge(s)),
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
