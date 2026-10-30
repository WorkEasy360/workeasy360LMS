package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.CommerceEntities.OrderStatus;
import com.workeasy360.backend.domain.CommerceEntities.Payment;
import com.workeasy360.backend.domain.CommerceEntities.PurchaseOrder;
import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.Enrollment;
import com.workeasy360.backend.domain.Enums.CourseStatus;
import com.workeasy360.backend.domain.Enums.EnrollmentStatus;
import com.workeasy360.backend.payments.PaymentProperties;
import com.workeasy360.backend.payments.PaymentProvider;
import com.workeasy360.backend.payments.PaymentProvider.CheckoutSession;
import com.workeasy360.backend.payments.PaymentProvider.PaymentResult;
import com.workeasy360.backend.repo.Repos.*;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Orders → payments → entitlement. The only way a paid course is unlocked is {@link #confirm}, which records the
 * provider's verdict and, on SUCCESS, creates the enrolment in the same transaction. Nothing here trusts the browser.
 */
@Service
@Transactional
public class OrderService {
    public record Checkout(PurchaseOrder order, CheckoutSession session) {}

    private final OrderRepo orders; private final PaymentRepo payments; private final EnrollmentRepo enrollments; private final CourseRepo courses;
    private final PaymentProvider provider; private final PaymentProperties props; private final AccessService access; private final PermissionService perm;
    private final NotificationService notifications;

    public OrderService(OrderRepo orders, PaymentRepo payments, EnrollmentRepo enrollments, CourseRepo courses, PaymentProvider provider, PaymentProperties props,
                        AccessService access, PermissionService perm, NotificationService notifications) {
        this.orders = orders; this.payments = payments; this.enrollments = enrollments; this.courses = courses; this.provider = provider; this.props = props;
        this.access = access; this.perm = perm; this.notifications = notifications;
    }

    public PaymentProvider provider() { return provider; }
    public PaymentProperties props() { return props; }

    /** Starts (or resumes) a purchase: one PENDING order per learner and course; refused when access already exists. */
    public Checkout start(CurrentUser user, String courseId) {
        Course c = courses.findById(courseId).orElseThrow(() -> ApiException.notFound("Course"));
        if (c.getOrgId() != null && !c.getOrgId().equals(user.getOrgId())) throw ApiException.notFound("Course"); // tenant boundary
        if (c.getStatus() != CourseStatus.PUBLISHED) throw ApiException.notFound("Course");
        if (AccessService.isFree(c)) throw ApiException.badRequest("This course is free — enrol instead of purchasing.");
        if (access.entitlement(user, c).isPresent()) throw ApiException.conflict("You already have access to this course.");
        if (!provider.available()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Payments are not configured on this server.");
        List<PurchaseOrder> pending = orders.findByUserIdAndCourseIdAndStatus(user.getId(), c.getId(), OrderStatus.PENDING);
        PurchaseOrder order = pending.isEmpty()
                ? orders.save(PurchaseOrder.builder().userId(user.getId()).courseId(c.getId()).amountCents(c.getPriceCents()).currency(c.getCurrency()).status(OrderStatus.PENDING).provider(provider.name()).build())
                : pending.get(0);
        CheckoutSession session = provider.createCheckout(order);
        if (session.providerRef() != null && order.getProviderRef() == null) { order.setProviderRef(session.providerRef()); orders.save(order); }
        return new Checkout(order, session);
    }

    public List<PurchaseOrder> mine(CurrentUser user) { return orders.findByUserIdOrderByCreatedAtDesc(user.getId()); }
    public List<PurchaseOrder> all(CurrentUser user) { if (!perm.isAdmin(user)) throw ApiException.forbidden("Only an admin can list all orders"); return orders.findAllByOrderByCreatedAtDesc(); }

    /** The order, only for its owner or an admin — never for another learner. */
    public PurchaseOrder get(CurrentUser user, String id) {
        PurchaseOrder o = orders.findById(id).orElseThrow(() -> ApiException.notFound("Order"));
        if (!o.getUserId().equals(user.getId()) && !perm.isAdmin(user)) throw ApiException.forbidden("Not your order");
        return o;
    }
    public List<Payment> paymentsOf(CurrentUser user, String orderId) { get(user, orderId); return payments.findByOrderIdOrderByCreatedAtDesc(orderId); }

    /** Learner abandons checkout. */
    public PurchaseOrder cancel(CurrentUser user, String id) {
        PurchaseOrder o = get(user, id);
        if (o.getStatus() != OrderStatus.PENDING) return o;
        return confirm(o, new PaymentResult(OrderStatus.CANCELLED, o.getProviderRef(), "Cancelled by the learner"));
    }

    /**
     * Development-only: the simulated checkout reports an outcome. Refused unless the mock provider is active, and
     * only the order's owner may drive it. Real providers report through their own (signed) callbacks.
     */
    public PurchaseOrder mockComplete(CurrentUser user, String id, String outcome) {
        if (!props.usesMock()) throw ApiException.notFound("Not available");
        PurchaseOrder o = get(user, id);
        if (!o.getUserId().equals(user.getId())) throw ApiException.forbidden("Not your order");
        OrderStatus s = switch (outcome == null ? "" : outcome.toLowerCase()) {
            case "success" -> OrderStatus.SUCCESS; case "failed", "fail" -> OrderStatus.FAILED; case "cancelled", "cancel" -> OrderStatus.CANCELLED;
            default -> throw ApiException.badRequest("outcome must be success, failed or cancelled");
        };
        return confirm(o, new PaymentResult(s, o.getProviderRef(), "Simulated by the mock provider"));
    }

    /**
     * Records the provider's verdict. Idempotent: a settled order ignores later reports. SUCCESS grants the
     * entitlement (enrolment with source PURCHASE) in this same transaction, so an order can never be paid without
     * access nor access granted without a paid order.
     */
    public PurchaseOrder confirm(PurchaseOrder o, PaymentResult result) {
        if (o.getStatus() != OrderStatus.PENDING) return o;
        if (result.status() == OrderStatus.PENDING) return o;
        payments.save(Payment.builder().orderId(o.getId()).provider(o.getProvider()).providerRef(result.providerRef()).status(result.status())
                .amountCents(o.getAmountCents()).currency(o.getCurrency()).detailJson(result.detail() == null ? null : "{\"detail\":\"" + result.detail().replace("\"", "'") + "\"}").build());
        o.setStatus(result.status());
        if (result.providerRef() != null) o.setProviderRef(result.providerRef());
        if (result.status() == OrderStatus.SUCCESS) {
            o.setPaidAt(Instant.now());
            Optional<Enrollment> existing = enrollments.findByUserIdAndCourseId(o.getUserId(), o.getCourseId());
            if (existing.isEmpty()) {
                enrollments.save(Enrollment.builder().userId(o.getUserId()).courseId(o.getCourseId()).status(EnrollmentStatus.NOT_STARTED)
                        .enrolledAt(Instant.now()).bookmarksJson("[]").source("PURCHASE").orderId(o.getId()).build());
            } else if (existing.get().getOrderId() == null) { existing.get().setSource("PURCHASE"); existing.get().setOrderId(o.getId()); enrollments.save(existing.get()); }
            Course c = courses.findById(o.getCourseId()).orElse(null);
            if (c != null) notifications.notify(o.getUserId(), "enrolment", "You now have access to " + c.getTitle(), "Your purchase is complete — start whenever you're ready.", "/learn/" + c.getId());
        }
        return orders.save(o);
    }
}
