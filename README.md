# WorkEasy360 LMS

A complete learning-management product: course authoring (with AI drafting), learning player with native video,
quizzes and assignments, certificates, skills engine with visual learning journeys, community, analytics, a grounded
AI learning coach with deterministic recommendations, in-product guides, notifications and administration.

- **Frontend:** zero-build vanilla ES modules (no Node/npm), hash router, served by any static server.
- **Backend:** Java 21 / Spring Boot 3.3 / Spring Security (JWT) / JPA / Flyway, PostgreSQL 16 (or H2 for zero-install dev).

## 1. Quick start (local development)

**Prerequisites:** JDK 21 and Maven 3.9+ on `PATH`; for the `postgres` profile a PostgreSQL 16 server (or Docker);
any static file server for the frontend (`serve.ps1` needs only Windows PowerShell). No Node/npm.

```
# A) fastest: no database to install (dev profile = H2 file DB in backend/data, demo data seeded, random JWT key)
cd backend && mvn spring-boot:run

# B) PostgreSQL (what production uses)
docker compose -f backend/docker-compose.yml up -d        # or any PostgreSQL 16 with database/role we360
cp backend/.env.example backend/.env                      # then set JWT_SECRET (required) and, first time, APP_SEED_ENABLED=true
cd backend && set -a && . ./.env && set +a && mvn spring-boot:run -Dspring-boot.run.profiles=postgres

# frontend (either)
start.cmd                                                  # Windows: static server on :5173 + opens the app
powershell -File serve.ps1 -Port 5173                      # or: python -m http.server 5173 / npx serve / nginx …
```

`backend/.env` is ignored by Git. `tools/` may hold optional, untracked portable copies of the JDK, Maven and
PostgreSQL for machines without admin rights; `. tools/env.sh` puts them on `PATH` when present and loads `backend/.env`.

Open http://localhost:5173 and sign in with a demo account (only present when demo seeding is on; password
`password123`): `admin@workeasy360.dev` (admin), `daniel@workeasy360.dev` (instructor), `maya@workeasy360.dev`
(learner). The API listens on http://localhost:8080 (OpenAPI UI at `/docs`).

## 2. Architecture

```
index.html ─ src/app.js (routes, session, hydration)          backend/ (Spring Boot)
   src/lib        dom helper, event bus, localStorage store,     web/        REST controllers (+ GlobalExceptionHandler)
                  seed data for the offline demo                  service/    business rules, permissions, notifications
   src/services   API client + domain services (local cache       ai/         provider abstraction, mock, OpenAI/Anthropic
                  first, background sync to the backend)          domain/     JPA entities   repo/ Spring Data repositories
   src/pages      screens      src/components  design system,     security/   JWT filter + service, CurrentUser
                  brand, floating AI agent (Agent.js)
   src/assets     brand artwork (logo, mark, agent)    src/lib/vendor  qrcode-generator (MIT) for certificate QR codes
   src/builder    content blocks, AI quiz panel                   resources/db/migration  Flyway V1…V7
   src/guide      in-product guide engine and guide definitions   storage/    uploaded videos (FILE_STORAGE_PATH)
   tests/         in-browser regression suites
```

**Data flow.** The frontend keeps a localStorage cache (`we360.v2.*`) so pages render instantly and the app still works
as an offline demo. When a JWT is present the backend is authoritative: on login/refresh `hydrateIfAuthor()` pulls the
user's courses, learning state, skills, community, people, notifications and settings; every mutation is pushed to the
API (course edits are serialised per course by `courseSync.js`). Learner progress, quiz attempts, submissions,
certificates, skills, AI generations, coach data and notifications are computed and stored **only** on the backend.

**Backend layering.** Controllers validate input and delegate to services; `PermissionService` centralises role rules
(`isAdmin`, `canEditCourse`, `canManageEnrollments`, `canViewAnalytics`); `ApiException` maps to 400/403/404/409/422;
unexpected errors return a generic 500 without internals. Flyway runs at startup and Hibernate validates the schema.

## 3. Roles and authentication

| Role | Can |
| --- | --- |
| Learner | Sign up publicly, browse the catalogue (published courses only), take free courses, buy paid ones, learn, take quizzes/assignments, earn certificates, skills, journeys, coach, community |
| Instructor | Everything a learner can plus: create/edit own courses, enrol learners, review assignments, course analytics, AI drafting, pin discussions |
| Admin | Everything plus: any course, publish/archive/delete, people management, skills library, certifications, org-wide analytics, settings, automation rules, platform status |

Login (`POST /api/auth/login`) returns an HS256 JWT (`JWT_SECRET`, expiry `JWT_EXPIRY_MINUTES`) sent as
`Authorization: Bearer …`. Passwords are BCrypt-hashed. Only `/api/auth/**`, certificate verification and the API docs
are public. A missing, expired or invalid token yields `401`; a valid token with the wrong role yields `403`. Deactivated people (`status = INACTIVE`) cannot sign in. Ownership is checked server-side for every
per-user resource (progress, notifications, coach conversations, plans, submissions); e-mail addresses are only
disclosed to admins and to the person themself.

## 4. Database and migrations

- **postgres profile** (production): `DB_HOST / DB_PORT / DB_NAME / DB_USERNAME / DB_PASSWORD`.
  Create database `we360` owned by role `we360`, or run `docker compose -f backend/docker-compose.yml up -d`.
  The schema is created by Flyway on first start. Database contents are runtime data and are never committed.
  Without admin rights on Windows, an untracked portable server can live in `tools/pgsql` with its cluster in
  `tools/pgdata` (`initdb -D tools/pgdata -U postgres --auth=trust -E UTF8`, then
  `pg_ctl -D tools/pgdata -o "-p 5432" start`).
- **dev profile** (default): H2 file database in PostgreSQL mode at `backend/data/we360` — same entities, same
  migrations, zero install.
- **Migrations** live in `backend/src/main/resources/db/migration` (`V1__init` … `V6__automation_settings`). They run
  automatically at startup. Never edit an applied migration (Flyway checksums will fail); add `V7__<change>.sql`.
  Migrations are additive and production-safe (no data-destroying statements).
- **Seed data** (`DataSeeder`) runs only when the `users` table is empty and `APP_SEED_ENABLED=true`. It is idempotent
  and matches the frontend's offline seed (`src/lib/mockData.js`), so demo ids (`u-maya`, `c-sales`, …) line up.

## 5. Configuration (environment variables)

Copy `backend/.env.example` and export the values (never commit real secrets).

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PROFILE` | `dev` | `dev` (H2) or `postgres` |
| `SERVER_PORT` | `8080` | API port |
| `JWT_SECRET` | none (**required**) | HS256 signing secret, random, 32+ characters. The backend refuses to start without it on any profile except `dev`, where a random per-run key is generated if it is unset. Generate one with `openssl rand -base64 48`; keep it in the environment or an untracked `backend/.env`. |
| `JWT_EXPIRY_MINUTES` | `720` | Token lifetime |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated frontend origins |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | `localhost`, `5432`, `we360`, `we360`, `we360` | PostgreSQL connection (postgres profile) |
| `FILE_STORAGE_PATH` | `./storage` | Folder for uploaded videos |
| `MAX_VIDEO_MB` | `500` | Hard upload limit (admins can set a lower one in Settings) |
| `APP_SEED_ENABLED` | `true` on `dev`, `false` elsewhere | Seed demo accounts and courses on an empty database. The demo password is public: never enable in production |
| `AI_ENABLED` | `false` | `false` = deterministic local mock provider (no network, no key) |
| `AI_PROVIDER` | `mock` | `mock`, `openai` (or any OpenAI-compatible gateway) or `anthropic` |
| `AI_API_KEY` | – | Provider key; held in memory only, never stored or returned by the API |
| `AI_MODEL` | – | e.g. `gpt-4o-mini`, `claude-sonnet-4-5` |
| `AI_BASE_URL` | provider default | Optional gateway/proxy base URL |
| `AI_TIMEOUT_SECONDS` | `60` | Provider call timeout |
| `AI_MAX_INPUT_CHARS` | `12000` | Prompt input cap |
| `AI_MAX_OUTPUT_TOKENS` | `4000` | Provider output cap |
| `AI_MAX_QUESTIONS` | `25` | Max questions per quiz generation |
| `AI_DEDUPE_MINUTES` | `10` | Identical request within this window returns the previous generation |
| `PAYMENTS_PROVIDER` | `none` | `none` (purchases refused safely) or `mock` (development only); a real provider needs an implementation |
| `PAYMENTS_MOCK_ALLOWED` | `false` | Must be `true` for the mock provider to work; never in production |
| `PAYMENTS_API_KEY`, `PAYMENTS_WEBHOOK_SECRET` | – | Credentials for a real provider; environment only |
| `PAYMENTS_CURRENCY` | `INR` | Default currency for new prices |

Frontend: the API base is `http://localhost:8080/api` by default; for another host set
`window.WE360_API_BASE = "https://api.example.com/api"` in a `<script>` before `src/app.js` in `index.html`.

## 6. AI features

`backend/.../ai/` provides one `AiProvider` interface with three implementations (mock, OpenAI-compatible, Anthropic),
selected by `AiProviderFactory`. Every generation is validated (`AiValidation`), size-limited, de-duplicated by input
hash, retried once, and audited in `ai_generations` (prompt version, status, tokens). Nothing is published
automatically: the **AI Course Builder** and **AI Quiz Generator** produce drafts an author applies explicitly; the
**Learning Coach** answers only from the learner's own bounded context (courses, progress, skills, journeys,
recommendations) and never receives passwords, tokens, keys or other users' data. Recommendations, next steps and
learning plans are deterministic and work with `AI_ENABLED=false`; the coach chat degrades to the mock provider.

The **WorkEasy360 Assistant** (`src/components/Agent.js`) is the floating agent on every signed-in page: the robot
launcher bottom-right opens a side panel with suggested questions, conversation history and guided tours for the
user's role. It uses the same coach endpoints (`/api/coach/message`, `/api/coach/conversations`), so answers stay
grounded in the user's own record; in the lesson player it also sends the current lesson. It is hidden on `/coach`,
the full-page version of the same conversation.

## 6a. Sign-up, free and paid courses, purchases

- **Public sign-up** (`POST /api/auth/register`, page `#/signup`): name, e-mail, password (8+ characters with a letter and
  a digit). Every self-registered account is a `LEARNER`; a role in the request is ignored. Duplicate e-mails → 409.
  The response signs the learner in (same JWT flow as login).
- **Pricing:** each course has `price_cents` (0 = free) and `currency` (`INR`, `USD`, `EUR`, `GBP`), set by the course's
  instructor or an admin in the Builder ("Price"). Cards and details show **FREE** or **PAID · ₹X**.
- **Access rule** (`AccessService`, enforced on lessons, progress, quizzes, submissions, video streams and course
  trees): content is readable by the course's editors, by anyone holding an entitlement (an `enrollments` row with
  `source` FREE, PURCHASE or ASSIGNED), and by any signed-in user for a published free course. A paid course without
  entitlement is *visible* (title, syllabus, price) but the API returns `402` for its content and a redacted tree.
- **Purchases** (`orders`, `payments` tables; V7): `POST /api/orders {courseId}` opens a PENDING order (one per learner
  and course; 409 once entitled), the checkout page (`#/checkout/:orderId`) drives the provider, and only
  `OrderService.confirm` — fed by the provider's verdict — moves an order to SUCCESS / FAILED / CANCELLED / REFUNDED.
  SUCCESS creates the entitlement in the same transaction. Orders are private to their owner (admins may list all).
- **Providers** (`payments/PaymentProvider`): `none` (default; purchases answer 503 and nothing is ever unlocked) and
  `mock` (local development only: the checkout page offers "pay / fail / cancel" outcomes, and the outcome endpoint
  exists only when `PAYMENTS_PROVIDER=mock` **and** `PAYMENTS_MOCK_ALLOWED=true`). A real provider implements the
  interface (checkout session + a signed callback that calls `confirm`); its key and webhook secret come from
  `PAYMENTS_API_KEY` / `PAYMENTS_WEBHOOK_SECRET`. Without a real provider, production can sell nothing — by design.

## 6b. Brand

The UI uses the WorkEasy360 palette shared with WorkEasy360 Booking, defined once in `src/styles/tokens.css`: navy
`#13222E` (sidebar, sign-in), green `#00BF62` (primary actions; `#008F49` for green text), background `#F6F8F9`,
borders `#E1E7EB`, text `#17232D` / `#667581`. The official logo, the "W" mark (also the favicon) and the agent artwork
are in `src/assets/brand/` (right-sized copies of the company artwork) and are rendered by `src/components/Brand.js`.

**Certificates** (`CertificateView` in `src/pages/Certificates.js`) are A4 landscape: navy and gold frame, the official
logo, "Certificate of Completion" (Cinzel), the recipient in script (Great Vibes), the course, the issuing organisation
(Admin → Settings → organisation name), the course instructor's signature, a gold seal with the W mark, and a QR code that
opens the public verification page (`#/verify/<ID>`). `GET /api/certificates` and the public
`GET /api/certificates/verify/{number}` return `recipientName`, `courseTitle`, `instructorName` and `issuer`, so a
certificate reads correctly on any device; no e-mail address is exposed. "Print / save PDF" prints one A4 landscape page.

## 7. Notifications and automation

Notifications are stored on the backend (`notifications` table) and delivered in-app. Event rules run as things
happen: enrolment by an instructor/admin, assignment reviewed, discussion reply, course completed/certificate issued.
Reminder rules run at sign-in and never repeat within their window: due within 3 days/overdue (daily), certificate
expiring within 60 days/expired (weekly). Admins switch each rule on/off under **Automation** (persisted in
`settings.automation_json`). No e-mail is sent.

## 8. Video storage

Uploads (`mp4`, `webm`, `mov`, ≤ `MAX_VIDEO_MB` and the admin setting) are stored under `FILE_STORAGE_PATH` with a
random storage key and streamed by `GET /api/videos/{id}/stream` with HTTP range support after a permission check
(admin, the course's instructor, or a learner enrolled in a published course). YouTube/Vimeo/external URLs are stored
as metadata only. For a multi-node deployment, mount `FILE_STORAGE_PATH` on shared storage.

## 9. Build and deployment

```
cd backend
mvn -DskipTests package                                   # → target/backend-0.1.0.jar
APP_PROFILE=postgres JWT_SECRET=<long-random> CORS_ORIGINS=https://lms.example.com \
DB_HOST=db DB_PASSWORD=<secret> FILE_STORAGE_PATH=/var/lib/we360/storage java -jar target/backend-0.1.0.jar

docker build -t we360-backend backend/                    # or the multi-stage Dockerfile
```

**Production checklist**

- `JWT_SECRET` set from a secret manager (required; the server will not start without it). Rotating it signs everyone out.
- `DB_PASSWORD` set to a real password; the `we360` default is for local development only.
- `APP_SEED_ENABLED` left `false`; create the first admin directly in the database or seed once in a staging copy.
- `CORS_ORIGINS` set to the real frontend origin; backend behind TLS.
- `AI_API_KEY` supplied through the environment only when `AI_ENABLED=true`.
- `PAYMENTS_PROVIDER` left at `none` until a real provider is implemented and configured; `PAYMENTS_MOCK_ALLOWED`
  must never be `true` outside local development.
- The demo shortcuts `?as=<role>` and `?selftest=<suite>` only work with the demo accounts; do not deploy `tests/`.

Deploy the frontend as static files (`index.html`, `src/`) behind any web server/CDN, set
`window.WE360_API_BASE`, and add the site's origin to `CORS_ORIGINS`. Back up the PostgreSQL database and the
storage folder together. Health: `GET /api/system/status` (admin) reports database, schema version, storage, AI
provider and CORS without secrets.

## 10. Tests

| Layer | How |
| --- | --- |
| Backend compile | `cd backend && mvn -q -DskipTests compile` |
| API smoke / security | curl against `/api/...` (401 without token, 403 for wrong role, 404/409 guards) |
| Browser regression (70 suites) | `index.html?as=<role>&selftest=<suite>` — see below |

Browser suites live in `tests/` (`selftest.js` registers `suites_video.js`, `suites_skills.js`,
`suites_analytics.js`, `suites_ai.js`, `suites_coach.js`, `suites_commerce.js`, `suites_agent.js`,
`suites_platform.js`). They drive the real UI against the
running backend, log to `tests/last-run.log` through the dev server's `/__log` endpoint and finish with
`RESULT: ALL PASSED` or `RESULT: n FAILED`. They need the frontend served by `serve.ps1`, the backend running with
the demo data seeded, and Chrome. Run them **one at a time** (they share the log and the demo accounts):

```
bash tests/run-regression.sh                        # all 70 suites, sequential; summary in tests/regression-result.txt
bash tests/run-regression.sh "instructor builder"   # selected suites
CHROME="/path/to/chrome" BASE_URL=http://localhost:5173 bash tests/run-regression.sh
```

Suites create test records (courses, enrolments, posts) in whatever database the backend uses; point them at a
development database, never production.

Suite → launch role: instructor — guide, builder, perms, review, video, addvideo, backendE2E, guideBackend, smoke,
skillMapping, analyticsInstructor, guideAnalyticsBackend, aiCourseInstructor, aiQuiz, aiValidation, aiProvider,
aiPersist, assignLearner, notificationsBackend, platformAdmin, searchScope; admin — video, smoke, skillsAdmin,
analyticsAdmin, analyticsFilters, seedConsistency, guideAnalyticsPersist, aiCourseAdmin, adminUsers, accountLogin,
brand (palette, logo, agent for admins, phone width); learner —
learnerguide, player, quiz, community, smoke, quizBackend, assignmentBackend, communityBackend, videoResume,
certVerify, quizFresh, skillProgress, skillQuizEvidence, journey, skillsPersist, analyticsLearner, analyticsFunnel,
analyticsAssessments, analyticsPersist, aiRbac, responsive (phone-width overflow check), signup, freeCourseAccess, paidCourseLock, purchaseFlow, purchaseFailures, coachContext, recommendations, recommendationFeedback,
coachConversation, coachLessonContext, coachGrounding, coachRbac, coachValidation, learningPlan, coachPersist, agent
(WorkEasy360 Assistant), certificate (printable certificate, names, QR code).
Suites always run with `AI_ENABLED=false` (mock provider) — no external AI calls.

## 11. Guides

Tag an element with `data-guide-target="area.name"` and add a step in `src/guide/guides.js` with a `completion`
(`events` and/or `check(ctx)`); services emit domain events (`module.added`, `lesson.completed`, …) the engine validates
against real state. Guide progress and adoption events are persisted (`/api/guides/...`) and aggregated for admins.

## 12. Troubleshooting

- **"Can't reach the server"** — backend not running or `CORS_ORIGINS` doesn't include the frontend origin. Wait for
  `Started BackendApplication` in the backend log.
- **Port in use** — set `SERVER_PORT` (backend) or `serve.ps1 -Port` (frontend).
- **Flyway checksum / validation error** — an applied migration was edited or the schema was changed by hand; restore
  the file or add a new migration. Hibernate `ddl-auto=validate` refuses to start on a mismatched schema by design.
- **No demo data** — seeding only happens on an empty `users` table; drop the database (or `backend/data` for H2) to
  reseed.
- **H2 "database may be already in use"** — another backend instance holds `backend/data`; stop it.
- **Stale UI state** — *Settings → Reset local data* clears this browser's cache; server data is untouched.
- **Portable PostgreSQL fails to start on Windows** — the VC++ runtime DLLs must sit next to `postgres.exe`
  (`tools/pgsql/bin`); see `tools/pg.log`.
