package com.workeasy360.backend.sso.entitlement;

import com.workeasy360.backend.sso.oidc.ProviderHttp;
import com.workeasy360.backend.sso.oidc.Workeasy360Provider;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * One question to WorkEasy360's entitlement API ({@code workeasy360_entitlement_endpoint} from discovery): may this
 * organization (and, with a {@code subject}, this person in it) still use WorkEasyLMS, and may they write?
 *
 * <p>There is no product parameter: the product is whoever the client assertion proves this is. The <em>read</em>
 * question is asked (no {@code write} parameter): WorkEasy360 then answers {@code allow} for a read-only organization
 * with {@code write_allowed: false}, whereas the write question would be answered {@code deny}.
 *
 * <p>Anything that is not an answer is one of two exceptions, and the difference matters: {@link Unavailable} is an
 * outage (5xx, 429, timeout, network, a misconfigured discovery, an unreadable key) and is <em>never</em> a denial;
 * {@link Refused} means WorkEasy360 answered and refused this product's own client (400, 401, 403: a revoked
 * credential, a suspended integration), which must not lapse into access.
 */
public class EntitlementClient {

    /** The decision document. */
    public record Answer(boolean allowed, boolean writeAllowed, String reason, Integer revalidateAfter) {
    }

    public static class Unavailable extends Exception {
        private static final long serialVersionUID = 1L;

        public Unavailable(String message) {
            super(message);
        }
    }

    /** HTTP 429: right after a refusal, most likely the same refusal seen through the failure limiter. */
    public static class RateLimited extends Unavailable {
        private static final long serialVersionUID = 1L;

        public RateLimited(String message) {
            super(message);
        }
    }

    public static class Refused extends Exception {
        private static final long serialVersionUID = 1L;

        public Refused(String message) {
            super(message);
        }
    }

    private final Workeasy360Provider provider;

    public EntitlementClient(Workeasy360Provider provider) {
        this.provider = provider;
    }

    /**
     * @param subject the {@code sub} the person signed in with, or {@code null} to ask about the organization only
     *                (people of a linked tenant who signed in with a WorkEasyLMS password)
     */
    public Answer ask(UUID organizationId, String subject) throws Unavailable, Refused {
        String endpoint;
        Map<String, String> form = new LinkedHashMap<>();
        try {
            endpoint = provider.metadataString("workeasy360_entitlement_endpoint");
            if (endpoint == null) {
                throw new Unavailable("discovery has no workeasy360_entitlement_endpoint");
            }
            form.put("organization_id", organizationId.toString());
            if (subject != null) {
                form.put("subject", subject);
            }
            form.put("client_assertion_type", Workeasy360Provider.assertionType());
            form.put("client_assertion", provider.clientAssertion());
        } catch (Unavailable unavailable) {
            throw unavailable;
        } catch (RuntimeException exception) {
            // Discovery failed or the key is unreadable: not an answer, and not a denial.
            throw new Unavailable(exception.getClass().getSimpleName());
        }
        ProviderHttp.Response response;
        try {
            response = provider.http().postForm(endpoint, form);
        } catch (IOException exception) {
            throw new Unavailable("no response: " + exception.getClass().getSimpleName());
        }
        Object decision = response.body().get("decision");
        if (response.status() == 200 && ("allow".equals(decision) || "deny".equals(decision))) {
            boolean allowed = "allow".equals(decision);
            return new Answer(
                    allowed,
                    allowed && Boolean.TRUE.equals(response.body().get("write_allowed")),
                    response.body().get("reason") instanceof String reason ? clip(reason) : "",
                    response.body().get("revalidate_after") instanceof Number seconds ? seconds.intValue() : null);
        }
        String detail = "entitlement endpoint answered " + response.status();
        if (response.status() == 400 || response.status() == 401 || response.status() == 403) {
            throw new Refused(detail);
        }
        if (response.status() == 429) {
            throw new RateLimited(detail);
        }
        throw new Unavailable(detail);
    }

    private static String clip(String reason) {
        return reason.length() > 64 ? reason.substring(0, 64) : reason;
    }
}
