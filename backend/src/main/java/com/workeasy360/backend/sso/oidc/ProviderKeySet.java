package com.workeasy360.backend.sso.oidc;

import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import java.io.IOException;
import java.text.ParseException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;

/**
 * Workeasy360's published signing keys (the {@code jwks_uri} of its discovery document), for verifying the
 * logout tokens it sends to the back-channel logout endpoint. (ID tokens are verified by Spring's decoder,
 * which keeps its own copy: see {@link IdTokenDecoderFactory}.)
 *
 * <ul>
 *   <li>The set is read with the deadline-bounded, redirect-free {@link ProviderHttp} and reused for
 *       {@link #TTL}. If a scheduled re-read fails, the set already held keeps being used.
 *   <li>A {@code kid} the set does not have makes it re-read the set <strong>once</strong>: that is how a
 *       key rotation is followed. Such forced re-reads are at least {@link #MIN_FORCED_REFRESH_INTERVAL}
 *       apart, so a stream of tokens naming made-up keys cannot turn WorkEasyLMS into a request amplifier
 *       against Workeasy360. Inside that interval the answer is "cannot tell now" ({@link Unavailable}),
 *       never "no such key": a genuine token signed with a brand-new key is then retried by Workeasy360
 *       instead of being refused for good.
 *   <li>Only public signature keys are kept ({@code use} absent or {@code sig}).
 * </ul>
 */
public class ProviderKeySet {

    static final Duration TTL = Duration.ofHours(1);
    static final Duration MIN_FORCED_REFRESH_INTERVAL = Duration.ofSeconds(30);

    private static final Logger log = LoggerFactory.getLogger(ProviderKeySet.class);

    private final Workeasy360Provider provider;
    private final Clock clock;
    private final ReentrantLock lock = new ReentrantLock();

    private volatile Snapshot snapshot;
    private volatile Instant lastForcedRefresh = Instant.MIN;

    public ProviderKeySet(Workeasy360Provider provider, Clock clock) {
        this.provider = provider;
        this.clock = clock;
    }

    private record Snapshot(String uri, List<JWK> keys, Instant fetchedAt) {
    }

    /** The key set cannot be read (or re-read) right now: the token can neither be accepted nor refused. */
    public static final class Unavailable extends Exception {

        private static final long serialVersionUID = 1L;

        Unavailable(String reason) {
            super(reason, null, false, false);
        }
    }

    /**
     * The published signature key with this {@code kid}.
     *
     * @return the key, or {@code null} when Workeasy360 does not publish one with that {@code kid}, even after
     *         re-reading the set
     * @throws Unavailable when the set (or Workeasy360's discovery document) cannot be read, or a re-read for
     *         an unknown {@code kid} happened less than {@link #MIN_FORCED_REFRESH_INTERVAL} ago
     */
    public JWK find(String kid) throws Unavailable {
        String uri = jwksUri();
        Snapshot current = snapshot;
        if (current == null || !current.uri().equals(uri) || !isFresh(current, clock.instant())) {
            current = load(uri, false);
        }
        JWK key = lookup(current, kid);
        if (key != null) {
            return key;
        }
        lock.lock();
        try {
            Snapshot latest = snapshot;
            if (latest != null && latest != current) {
                // Another request re-read the set while this one waited.
                key = lookup(latest, kid);
                if (key != null) {
                    return key;
                }
            }
            Instant now = clock.instant();
            if (now.isBefore(lastForcedRefresh.plus(MIN_FORCED_REFRESH_INTERVAL))) {
                throw new Unavailable("the key set was re-read moments ago");
            }
            lastForcedRefresh = now;
            return lookup(load(uri, true), kid);
        } finally {
            lock.unlock();
        }
    }

    /** Drops the cached set and the re-read limit (tests, and a deliberate refresh). */
    public void forget() {
        snapshot = null;
        lastForcedRefresh = Instant.MIN;
    }

    private String jwksUri() throws Unavailable {
        try {
            String uri = provider.registration().getProviderDetails().getJwkSetUri();
            if (uri == null || uri.isBlank()) {
                throw new Unavailable("the discovery document names no key set");
            }
            return uri;
        } catch (OAuth2AuthenticationException unavailable) {
            throw new Unavailable("Workeasy360 cannot be discovered");
        }
    }

    private boolean isFresh(Snapshot current, Instant now) {
        return now.isBefore(current.fetchedAt().plus(TTL));
    }

    /**
     * Reads the set, one request at a time. A scheduled re-read that fails keeps the set already held; a forced
     * one (an unknown {@code kid}) or a first read that fails is {@link Unavailable}.
     */
    private Snapshot load(String uri, boolean forced) throws Unavailable {
        lock.lock();
        try {
            Snapshot current = snapshot;
            Instant now = clock.instant();
            if (!forced && current != null && current.uri().equals(uri) && isFresh(current, now)) {
                return current;
            }
            try {
                Snapshot fetched = new Snapshot(uri, fetch(uri), now);
                snapshot = fetched;
                return fetched;
            } catch (IOException | ParseException | RuntimeException failure) {
                log.warn("workeasy360.jwks_unavailable reason={}", failure instanceof IOException
                        ? failure.getMessage() : failure.getClass().getSimpleName());
                if (!forced && current != null && current.uri().equals(uri)) {
                    return current;
                }
                throw new Unavailable("the key set cannot be read");
            }
        } finally {
            lock.unlock();
        }
    }

    private List<JWK> fetch(String uri) throws IOException, ParseException {
        ProviderHttp.Response response = provider.http().get(uri);
        if (response.status() != 200 || response.body().isEmpty()) {
            throw new IOException("the key set answered " + response.status());
        }
        List<JWK> keys = new ArrayList<>();
        for (JWK key : JWKSet.parse(response.body()).getKeys()) {
            if (key.getKeyID() != null && (key.getKeyUse() == null || KeyUse.SIGNATURE.equals(key.getKeyUse()))) {
                keys.add(key.toPublicJWK());
            }
        }
        return List.copyOf(keys);
    }

    private static JWK lookup(Snapshot current, String kid) {
        for (JWK key : current.keys()) {
            if (kid.equals(key.getKeyID())) {
                return key;
            }
        }
        return null;
    }
}
