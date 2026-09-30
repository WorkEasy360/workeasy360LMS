package com.workeasy360.backend.ai;

/**
 * Provider-independent AI contract. Business logic (AiService) only sees this interface; the concrete provider is
 * chosen by configuration (AiProviderFactory). Providers return the model's raw text — parsing and structural
 * validation happen in AiValidation so every provider is held to the same contract.
 */
public interface AiProvider {
    record Prompt(String system, String user, int maxOutputTokens) {}
    record Completion(String text, String provider, String model) {}

    String name();
    String model();
    /** True when the provider can actually be called (e.g. an API key is configured). */
    boolean configured();

    Completion generateCourse(Prompt prompt) throws AiException;
    Completion generateQuiz(Prompt prompt) throws AiException;
    /** Grounded learning-coach turn (Prompts.COACH_SYSTEM); same contract, same validation downstream. */
    Completion generateCoach(Prompt prompt) throws AiException;

    /** Provider-level failure (network, auth, quota, timeout…). Carries whether a retry is sensible. */
    class AiException extends Exception {
        private final boolean retryable;
        public AiException(String message, boolean retryable) { super(message); this.retryable = retryable; }
        public AiException(String message, boolean retryable, Throwable cause) { super(message, cause); this.retryable = retryable; }
        public boolean isRetryable() { return retryable; }
    }
}
