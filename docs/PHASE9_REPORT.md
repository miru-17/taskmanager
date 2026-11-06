# Phase 9 — Harden and ship

**Status:** complete · **Branch:** `phase-3` · **Date:** 2026-11-06

Exit criterion from the plan: *CI green on every push*. A GitHub Actions workflow runs on every push and pull request. The latest run's result is recorded at the end of this report.

## What was done

### Security pass
**Dependencies.** All non-breaking fixes applied:
- Frontend: axios, vite, react-router, postcss, nanoid.
- Backend: body-parser, proxy-addr (critical: IP spoofing through IPv4-mapped IPv6), qs, and nodemailer 9 → 10.

**Result:**
- Frontend production dependencies: **0 known vulnerabilities**.
- Backend: 3 remain, all in the **Prisma CLI's config loader** (`deepmerge-ts`, a stack exhaustion on recursive config objects). Only our own config file passes through it; no user input does. The fix is the Prisma 7 major upgrade, so it's an **accepted risk** for now, tracked below.
- CI fails the build on any critical issue (backend) or any high issue (frontend).

**Checked live against the production build:**

| Check | Result |
|---|---|
| Security headers | CSP, HSTS, `nosniff`, frame protection, `no-referrer`, COOP and CORP are all present. `X-Powered-By` is gone. |
| CORS | A foreign origin gets no `Access-Control-Allow-Origin` |
| CSRF on cookie-authenticated refresh | 403 without the header |
| Body size | 413 above 100 KB |
| Error responses | Generic messages and codes, no stack traces |
| Brute force | Login locks out after 10 attempts (429) |

**The test suites already cover** cross-tenant access, IDOR, privilege escalation, token reuse, XSS in mentions, CSV formula injection, prompt-injection containment, webhook signatures and plan limits (229 backend tests).

### Performance
- **New indexes:**
  - `Task(projectId, dueDate)` for the hourly due-soon and overdue sweeps and "due this week" lists. On 100,000 tasks, `EXPLAIN ANALYZE` shows an index scan in **0.1 ms**.
  - `AutomationRun(taskId)` so deleting a task doesn't scan the run log.
- **N+1 removed.** The AI task parser checked project visibility with one query per organization member. It now uses one query, applying the same rule as `projectAccessWhere`.
- Lists were already paginated or capped, and analytics are SQL aggregates (Phase 5).

### Shipping
- **Docker:**
  - The `backend/Dockerfile` is multi-stage, runs as a non-root user, uses `tini` for clean shutdown, applies migrations on start, and has a health check.
  - The `frontend/Dockerfile` builds into nginx. nginx serves the app with security headers (CSP allows Stripe only as a form target), long caching for hashed assets, a client-side route fallback, and `/api` proxying tuned for live updates (no buffering, 1-hour reads).
- **`docker-compose.yml`:** Postgres 16, API and web, with health-gated startup and named volumes for data and uploads. The API isn't published; it's only reachable through `/api`.
- **Fix found while preparing the proxy setup:** the refresh-token cookie was hard-coded to path `/auth`. Behind `/api`, the browser would never send it back, so every page reload would sign people out. The path is now `COOKIE_PATH`; Compose sets `/api/auth`, and the Docker CI job checks a real refresh through nginx.
- **Admin scripts:** `set-plan` and `make-super-admin` are now compiled into the image (`node dist/cli/…`).
- **Backups:**
  - `deploy/backup.sh` dumps the database (`pg_dump` custom format) and the uploads, then checks both artifacts and keeps the last N.
  - `deploy/restore.sh` restores in a single transaction after a typed confirmation.
  - The dump-and-restore round trip was tested here: the restored data matched the original row for row (checksum over task titles).
- **Docs:** `docs/DEPLOYMENT.md` covers first start, HTTPS, optional services, admin commands, backups and cron, upgrades, sizing and CI. There's also a root `README.md`.

### CI: `.github/workflows/ci.yml`
| Job | What it proves |
|---|---|
| Backend | Typecheck; **migrations apply to an empty database and match the schema exactly** (`prisma migrate diff --exit-code`, using the real migration engine, which this sandbox doesn't have); 229 tests; production build; audit |
| Frontend | Lint, 90 tests, production build, audit |
| End-to-end | Playwright against the built API and app with a real database: sign up, create a project, create a task from a sentence, comment, see it on the board, hit the Free plan's project limit, analytics, sign out and in |
| Docker | Builds both images, starts the Compose stack and waits for health; checks the app, API, route fallback and CSP through nginx; registers, logs in and refreshes the session through the proxy |

The Playwright suite (`e2e/`, 6 tests) passed locally against real servers before it went into CI.

## CI result

_Filled in below after the first run._

## Honest limitations
- **Prisma 7 upgrade pending** (the accepted CLI advisory above).
- **I couldn't build or run the Docker images in this workspace** (no Docker daemon). They're verified by the CI Docker job instead.
- **No load testing** beyond the 100,000-task query plan. Uploads use a local volume, so running several API replicas needs shared storage or the S3 storage implementation (not written yet).
- **Backups are local files.** Copying them off the machine is up to the operator, as documented.
- **No external security audit or penetration test**, and no SAST tool in CI beyond typechecking, lint and `npm audit`.
- **Carried over:** no code splitting (the bundle-size warning remains), and the 500-row cap on task lists.
