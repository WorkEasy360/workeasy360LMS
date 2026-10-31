package com.workeasy360.backend.web;

import com.workeasy360.backend.domain.CommerceEntities.Payment;
import com.workeasy360.backend.domain.CommerceEntities.PurchaseOrder;
import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.Enrollment;
import com.workeasy360.backend.repo.Repos.CourseRepo;
import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.AccessService;
import com.workeasy360.backend.service.OrderService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Course access + purchase API. Ownership is enforced in OrderService; the mock outcome endpoint only exists with the mock provider. */
@RestController
public class OrderController {
    public record OrderDto(String id, String courseId, String courseTitle, int amountCents, String currency, String status, String provider, Instant createdAt, Instant paidAt) {
        static OrderDto of(PurchaseOrder o, String title) { return new OrderDto(o.getId(), o.getCourseId(), title, o.getAmountCents(), o.getCurrency(), o.getStatus().name(), o.getProvider(), o.getCreatedAt(), o.getPaidAt()); }
    }
    public record CheckoutDto(OrderDto order, String mode, String checkoutUrl) {}
    public record PaymentDto(String id, String status, String provider, Instant createdAt) { static PaymentDto of(Payment p) { return new PaymentDto(p.getId(), p.getStatus().name(), p.getProvider(), p.getCreatedAt()); } }
    public record AccessDto(String courseId, boolean free, int priceCents, String currency, boolean entitled, String source, boolean canAccess, boolean canPurchase, String pendingOrderId) {}
    public record CreateOrderRequest(String courseId) {}
    public record OutcomeRequest(String outcome) {}

    private final OrderService service; private final AccessService access; private final CourseRepo courses;
    public OrderController(OrderService service, AccessService access, CourseRepo courses) { this.service = service; this.access = access; this.courses = courses; }

    private String title(String courseId) { return courses.findById(courseId).map(Course::getTitle).orElse("Course"); }

    @GetMapping("/api/courses/{id}/access")
    public AccessDto courseAccess(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) {
        Course c = courses.findById(id).orElseThrow(() -> ApiException.notFound("Course"));
        if (c.getOrgId() != null && !c.getOrgId().equals(u.getOrgId())) throw ApiException.notFound("Course");
        Enrollment e = access.entitlement(u, c).orElse(null);
        boolean free = AccessService.isFree(c), can = access.canAccessContent(u, c);
        String pending = service.mine(u).stream().filter(o -> o.getCourseId().equals(id) && o.getStatus().name().equals("PENDING")).map(PurchaseOrder::getId).findFirst().orElse(null);
        return new AccessDto(id, free, c.getPriceCents(), c.getCurrency(), e != null, e == null ? null : e.getSource(), can, !free && !can && service.provider().available(), pending);
    }

    @GetMapping("/api/payments/status")
    public Map<String, Object> paymentsStatus() {
        return Map.of("provider", service.provider().name(), "available", service.provider().available(), "mock", service.props().usesMock(), "currency", service.props().getCurrency());
    }

    @PostMapping("/api/orders")
    public CheckoutDto create(@AuthenticationPrincipal CurrentUser u, @RequestBody CreateOrderRequest req) {
        if (req == null || req.courseId() == null) throw ApiException.badRequest("courseId is required");
        OrderService.Checkout c = service.start(u, req.courseId());
        return new CheckoutDto(OrderDto.of(c.order(), title(c.order().getCourseId())), c.session().mode(), c.session().checkoutUrl());
    }

    @GetMapping("/api/orders")
    public List<OrderDto> list(@AuthenticationPrincipal CurrentUser u, @RequestParam(defaultValue = "false") boolean all) {
        return (all ? service.all(u) : service.mine(u)).stream().map(o -> OrderDto.of(o, title(o.getCourseId()))).toList();
    }

    @GetMapping("/api/orders/{id}")
    public OrderDto get(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { PurchaseOrder o = service.get(u, id); return OrderDto.of(o, title(o.getCourseId())); }

    @GetMapping("/api/orders/{id}/payments")
    public List<PaymentDto> payments(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { return service.paymentsOf(u, id).stream().map(PaymentDto::of).toList(); }

    @PostMapping("/api/orders/{id}/cancel")
    public OrderDto cancel(@AuthenticationPrincipal CurrentUser u, @PathVariable String id) { PurchaseOrder o = service.cancel(u, id); return OrderDto.of(o, title(o.getCourseId())); }

    /** Development only (mock provider): simulate the provider's outcome for the learner's own order. */
    @PostMapping("/api/orders/{id}/mock-outcome")
    public OrderDto mockOutcome(@AuthenticationPrincipal CurrentUser u, @PathVariable String id, @RequestBody OutcomeRequest req) {
        PurchaseOrder o = service.mockComplete(u, id, req == null ? null : req.outcome()); return OrderDto.of(o, title(o.getCourseId()));
    }
}
