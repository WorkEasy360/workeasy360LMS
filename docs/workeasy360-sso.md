# Sign in with WorkEasy360 Accounts

WorkEasyLMS signs people in through **WorkEasy360 Accounts**, the one identity provider of the WorkEasy360
products. It follows the platform's integration contract ("Onboarding a product", *The contract, for every adapter*)
with the Spring Boot adapter: Spring Security's OAuth 2.0 client with `private_key_jwt` and PKCE, plus the claim
checks, the back-channel logout receiver and the shared sign-in record checked on every request. The design is
ported from Easy Project (`com.projectmodule.security`, branch `feat/backchannel-logout`), which runs it live.

Password sign-in keeps working next to it until `WORKEASY360_SSO_ONLY=true`, so live customers are not locked out.

## 1. What the contract asks, and where it is

| Contract | WorkEasyLMS |
|---|---|
| Authorization Code + PKCE S256; state and nonce server-side, used once | `sso/oidc/AuthorizationRequestResolver`, `PendingFlowRepository` (10 minutes, one callback, constant-time state lookup) |
| `private_key_jwt` (iss = sub = client id, aud = token endpoint, 60 s, fresh `jti`) | `config/SecurityConfig.tokenClient`, `Workeasy360Provider.clientAssertion` (entitlement calls) |
| ID token: signature by `kid` from `jwks_uri`, RS256/ES256 only; `iss` exactly `WORKEASY360_ISSUER`; `aud` = client id; `exp`/`iat`/`nbf` ±30 s; nonce; `typ` `id_token`; `jti`; `product_code`; `organization_id`; `email` + `email_verified` | `sso/oidc/IdTokenDecoderFactory` (+ Spring's nonce check), `Workeasy360OidcUserService` (launcher organization must match) |
| Discovery from the issuer only; its `issuer` must equal the configured one; timeouts, no redirects | `sso/oidc/Workeasy360Provider`, `ProviderHttp` |
| People linked on `(issuer, sub)` | `federated_identities` (V12), `sso/identity/Workeasy360Accounts` |
| Authorization from organization, role and entitlement | session pinned to one organization (`Workeasy360SessionFilter`), WorkEasyLMS roles as before, `sso/entitlement/*` |
| Own session in an httpOnly, Secure, host-only cookie; never a `.workeasy360.com` cookie | servlet session `__Host-lms_session` (`application.yml`); no token ever reaches the browser |
| Back-channel logout: `typ` `logout+jwt`, event present, no nonce, `jti` once; shared store checked on every request; 200 (duplicates too) / 400 | `sso/backchannel/*`, tables `received_logout_tokens`, `signed_in_sessions`, `ended_sign_ins` |
| Product sign-out ends the product session only; WorkEasy360 sign-out via `end_session_endpoint` | `POST /api/auth/logout`; `GET /api/auth/workeasy360/logout` |

## 2. Register WorkEasyLMS in Super Admin

Follow the platform's ten steps. The values for production:

| Field | Value |
|---|---|
| Product code | `workeasy_lms` (or set `WORKEASY360_PRODUCT_CODE` to the code Super Admin uses) |
| Launch URL | `https://learn.workeasy360.com/` (the launcher appends `?organization=<uuid>`; the app starts a sign-in for it) |
| Redirect URI (exact, the only one) | `https://learn.workeasy360.com/api/auth/callback/workeasy360` |
| Post-logout redirect URI | `https://learn.workeasy360.com/` |
| Back-channel logout URI | `https://learn.workeasy360.com/api/auth/workeasy360/backchannel-logout` (same origin as the redirect URI) |
| Scopes | `openid email profile organization` (`email` is required: WorkEasyLMS keys accounts' profile on it and needs `email_verified`; `organization` names a tenant created at a first sign-in) |
| Sign-in mode | `sso_optional` while password sign-in is on, with login URL `https://learn.workeasy360.com/`; `sso_only` once `WORKEASY360_SSO_ONLY=true` |
| Token endpoint auth | `private_key_jwt` |

Domains: publish `_w360-product-verify.learn.workeasy360.com TXT "w360-product-verify=<value shown>"` and choose
Verify (ADR-070); activation is refused until it is proven.

Credential: generate the key pair on an operator machine, register only the public half, and put the private half
on the server (never in the repository):

```
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out lms-workeasy360.pem   # or: -algorithm RSA -pkeyopt rsa_keygen_bits:2048
openssl pkey -in lms-workeasy360.pem -pubout -out lms-workeasy360.pub.pem               # this one goes into Super Admin
sudo install -o <service user> -m 600 lms-workeasy360.pem /etc/workeasy360/lms-workeasy360.pem
```

Super Admin (or `connect_product_sso`) prints the issuer, the client id and the credential id (`kid`). Then grant the
product to a test organization and run a sign-in and a sign-out (steps 7 to 9) before activating and publishing.

## 3. Environment

| Variable | Required | Meaning |
|---|---|---|
| `WORKEASY360_ISSUER` | yes | Exactly the issuer the integration kit names. On 18 November that is `https://auth.workeasy360.com` (ADR-067 at stage off); `https://accounts.workeasy360.com` once stage b makes it an issuer. Compared by string equality, so no trailing slash. A later move is `w360sso move-issuer` in the same release (section 6); configured before any sign-in, no move is needed |
| `WORKEASY360_CLIENT_ID` | yes | The client id |
| `WORKEASY360_REDIRECT_URI` | yes | The registered callback, used verbatim |
| `WORKEASY360_KEY_ID` | yes | The credential id (`kid`) of the registered public key |
| `WORKEASY360_PRIVATE_KEY_FILE` | yes (or the next) | Path of the PEM private key: RSA 2048+ (RS256) or EC P-256 (ES256); PKCS#8, PKCS#1 or SEC1 |
| `WORKEASY360_PRIVATE_KEY` | | The PEM inline (literal `\n` allowed), instead of the file |
| `WORKEASY360_PRODUCT_CODE` | | Default `workeasy_lms` |
| `WORKEASY360_POST_LOGOUT_REDIRECT_URI` | | Registered post-logout URI. Empty: "Sign out of WorkEasyLMS and WorkEasy360" is not offered |
| `WORKEASY360_SSO_ONLY` | | Default `false`. `true`: WorkEasy360 is the only way in (below) |
| `WORKEASY360_AUTO_PROVISION` | | Default `true`: a first sign-in from an unlinked WorkEasy360 organization creates its WorkEasyLMS organization. `false`: refused until an operator links one |
| `WORKEASY360_SCOPES` | | Default `openid,email,profile,organization` |
| `APP_PUBLIC_URL` | for local runs | Where the single-page app is. Sign-in lands on `<APP_PUBLIC_URL>/#/<route>` (production: same origin, may stay as it is) |
| `LMS_SESSION_IDLE_TIMEOUT` | | Default `8h` |

With none of the first five set and SSO-only off, WorkEasyLMS starts exactly as before and its sign-in page does not
offer WorkEasy360. With some but not all of them, or SSO-only without them, it **refuses to start** and names what is
missing (never a value). Outside the `dev` and `local` profiles the issuer, redirect and post-logout URIs must be
`https`; plain `http` is accepted only for a loopback host under a local profile.

On the EC2 host the non-secret settings go through `remote.sh set-env` (it now accepts `WORKEASY360_*`, except the
inline private key):

```
printf '%s\n' WORKEASY360_ISSUER=<issuer the kit names> WORKEASY360_CLIENT_ID=<id> \
  WORKEASY360_REDIRECT_URI=https://learn.workeasy360.com/api/auth/callback/workeasy360 WORKEASY360_KEY_ID=<kid> \
  WORKEASY360_PRIVATE_KEY_FILE=/etc/workeasy360/lms-workeasy360.pem \
  WORKEASY360_POST_LOGOUT_REDIRECT_URI=https://learn.workeasy360.com/ | ssh <host> 'sudo bash /tmp/remote.sh set-env'
```

Nginx needs no change: every new endpoint is under `/api/`, which it already proxies.

## 4. How a sign-in works

1. "Continue with WorkEasy360" (or the launcher's `/?organization=<uuid>`) sends the browser to
   `GET /api/auth/workeasy360/start?next=<route>&organization=<uuid>`. The backend keeps state, nonce and the PKCE
   verifier in a short (10 minute) server-side session and redirects to the discovered `authorization_endpoint`.
2. WorkEasy360 sends the browser back to `/api/auth/callback/workeasy360`. The flow is consumed first; the code is
   exchanged with `private_key_jwt`; the ID token is verified offline (section 1). The userinfo endpoint is never called.
3. The entitlement endpoint is asked about this person (`organization_id` + `subject`) **before** anything is created
   for them: a denial is refused with its reason (`not_entitled`, `no_seat`, `membership_inactive`).
4. The person and the organization are mapped (section 5). A new session id is issued (no fixation; a previous
   person's session in this browser ends), recorded against the WorkEasy360 sign-in (`sid`) in the shared record, and
   the browser lands on `/#/<next>`. Failures land on `/#/login?sso_error=<code>` (the shared vocabulary).
5. The app learns it is signed in from `GET /api/auth/session` (it cannot see the cookie). It keeps no token: its
   only local trace is a marker that "this tab's session is a WorkEasy360 one", which grants nothing.

**On every request with that session:** the shared record is checked (one primary-key read), the account's current
role and organization are read through `SessionGuard` (a deactivated account, a suspended organization or a lapsed
WorkEasyLMS subscription ends the session; an account that moved to another organization ends it too), and the
entitlement answer is applied (cached per `revalidate_after`, at most 15 minutes; a denial is re-asked after 60 s).
`deny` answers 403 `workeasy360_access_ended`; `write_allowed: false` makes writes 403 `workeasy360_read_only`; a
refusal of WorkEasyLMS's own client (400/401/403) fails closed for everyone for 60 s with 403
`workeasy360_access_unverified`; an outage (5xx, 429, timeout) is never a denial.

**Writes** with a session need the CSRF token (`__Host-XSRF-TOKEN` cookie echoed as `X-XSRF-TOKEN`; the app does it)
and, when the browser sends one, an `Origin` that is one of the app's (`CORS_ORIGINS`, `APP_PUBLIC_URL`). Requests
with a bearer token (password sign-ins) do not use the cookie and are unchanged.

**Cookies:** `__Host-lms_session` (httpOnly, Secure, SameSite=Lax, Path=/, no Domain, so host-only),
`__Host-XSRF-TOKEN` (readable by the app, by design), `__Host-lms_signed_out` (a marker set by sign-out). Under
the `dev`/`local` profiles (plain http) the same cookies drop the prefix and `Secure`.

## 5. Identity and tenancy

- **Organization.** The token's `organization_id` maps to one WorkEasyLMS organization (`workeasy360_organizations`,
  one to one). Not linked yet: created at the first sign-in (named from `organization_name`), with **no WorkEasyLMS
  subscription** (its access is WorkEasy360's entitlement), unless `WORKEASY360_AUTO_PROVISION=false`. An existing
  WorkEasyLMS organization (an existing customer) is linked by an operator **before** its people sign in (section 6).
- **Person.** Linked on `(issuer, sub)`. Someone seen before is the account linked then, which must still be in the
  organization the token names: **a sign-in never crosses organizations** (`account_conflict`). Someone new is linked
  to the existing account with the same address only when WorkEasy360 says `email_verified`, only inside that
  organization, never an account already linked to another identity, never the platform owner. Their password is
  then retired and the bearer tokens they held stop working (`users.tokens_valid_after`). Otherwise a new account is
  created: the organization's **administrator** when it has nobody yet, a **learner** otherwise; administrators change
  roles under People as before.
- **Roles** stay WorkEasyLMS's own (`users.role`): the ID token carries none, by design. Every permission rule
  (`PermissionService`, tenant checks) applies unchanged, because a WorkEasy360 session runs as an ordinary
  `CurrentUser` of its organization.
- **One person, one WorkEasyLMS organization.** WorkEasyLMS keeps one organization per account and unique addresses,
  so someone who belongs to two WorkEasy360 organizations can use WorkEasyLMS in the first one they signed in with;
  the other answers `account_conflict`.
- **Accounts linked to WorkEasy360** cannot get a password back: reset links and password changes are refused for them.

## 6. Operator commands

Run from the deployed jar with the service's own environment; the web server is not started:

```
sudo bash -c 'set -a; . /etc/workeasy360/backend.env; set +a; java -jar /opt/workeasy360/app/backend.jar w360sso list'
```

| Command | Does |
|---|---|
| `w360sso list` | Every organization, its status, and the WorkEasy360 organization it is linked to (and by whom) |
| `w360sso link --workeasy360-organization=<uuid> --organization=<org id>` | Links an existing WorkEasyLMS organization. Refused when either side is linked already, or for the platform organization |
| `w360sso unlink --workeasy360-organization=<uuid>` | Removes the link. People and their identities stay; with auto-provisioning on, the next sign-in from that organization creates a new tenant, and its people then get `account_conflict`, so relink instead of leaving it unlinked |
| `w360sso move-issuer --from=<issuer> --to=<issuer>` | The identity-link move of an issuer move (ADR-067): run it in the same release that changes `WORKEASY360_ISSUER` |

`--issuer=` overrides the issuer a link is made under (default `WORKEASY360_ISSUER`). Every change is audited as
`workeasy360.operator.*`. Exit status: 0 done, 1 refused, 2 usage error.

To move an existing customer: `w360sso list` to find its organization id, ask WorkEasy360 for its organization UUID,
`w360sso link`, then its people sign in with WorkEasy360; each is linked to their existing account by verified address.

## 7. SSO-only

`WORKEASY360_SSO_ONLY=true` turns off every password path: `POST /api/auth/login`, `/register`, `/forgot`, `/reset`,
`/password` and `POST /api/public/organizations` answer 403, and bearer tokens are refused (401
`workeasy360_sign_in_required`), so sessions opened by a password before the switch end at their next request. The
sign-in page shows only "Continue with WorkEasy360", and a page that needs a signed-in person starts a WorkEasy360
sign-in by itself (integration guide 6b) except on the sign-in page, after a sign-out (the marker), or within a minute
of the last attempt. The platform-owner console (`PLATFORM_ADMIN_*`, a password account) is then unavailable too.

## 8. Sign-out

- **Sign out** (`POST /api/auth/logout`, CSRF-protected): ends the WorkEasyLMS session only and leaves the signed-out
  marker. A password session only drops its token, as before.
- **Sign out of WorkEasyLMS and WorkEasy360** (offered when `WORKEASY360_POST_LOGOUT_REDIRECT_URI` is set): the same,
  then `GET /api/auth/workeasy360/logout` sends the browser to the discovered `end_session_endpoint` with `client_id`
  and the post-logout URI.
- **Back-channel logout** (`POST /api/auth/workeasy360/backchannel-logout`, form field `logout_token`): WorkEasy360's
  server ends the sessions a sign-in opened, on every instance: 200 (also for a duplicate), 400 `invalid_request` for a
  token that does not verify, 503 when the key set or the database cannot be reached (WorkEasy360 retries). A restart
  cannot bring an ended session back: the shared record, not the session, decides.

## 9. Plans, subscriptions and payments: the overlap

WorkEasyLMS has its own commercial model, which this change leaves in place (nothing deleted):

| WorkEasyLMS | WorkEasy360 | How they meet now |
|---|---|---|
| `plans`, `subscriptions` (TRIAL/ACTIVE/...), seat and course limits per plan (`EntitlementService`) | the product catalog, plan mapping and entitlement per organization | An organization created by a WorkEasy360 sign-in has **no** WorkEasyLMS subscription: WorkEasy360's entitlement alone decides, and it has no WorkEasyLMS seat or course limits. An existing organization linked by an operator keeps its subscription, and **both** gates apply: a lapsed WorkEasyLMS trial still refuses its people even when WorkEasy360 says `allow` |
| Public self-serve organization sign-up (`#/signup-org`, `POST /api/public/organizations`: a trial organization and its admin) | organizations are created and bought in WorkEasy360 | Still on unless SSO-only. It creates organizations WorkEasy360 does not know, which are never linked |
| Public learner sign-up (`POST /api/auth/register`, into `org-default`) | people are members of WorkEasy360 organizations | Still on unless SSO-only |
| Platform-owner console (`#/platform`: organizations, plans, audit) | Super Admin | Overlaps for linked organizations: suspending one here still ends its sessions; its plan here is ignored when it has no subscription |
| Paid courses: per-course orders and payments by learners (`orders`, `payments`, `PaymentProvider`) | the WorkEasy360 store sells the product, not courses inside it | Different things (B2C purchases inside a tenant); untouched. Note it is still `PAYMENTS_PROVIDER=none` in production |

**Decisions for the owner:** whether WorkEasy360 becomes the only commercial authority for WorkEasyLMS (then retire
WorkEasyLMS subscriptions of linked organizations, hide public organization sign-up and the plan console, and map the
WorkEasyLMS plans' seat and course limits to WorkEasy360 plans or drop them), and whether public learner sign-up stays.

## 10. Run it locally against a provider at `http://127.0.0.1:8031`

Register a development integration in the local WorkEasy360 with redirect URI
`http://localhost:8080/api/auth/callback/workeasy360`, post-logout URI `http://localhost:5173/` and back-channel URI
`http://localhost:8080/api/auth/workeasy360/backchannel-logout` (loopback URIs are accepted outside production), add
the public key, and grant the product to a test organization. Then:

```
cd backend
export WORKEASY360_ISSUER=http://127.0.0.1:8031          # exactly what its discovery document says
export WORKEASY360_CLIENT_ID=<client id> WORKEASY360_KEY_ID=<kid> WORKEASY360_PRIVATE_KEY_FILE=$HOME/lms-dev.pem
export WORKEASY360_REDIRECT_URI=http://localhost:8080/api/auth/callback/workeasy360
export WORKEASY360_POST_LOGOUT_REDIRECT_URI=http://localhost:5173/
export APP_PUBLIC_URL=http://localhost:5173 CORS_ORIGINS=http://localhost:5173
mvn spring-boot:run                                       # dev profile (H2); or APP_PROFILE=postgres,local for PostgreSQL
# frontend, another shell, from the repository root:  powershell -File serve.ps1 -Port 5173
```

Plain `http` is accepted only because the issuer is a loopback host **and** a local profile (`dev`, or `local` added
to another) is active. Use `localhost` for both the app and the API: the session cookie is per host, and a page on
`127.0.0.1` calling an API on `localhost` would be cross-site.

**Prove it (200 vs 401).** Open `http://localhost:5173/`, choose "Continue with WorkEasy360" and sign in. The
protected endpoint is `GET /api/auth/session` (or any API, such as `GET /api/courses`); the credential is the session
cookie, which only the browser holds. In the browser's developer tools copy the `lms_session` cookie of `localhost`, then:

```
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/auth/session                                 # 401
curl -s -o /dev/null -w '%{http_code}\n' -H 'Cookie: lms_session=<value>' http://localhost:8080/api/auth/session # 200
```

Sign out (or end the sign-in in WorkEasy360, which sends the back-channel logout) and the second command answers 401.
For a password account the credential is the bearer token from `POST /api/auth/login`:
`curl -H "Authorization: Bearer <token>" http://localhost:8080/api/courses`.

## 11. Tests

`backend/src/test/java/com/workeasy360/backend/sso` drives the real application with a fake WorkEasy360
(`support/FakeWorkeasy360`: discovery, key set, token endpoint verifying the client assertion and PKCE, entitlement
endpoint, logout tokens, key rotation): the happy path, wrong issuer, audience, signature, key, algorithm, nonce,
times, type, product, organization and e-mail, entitlement denial, read-only, client refusal and outage, tenancy
(cross-organization refusal, isolation, linking by verified address, deactivation, operator commands), CSRF and
origin checks, password sign-in next to it, SSO-only, sign-out, and back-channel logout (valid, forged, replayed,
overtaking a sign-in, key rotation) including two real servers sharing one database and a restart that must not
bring an ended session back.

```
docker run --rm -v "$PWD/backend:/src" -w /src -e LMS_TEST_DB_URL=jdbc:postgresql://<host>:5432/lms_test \
  -e LMS_TEST_DB_USERNAME=<user> -e LMS_TEST_DB_PASSWORD=<password> maven:3.9-eclipse-temurin-21 mvn -B test
```

Without `LMS_TEST_DB_URL` the same tests run on an in-memory H2 in PostgreSQL mode.
