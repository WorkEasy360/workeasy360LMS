package com.workeasy360.backend.payments;

import com.workeasy360.backend.domain.CommerceEntities.PurchaseOrder;
import com.workeasy360.backend.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;

import java.util.UUID;

/** The built-in providers and the factory that picks one from configuration. */
@Configuration
public class PaymentProviders {
    private static final Logger log = LoggerFactory.getLogger(PaymentProviders.class);

    /** Production default: no provider configured → purchases fail safely (503), nothing is ever marked paid. */
    public static final class Unavailable implements PaymentProvider {
        private final String reason;
        Unavailable(String reason) { this.reason = reason; }
        public String name() { return "none"; }
        public boolean available() { return false; }
        public CheckoutSession createCheckout(PurchaseOrder order) { throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, reason); }
    }

    /**
     * Development-only simulated checkout: the in-app checkout page lets the developer choose the outcome, which is
     * then recorded through the same confirmation path a real provider's webhook would use.
     */
    public static final class Mock implements PaymentProvider {
        public String name() { return "mock"; }
        public boolean available() { return true; }
        public CheckoutSession createCheckout(PurchaseOrder order) { return new CheckoutSession("mock", null, "mock_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20)); }
    }

    @Bean
    public PaymentProvider paymentProvider(PaymentProperties props) {
        switch (props.getProvider()) {
            case "mock":
                if (!props.isMockAllowed()) {
                    log.warn("PAYMENTS_PROVIDER=mock but PAYMENTS_MOCK_ALLOWED is not true: purchases are disabled. The mock provider is for local development only.");
                    return new Unavailable("Payments are not configured on this server.");
                }
                log.warn("Payments use the MOCK provider (development only): no money moves and any outcome can be simulated.");
                return new Mock();
            case "none":
                log.info("Payments: no provider configured; paid courses can be viewed but not purchased until PAYMENTS_PROVIDER is set.");
                return new Unavailable("Payments are not configured on this server.");
            default:
                log.warn("Payments: provider '{}' has no implementation in this build; purchases are disabled.", props.getProvider());
                return new Unavailable("Payment provider '" + props.getProvider() + "' is not available.");
        }
    }
}
