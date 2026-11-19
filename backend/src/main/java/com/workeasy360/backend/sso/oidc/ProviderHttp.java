package com.workeasy360.backend.sso.oidc;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Collectors;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.AbstractClientHttpRequest;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.ClientHttpResponse;

/**
 * The one HTTP client used for every call this application makes to Workeasy360: discovery, the key set, the
 * token endpoint and the entitlement API.
 *
 * <p>What makes it safe to point at a server that may misbehave:
 * <ul>
 *   <li>an <strong>overall deadline</strong> on each call, covering connecting, the headers <em>and the whole
 *       body</em> (the JDK's per-request timeout stops at the headers, so a server that sends headers and
 *       then stalls would hang the thread); on expiry the request is cancelled;
 *   <li>it never follows a redirect (a redirect from the key set or token endpoint is an error, not a detour);
 *   <li>the body is capped at {@link #MAX_BODY_BYTES};
 *   <li>only {@code http} and {@code https} URLs, and only ones taken from the configured issuer or its
 *       discovery document, never anything a browser sent.
 * </ul>
 */
public class ProviderHttp {

    /** A body larger than this is not a discovery document, a key set or an entitlement answer. */
    static final int MAX_BODY_BYTES = 256 * 1024;

    /** Headers the JDK client sets itself and refuses to be given. */
    private static final Set<String> RESTRICTED = Set.of("content-length", "host", "connection", "expect", "upgrade");

    private static final TypeReference<Map<String, Object>> JSON_OBJECT = new TypeReference<>() { };

    private final HttpClient client;
    private final ObjectMapper objectMapper;
    private final Duration timeout;

    public ProviderHttp(Duration timeout, ObjectMapper objectMapper) {
        this.timeout = timeout;
        this.objectMapper = objectMapper;
        this.client = HttpClient.newBuilder()
                .connectTimeout(timeout)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }

    public Duration timeout() {
        return timeout;
    }

    /** A raw answer: status, headers, and at most {@link #MAX_BODY_BYTES} of body. */
    public record Raw(int status, Map<String, List<String>> headers, byte[] body) {
    }

    /** The status and the JSON object of the body, or an empty map when the body is not one. */
    public record Response(int status, Map<String, Object> body) {
    }

    public Response get(String url) throws IOException {
        return json(exchange("GET", url, Map.of("Accept", List.of("application/json")), null));
    }

    public Response postForm(String url, Map<String, String> form) throws IOException {
        String encoded = form.entrySet().stream()
                .map(entry -> URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8) + "="
                        + URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        return json(exchange("POST", url, Map.of(
                "Content-Type", List.of("application/x-www-form-urlencoded"),
                "Accept", List.of("application/json")), encoded.getBytes(StandardCharsets.UTF_8)));
    }

    /**
     * One call with an overall deadline.
     *
     * @throws IOException on any failure, including the deadline passing
     */
    public Raw exchange(String method, String url, Map<String, List<String>> headers, byte[] body)
            throws IOException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(uri(url)).timeout(timeout);
        headers.forEach((name, values) -> {
            if (!RESTRICTED.contains(name.toLowerCase(Locale.ROOT))) {
                values.forEach(value -> builder.header(name, value));
            }
        });
        builder.method(method, body == null
                ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofByteArray(body));
        // The body handler completes the future only when the whole body has arrived, so the get() below is a
        // deadline for the entire exchange. (Capped: anything past the limit is dropped, then rejected.)
        CompletableFuture<HttpResponse<byte[]>> pending = client.sendAsync(builder.build(),
                info -> new LimitedBytes());
        try {
            HttpResponse<byte[]> response = pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            return new Raw(response.statusCode(), response.headers().map(), response.body());
        } catch (TimeoutException expired) {
            pending.cancel(true);
            throw new IOException("no complete response within " + timeout.toMillis() + " ms");
        } catch (ExecutionException failed) {
            pending.cancel(true);
            if (failed.getCause() instanceof BodyTooLarge) {
                throw new IOException("response body too large");
            }
            throw new IOException("request failed: " + failed.getCause().getClass().getSimpleName());
        } catch (InterruptedException interrupted) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new IOException("interrupted");
        }
    }

    /** The body exceeded {@link #MAX_BODY_BYTES}. */
    private static final class BodyTooLarge extends IOException {
        private static final long serialVersionUID = 1L;
    }

    /** Collects the body, and gives up (cancelling the stream) as soon as it passes the limit. */
    private static final class LimitedBytes implements HttpResponse.BodySubscriber<byte[]> {

        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream collected = new ByteArrayOutputStream();
        private Flow.Subscription subscription;

        @Override
        public CompletionStage<byte[]> getBody() {
            return result;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            subscription.request(Long.MAX_VALUE);
        }

        @Override
        public void onNext(List<ByteBuffer> items) {
            if (result.isDone()) {
                return;
            }
            for (ByteBuffer item : items) {
                if (collected.size() + item.remaining() > MAX_BODY_BYTES) {
                    subscription.cancel();
                    result.completeExceptionally(new BodyTooLarge());
                    return;
                }
                byte[] chunk = new byte[item.remaining()];
                item.get(chunk);
                collected.write(chunk, 0, chunk.length);
            }
        }

        @Override
        public void onError(Throwable failure) {
            result.completeExceptionally(failure);
        }

        @Override
        public void onComplete() {
            result.complete(collected.toByteArray());
        }
    }

    private Response json(Raw raw) {
        return new Response(raw.status(), parse(raw.body()));
    }

    private Map<String, Object> parse(byte[] raw) {
        if (raw.length == 0) {
            return Map.of();
        }
        try {
            Map<String, Object> parsed = objectMapper.readValue(raw, JSON_OBJECT);
            return parsed == null ? Map.of() : parsed;
        } catch (IOException notJson) {
            return Map.of();
        }
    }

    private static URI uri(String url) throws IOException {
        URI uri;
        try {
            uri = URI.create(url);
        } catch (IllegalArgumentException invalid) {
            throw new IOException("invalid URL");
        }
        if (uri.getScheme() == null || !(uri.getScheme().equals("https") || uri.getScheme().equals("http"))
                || uri.getHost() == null) {
            throw new IOException("refusing a non-HTTP URL");
        }
        return uri;
    }

    /**
     * The same deadline-bounded, redirect-free client as a Spring {@link ClientHttpRequestFactory}, for the
     * libraries that fetch from Workeasy360 on their own: the key-set fetch of the ID-token decoder and the
     * token request.
     */
    public ClientHttpRequestFactory asRequestFactory() {
        return (URI target, HttpMethod method) -> new DeadlineRequest(target, method);
    }

    private final class DeadlineRequest extends AbstractClientHttpRequest {

        private final URI target;
        private final HttpMethod method;
        private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();

        DeadlineRequest(URI target, HttpMethod method) {
            this.target = target;
            this.method = method;
        }

        @Override
        public HttpMethod getMethod() {
            return method;
        }

        @Override
        public URI getURI() {
            return target;
        }

        @Override
        protected OutputStream getBodyInternal(HttpHeaders headers) {
            return buffer;
        }

        @Override
        protected ClientHttpResponse executeInternal(HttpHeaders headers) throws IOException {
            Map<String, List<String>> sent = new LinkedHashMap<>(headers);
            byte[] body = buffer.size() == 0 && !HttpMethod.POST.equals(method) ? null : buffer.toByteArray();
            return new RawResponse(exchange(method.name(), target.toString(), sent, body));
        }
    }

    private static final class RawResponse implements ClientHttpResponse {

        private final Raw raw;

        RawResponse(Raw raw) {
            this.raw = raw;
        }

        @Override
        public HttpStatusCode getStatusCode() {
            return HttpStatusCode.valueOf(raw.status());
        }

        @Override
        public String getStatusText() {
            return "";
        }

        @Override
        public HttpHeaders getHeaders() {
            HttpHeaders headers = new HttpHeaders();
            raw.headers().forEach((name, values) -> {
                if (!name.startsWith(":")) {
                    headers.addAll(name, values);
                }
            });
            return headers;
        }

        @Override
        public InputStream getBody() {
            return new ByteArrayInputStream(raw.body());
        }

        @Override
        public void close() {
            // Nothing is held open: the body is already in memory.
        }
    }
}
