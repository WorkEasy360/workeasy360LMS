package com.workeasy360.backend.payments;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Payment provider configuration (app.payments.* ← PAYMENTS_* environment variables). Secrets are held in memory only.
 * provider = none  → purchases are refused with 503 until a provider is configured (production default)
 * provider = mock  → local development/testing only; also requires mock-allowed=true (never set it in production)
 */
@Component
@ConfigurationProperties(prefix = "app.payments")
public class PaymentProperties {
    private String provider = "none";
    private boolean mockAllowed = false;
    private String apiKey = "";
    private String webhookSecret = "";
    private String currency = "INR";

    public String getProvider() { return provider == null || provider.isBlank() ? "none" : provider.trim().toLowerCase(); }
    public void setProvider(String provider) { this.provider = provider; }
    public boolean isMockAllowed() { return mockAllowed; }
    public void setMockAllowed(boolean mockAllowed) { this.mockAllowed = mockAllowed; }
    public String getApiKey() { return apiKey == null ? "" : apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public String getWebhookSecret() { return webhookSecret == null ? "" : webhookSecret; }
    public void setWebhookSecret(String webhookSecret) { this.webhookSecret = webhookSecret; }
    public String getCurrency() { return currency == null || currency.isBlank() ? "INR" : currency.trim().toUpperCase(); }
    public void setCurrency(String currency) { this.currency = currency; }
    /** True only when the mock provider is selected AND explicitly allowed. */
    public boolean usesMock() { return "mock".equals(getProvider()) && mockAllowed; }
}
