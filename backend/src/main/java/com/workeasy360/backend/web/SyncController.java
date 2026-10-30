package com.workeasy360.backend.web;

import com.workeasy360.backend.security.CurrentUser;
import com.workeasy360.backend.service.SyncService;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.Map;

/**
 * Real-time stream endpoints. The authenticated client first asks for a one-time ticket, then opens the SSE stream
 * with it — EventSource cannot send headers, and this keeps the real JWT out of query strings and access logs.
 */
@RestController
@RequestMapping("/api/sync")
public class SyncController {
    private final SyncService sync;
    public SyncController(SyncService sync) { this.sync = sync; }

    @PostMapping("/ticket")
    public Map<String, Object> ticket(@AuthenticationPrincipal CurrentUser me) {
        if (me == null) throw ApiException.forbidden("Sign in to continue");
        return Map.of("ticket", sync.issueTicket(me.getId(), me.getRole(), me.getOrgId()), "expiresSeconds", 60);
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@RequestParam(required = false) String ticket) {
        SseEmitter emitter = sync.connect(ticket);
        if (emitter == null) throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED, "Invalid or expired stream ticket");
        return emitter;
    }
}
