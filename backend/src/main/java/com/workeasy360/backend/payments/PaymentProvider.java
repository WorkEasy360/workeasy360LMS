package com.workeasy360.backend.payments;

import com.workeasy360.backend.domain.CommerceEntities.OrderStatus;
import com.workeasy360.backend.domain.CommerceEntities.PurchaseOrder;

/**
 * Provider-independent payment contract. A real provider (Stripe, Razorpay, …) implements this: it opens a checkout
 * for a PENDING order and later reports the outcome (usually from a signed webhook) through {@link PaymentResult},
 * which {@code OrderService.confirm} turns into the order status, the payment record and the learner's entitlement.
 * The application never marks an order paid on the say-so of the browser.
 */
public interface PaymentProvider {
    /** Provider id as reported to clients (mock, none, stripe, …). */
    String name();
    /** True when this provider can take payments right now. */
    boolean available();
    /** Opens a checkout for the order: where the learner goes next, and the provider's reference for the order. */
    CheckoutSession createCheckout(PurchaseOrder order);

    /** mode: "mock" (in-app simulated checkout, development only) or "redirect" (hosted checkout page at checkoutUrl). */
    record CheckoutSession(String mode, String checkoutUrl, String providerRef) {}
    /** The provider's verdict on a payment attempt. */
    record PaymentResult(OrderStatus status, String providerRef, String detail) {}
}
