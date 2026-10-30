package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Enums.Role;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Real-time synchronization over Server-Sent Events. Browsers hold one stream each; after a successful write the
 * backend pushes a small "this kind of data changed" event and every authorized client re-pulls through the normal
 * (authorized) REST endpoints. Events carry metadata only — type, actor, time — never records, so nothing sensitive
 * can leak to a listener whose pull would have been refused.
 *
 * Delivery is scoped per organization and, for high-frequency learning events, narrowed to staff plus the acting
 * learner so one learner's every click is not broadcast to the whole organization. Publishing inside a transaction
 * is deferred to afterCommit, so rolled-back work is never announced.
 *
 * The stream endpoint authenticates with a one-time short-lived ticket (EventSource cannot send an Authorization
 * header, and putting the real JWT in a query string would write it into access logs).
 */
@Service
public class SyncService {
    private static final Logger log = LoggerFactory.getLogger(SyncService.class);
    private static final long TICKET_TTL_MS = 60_000;
    private static final long STREAM_TTL_MS = 2 * 60 * 60 * 1000L; // the client reconnects with a fresh ticket

    public enum Audience { ORG, STAFF_AND_ACTOR, USER }

    private record Ticket(String userId, Role role, String orgId, long expiresAt) {}
    private static final class Client {
        final SseEmitter emitter; final String userId; final Role role; final String orgId; final long openedAt = System.currentTimeMillis();
        Client(SseEmitter emitter, String userId, Role role, String orgId) { this.emitter = emitter; this.userId = userId; this.role = role; this.orgId = orgId; }
    }

    private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<Client> clients = new CopyOnWriteArrayList<>();
    private final SecureRandom random = new SecureRandom();
    private final AtomicLong seq = new AtomicLong();

    public SyncService() {
        ScheduledExecutorService housekeeping = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "sync-heartbeat"); t.setDaemon(true); return t;
        });
        housekeeping.scheduleAtFixedRate(this::heartbeat, 25, 25, TimeUnit.SECONDS);
    }

    /** One-time ticket the authenticated client exchanges for a stream connection. */
    public String issueTicket(String userId, Role role, String orgId) {
        byte[] b = new byte[32]; random.nextBytes(b);
        String ticket = Base64.getUrlEncoder().withoutPadding().encodeToString(b);
        tickets.put(ticket, new Ticket(userId, role, orgId, System.currentTimeMillis() + TICKET_TTL_MS));
        tickets.entrySet().removeIf(e -> e.getValue().expiresAt() < System.currentTimeMillis());
        return ticket;
    }

    /** Consumes the ticket (single use) and registers the SSE stream. Null when the ticket is unknown or expired. */
    public SseEmitter connect(String ticket) {
        Ticket t = ticket == null ? null : tickets.remove(ticket);
        if (t == null || t.expiresAt() < System.currentTimeMillis()) return null;
        SseEmitter emitter = new SseEmitter(STREAM_TTL_MS);
        Client client = new Client(emitter, t.userId(), t.role(), t.orgId());
        emitter.onCompletion(() -> clients.remove(client));
        emitter.onTimeout(() -> { clients.remove(client); emitter.complete(); });
        emitter.onError((ex) -> clients.remove(client));
        clients.add(client);
        try {
            emitter.send(SseEmitter.event().name("hello").data("{\"at\":" + Instant.now().toEpochMilli() + "}"));
        } catch (Exception e) { clients.remove(client); return null; }
        return emitter;
    }

    /** Publishes after the surrounding transaction commits (immediately when there is none). */
    public void publish(String orgId, String type, Audience audience, String actorId, String targetUserId) {
        Runnable send = () -> deliver(orgId, type, audience, actorId, targetUserId);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { send.run(); }
            });
        } else send.run();
    }

    private void deliver(String orgId, String type, Audience audience, String actorId, String targetUserId) {
        String json = "{\"id\":" + seq.incrementAndGet() + ",\"type\":\"" + type + "\",\"actorId\":\"" + (actorId == null ? "" : actorId)
                + "\",\"at\":" + Instant.now().toEpochMilli() + "}";
        for (Client c : clients) {
            if (!c.orgId.equals(orgId)) continue;
            boolean wanted = switch (audience) {
                case ORG -> true;
                case STAFF_AND_ACTOR -> c.role != Role.LEARNER || c.userId.equals(actorId);
                case USER -> c.userId.equals(targetUserId);
            };
            if (!wanted) continue;
            try {
                c.emitter.send(SseEmitter.event().name("sync").data(json));
            } catch (Exception e) {
                clients.remove(c);
                try { c.emitter.complete(); } catch (Exception ignored) {}
            }
        }
    }

    /** Keeps proxies from closing idle streams and evicts dead connections. */
    private void heartbeat() {
        long now = System.currentTimeMillis();
        for (Iterator<Client> it = clients.iterator(); it.hasNext(); ) {
            Client c = it.next();
            try {
                if (now - c.openedAt > STREAM_TTL_MS) { clients.remove(c); c.emitter.complete(); continue; }
                c.emitter.send(SseEmitter.event().comment("ping"));
            } catch (Exception e) {
                clients.remove(c);
                try { c.emitter.complete(); } catch (Exception ignored) {}
            }
        }
    }

    public int connectedClients() { return clients.size(); }

    /** Drops every open stream for a user (sign-out everywhere, deletion, role change). */
    public void disconnectUser(String userId) {
        for (Client c : clients) {
            if (c.userId.equals(userId)) { clients.remove(c); try { c.emitter.complete(); } catch (Exception ignored) {} }
        }
    }
}
