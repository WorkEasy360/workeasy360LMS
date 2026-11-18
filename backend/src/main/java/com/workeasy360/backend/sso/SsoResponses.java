package com.workeasy360.backend.sso;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

/**
 * Error answers written by security filters, which run before the controller advice can shape them. Same shape as
 * {@code web.ApiError} ({@code status}, {@code error}, {@code message}, {@code path}, {@code timestamp}), which
 * the app already renders, plus a machine-readable {@code code} (and the provider's {@code reason}) where the client
 * needs to branch on one.
 */
public final class SsoResponses {

    private final ObjectMapper objectMapper;

    public SsoResponses(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(HttpServletRequest request, HttpServletResponse response, HttpStatus status, String code,
                      String message, String reason) throws IOException {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", status.value());
        body.put("error", status.getReasonPhrase());
        body.put("message", message);
        body.put("path", request.getRequestURI());
        body.put("timestamp", Instant.now().toString());
        if (code != null) {
            body.put("code", code);
        }
        if (reason != null) {
            body.put("reason", reason);
        }
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Cache-Control", "no-store");
        response.getWriter().write(objectMapper.writeValueAsString(body));
    }

    /** 401: nobody is signed in, or the session or token no longer grants access. */
    public void unauthenticated(HttpServletRequest request, HttpServletResponse response, String code)
            throws IOException {
        write(request, response, HttpStatus.UNAUTHORIZED, code, "Sign in to continue", null);
    }
}
