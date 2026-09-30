package com.workeasy360.backend.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI configuration (application.yml `app.ai.*`, fed from AI_ENABLED / AI_PROVIDER / AI_API_KEY / AI_MODEL / AI_BASE_URL …).
 * The API key is only ever held here in memory — it is never persisted or returned by any endpoint.
 */
@ConfigurationProperties(prefix = "app.ai")
public class AiProperties {
    private boolean enabled = false;
    private String provider = "mock";
    private String apiKey = "";
    private String model = "";
    private String baseUrl = "";
    private int timeoutSeconds = 60;
    private int maxInputChars = 12000;
    private int maxOutputTokens = 4000;
    private int maxQuestions = 25;
    private int dedupeMinutes = 10;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getProvider() { return provider == null || provider.isBlank() ? "mock" : provider.trim().toLowerCase(); }
    public void setProvider(String provider) { this.provider = provider; }
    public String getApiKey() { return apiKey == null ? "" : apiKey; }
    public void setApiKey(String apiKey) { this.apiKey = apiKey; }
    public String getModel() { return model == null ? "" : model; }
    public void setModel(String model) { this.model = model; }
    public String getBaseUrl() { return baseUrl == null ? "" : baseUrl; }
    public void setBaseUrl(String baseUrl) { this.baseUrl = baseUrl; }
    public int getTimeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(int timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
    public int getMaxInputChars() { return maxInputChars; }
    public void setMaxInputChars(int maxInputChars) { this.maxInputChars = maxInputChars; }
    public int getMaxOutputTokens() { return maxOutputTokens; }
    public void setMaxOutputTokens(int maxOutputTokens) { this.maxOutputTokens = maxOutputTokens; }
    public int getMaxQuestions() { return maxQuestions; }
    public void setMaxQuestions(int maxQuestions) { this.maxQuestions = maxQuestions; }
    public int getDedupeMinutes() { return dedupeMinutes; }
    public void setDedupeMinutes(int dedupeMinutes) { this.dedupeMinutes = dedupeMinutes; }

    /** Mock is used whenever AI is disabled, or explicitly selected. */
    public boolean usesMock() { return !enabled || "mock".equals(getProvider()); }
}
