// Checkout + payment result for one order. The order's status always comes from the server; this page never
// decides that a payment succeeded. With the mock provider (local development) it offers the simulated outcomes.
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { PageHeader, Card } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { EmptyState, ErrorState, LoadingState } from "../components/States.js";
import { toast } from "../components/Overlay.js";
import { Cover } from "../components/Domain.js";
import { getCourse, courseTitle } from "../services/courses.js";
import { getOrder, cancelOrder, mockOutcome, paymentsStatus, startPurchase, formatPrice } from "../services/commerce.js";
import { refreshCourse } from "../services/courseSync.js";
import { hydrateMyLearning } from "../services/learningSync.js";
import { navigate } from "../router.js";

export function CheckoutPage(ctx) {
  const body = h("div", { class: "stack-lg", style: "max-width:720px", "data-checkout": "loading" });
  let order = null, status = null;

  const summary = (o) => {
    const course = getCourse(o.courseId);
    return Card(h("div", { class: "row wrap", style: "gap:16px;align-items:center" }, [
      course && Cover(course, 64, 28),
      h("div", { class: "grow", style: "min-width:200px" }, [h("div", { class: "eyebrow" }, "Order " + o.id), h("h3", {}, o.courseTitle || (course && courseTitle(course)) || "Course"), h("div", { class: "small muted" }, `${formatPrice(o.amountCents, o.currency)} · ${o.currency}`)]),
      Badge(o.status === "SUCCESS" ? "Paid" : o.status === "PENDING" ? "Awaiting payment" : o.status[0] + o.status.slice(1).toLowerCase(), o.status === "SUCCESS" ? "success" : o.status === "PENDING" ? "warning" : "danger"),
    ]));
  };

  async function unlocked(o) {
    await Promise.all([refreshCourse(o.courseId), hydrateMyLearning()]); // pull the now-unlocked content and the new enrolment
  }

  const draw = async () => {
    try {
      [order, status] = await Promise.all([getOrder(ctx.params.orderId), paymentsStatus()]);
    } catch (err) {
      body.dataset.checkout = "error";
      body.replaceChildren(ErrorState({ title: err.status === 403 ? "That order isn't yours" : "Order not found", description: err.message, onRetry: () => navigate("/explore") }));
      return;
    }
    body.dataset.checkout = order.status.toLowerCase();
    const courseHref = `/explore/${order.courseId}`;
    if (order.status === "SUCCESS") {
      await unlocked(order);
      body.replaceChildren(summary(order), Card(EmptyState({ icon: "check-circle", title: "Payment successful — course unlocked", description: "Your purchase is complete and the course is now in My Learning.",
        action: h("div", { class: "row wrap", style: "justify-content:center" }, [Button({ label: "Start Learning", icon: "play", variant: "primary", size: "lg", href: `/learn/${order.courseId}`, attrs: { "data-checkout-start": "" } }), Button({ label: "My Learning", href: "/my-learning" })]) })));
      return;
    }
    if (order.status === "FAILED" || order.status === "CANCELLED") {
      body.replaceChildren(summary(order), Card(EmptyState({ icon: "alert", title: order.status === "FAILED" ? "Payment failed" : "Checkout cancelled", description: "You have not been charged and the course stays locked. You can try again whenever you like.",
        action: h("div", { class: "row wrap", style: "justify-content:center" }, [Button({ label: "Try again", icon: "refresh", variant: "primary", attrs: { "data-checkout-retry": "" }, onClick: async (e) => {
          e.currentTarget.disabled = true;
          try { const c = await startPurchase(order.courseId); navigate(`/checkout/${c.order.id}`); }
          catch (err) { toast(err.message, { type: "error" }); e.currentTarget.disabled = false; }
        } }), Button({ label: "Back to course", href: courseHref })]) })));
      return;
    }
    // PENDING
    const actions = h("div", { class: "stack" });
    if (status.mock) {
      actions.replaceChildren(
        h("div", { class: "callout" }, [ico("info", 18), h("div", {}, [h("strong", {}, "Test checkout. "), "This server uses the development payment provider: no money moves. Choose an outcome to simulate the payment provider's answer."])]),
        h("div", { class: "row wrap" }, [
          Button({ label: `Pay ${formatPrice(order.amountCents, order.currency)} (test)`, icon: "check", variant: "primary", size: "lg", attrs: { "data-checkout-pay": "" }, onClick: () => outcome("success") }),
          Button({ label: "Simulate a failed payment", variant: "secondary", attrs: { "data-checkout-fail": "" }, onClick: () => outcome("failed") }),
          Button({ label: "Cancel", variant: "ghost", attrs: { "data-checkout-cancel": "" }, onClick: async () => { await cancelOrder(order.id); draw(); } }),
        ]),
      );
    } else if (status.available) {
      actions.replaceChildren(h("p", { class: "small" }, "Continue to the payment provider to complete your purchase."), Button({ label: "Continue to payment", icon: "arrow-right", variant: "primary", size: "lg", href: order.checkoutUrl, attrs: { "data-checkout-continue": "" } }));
    } else {
      actions.replaceChildren(Card(EmptyState({ icon: "alert", title: "Payments aren't available yet", description: "This server has no payment provider configured. Please contact your administrator to get access to this course.", action: Button({ label: "Back to course", href: courseHref }) })));
    }
    body.replaceChildren(summary(order), Card(h("div", { class: "stack" }, [h("h3", {}, "Checkout"), actions])));
  };
  const outcome = async (kind) => {
    body.dataset.checkout = "working";
    try { await mockOutcome(order.id, kind); } catch (err) { toast(err.message, { type: "error" }); }
    draw();
  };

  body.replaceChildren(LoadingState("Loading your order…"));
  draw();
  return { title: "Checkout", crumbs: [{ label: "Explore", href: "/explore" }, { label: "Checkout" }], el: h("div", { class: "stack-lg" }, [PageHeader({ title: "Checkout", sub: "Complete your purchase to unlock the course." }), body]) };
}
