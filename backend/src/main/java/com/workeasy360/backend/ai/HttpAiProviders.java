package com.workeasy360.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.util.Json;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Real HTTP providers. Both speak the vendor's public API with the JDK HttpClient (no SDK dependency) and are
 * selected only by configuration; nothing outside this package knows which vendor is in use.
 *  - openai:    OpenAI-compatible chat completions (also works for compatible gateways via AI_BASE_URL)
 *  - anthropic: Anthropic Messages API
 */
public final class HttpAiProviders {
    private HttpAiProviders() {}

    static abstract class Base implements AiProvider {
        protected final AiProperties props;
        protected final HttpClient http;
        Base(AiProperties props) { this.props = props; this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build(); }
        @Override public String model() { return props.getModel(); }
        @Override public boolean configured() { return !props.getApiKey().isBlank() && !props.getModel().isBlank(); }
        @Override public Completion generateCourse(Prompt p) throws AiException { return complete(p); }
        @Override public Completion generateQuiz(Prompt p) throws AiException { return complete(p); }
        @Override public Completion generateCoach(Prompt p) throws AiException { return complete(p); }
        protected abstract Completion complete(Prompt p) throws AiException;

        protected String send(HttpRequest req) throws AiException {
            if (!configured()) throw new AiException("AI provider '" + name() + "' is not configured (AI_API_KEY / AI_MODEL)", false);
            try {
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                int s = res.statusCode();
                if (s == 401 || s == 403) throw new AiException("AI provider rejected the API key (HTTP " + s + ")", false);
                if (s == 429 || s >= 500) throw new AiException("AI provider unavailable (HTTP " + s + ")", true);
                if (s >= 400) throw new AiException("AI provider rejected the request (HTTP " + s + ")", false);
                return res.body();
            } catch (java.net.http.HttpTimeoutException e) { throw new AiException("AI provider timed out after " + props.getTimeoutSeconds() + "s", true, e); }
            catch (IOException e) { throw new AiException("Could not reach the AI provider: " + e.getMessage(), true, e); }
            catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new AiException("Interrupted while waiting for the AI provider", false, e); }
        }
    }

    public static final class OpenAiCompatible extends Base {
        public OpenAiCompatible(AiProperties props) { super(props); }
        @Override public String name() { return "openai"; }
        @Override protected Completion complete(Prompt p) throws AiException {
            String base = props.getBaseUrl().isBlank() ? "https://api.openai.com/v1" : props.getBaseUrl().replaceAll("/+$", "");
            ObjectNode body = Json.MAPPER.createObjectNode();
            body.put("model", props.getModel());
            body.put("temperature", 0.4);
            body.put("max_tokens", p.maxOutputTokens());
            body.putObject("response_format").put("type", "json_object");
            ArrayNode msgs = body.putArray("messages");
            msgs.addObject().put("role", "system").put("content", p.system());
            msgs.addObject().put("role", "user").put("content", p.user());
            HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/chat/completions")).timeout(Duration.ofSeconds(props.getTimeoutSeconds()))
                    .header("Content-Type", "application/json").header("Authorization", "Bearer " + props.getApiKey())
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
            JsonNode res = Json.read(send(req));
            String text = res.path("choices").path(0).path("message").path("content").asText(null);
            if (text == null) throw new AiException("AI provider returned an unexpected response shape", true);
            return new Completion(text, name(), res.path("model").asText(props.getModel()));
        }
    }

    public static final class Anthropic extends Base {
        public Anthropic(AiProperties props) { super(props); }
        @Override public String name() { return "anthropic"; }
        @Override protected Completion complete(Prompt p) throws AiException {
            String base = props.getBaseUrl().isBlank() ? "https://api.anthropic.com" : props.getBaseUrl().replaceAll("/+$", "");
            ObjectNode body = Json.MAPPER.createObjectNode();
            body.put("model", props.getModel());
            body.put("max_tokens", p.maxOutputTokens());
            body.put("temperature", 0.4);
            body.put("system", p.system());
            body.putArray("messages").addObject().put("role", "user").put("content", p.user());
            HttpRequest req = HttpRequest.newBuilder(URI.create(base + "/v1/messages")).timeout(Duration.ofSeconds(props.getTimeoutSeconds()))
                    .header("Content-Type", "application/json").header("x-api-key", props.getApiKey()).header("anthropic-version", "2023-06-01")
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
            JsonNode res = Json.read(send(req));
            StringBuilder text = new StringBuilder();
            for (JsonNode part : res.path("content")) if ("text".equals(part.path("type").asText())) text.append(part.path("text").asText());
            if (text.isEmpty()) throw new AiException("AI provider returned an unexpected response shape", true);
            return new Completion(text.toString(), name(), res.path("model").asText(props.getModel()));
        }
    }
}
