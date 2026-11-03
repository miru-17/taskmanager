# Phase 0 — Stabilise: completion report

_3 Nov 2026_

## Summary
The existing app keeps every feature and URL, and the frontend talks to the backend exactly as before. Underneath, the backend is restructured into `core/` + `modules/`. Every input is validated, errors are handled centrally, configuration is validated at startup, and the first security hardening is in. All bugs B1–B12 from `ASSESSMENT.md` are fixed (B11 deliberately kept; see below). The test suites went from **0 passing** to **43 backend + 13 frontend passing**.

## What changed

### Backend structure
```
backend/src/
  app.ts                 createApp(): middleware, routes, health checks, error handler
  server.ts              starts the server; graceful shutdown
  core/
    config.ts            zod-validated env (process exits with a clear message if invalid)
    logger.ts            pino structured JSON logs, credentials/tokens redacted
    prisma.ts            Prisma client (Rust-free, pg adapter — see adr/0001)
    errors.ts            AppError + central JSON error handler (no stack traces to clients)
    validate.ts          zod request validation middleware
    auth.ts              JWT sign/verify (HS256 pinned), authenticate middleware
    security.ts          helmet headers, CORS allow-list, auth rate limiting
    mailer.ts            single reusable transport; logs mail in dev if SMTP unset
    schemas.ts           shared email / password / id schemas
  modules/
    auth/                register, login, forgot/reset password
    users/               change password
    tasks/               task CRUD (+ PATCH for partial updates)
```
The old `controllers/`, `routes/`, `middleware/`, `types/` and `src/prisma.ts` were removed, and their logic now lives in the modules above.

### Bugs fixed
| # | Fix | Proven by |
|---|---|---|
| B1 | Frontend logs out only on a 401 from a protected route that carried a token. Wrong current password now returns 400 | `api.test.ts`, `auth.test.ts`, browser check |
| B2 | Past-date rule applies only when the due date is actually changed; status changes send only `{status}` via PATCH | `tasks.test.ts` "Overdue tasks", `Home.test.tsx`, browser check |
| B3 | Validation runs before normalisation, so a missing or non-string email gives 400 | `auth.test.ts` |
| B4 | Forgot-password lower-cases the email | `auth.test.ts` |
| B5 | Ids are validated (positive int ≤ 2³¹−1), so bad ids give 400 | `tasks.test.ts` |
| B6 | Titles are trimmed, required, max 200 and strings only; dates are validated | `tasks.test.ts` |
| B7 | `/user` routes mounted in `app.ts` | `auth.test.ts` change-password tests |
| B8 | TaskForm always resets the date, has no `min` in edit mode, has a Cancel button, and sends `null` for an empty date | `TaskForm.test.tsx`, browser check |
| B9 | Date-only values are stored at UTC midnight, with a one-day tolerance covering all time zones | `tasks.test.ts` "today's date" |
| B10 | Self-contained tests on an isolated DB; frontend tests wrapped in Router/AuthProvider | the suites themselves |
| B11 | Empty migration **kept on purpose**: it's recorded in your database, and deleting it would make Prisma demand a reset | — |
| B12 | Page title is "TaskForge"; empty `TaskList.tsx` and unused `App.css` removed | — |
| — | `npm start` pointed at `dist/server.js`, but `tsc` wrote to `dist/src/`. Fixed with `tsconfig.build.json` | build + run verified |

### Security fixes delivered now (each with a test)
- Reset tokens are stored as SHA-256 hashes, are single-use, and expire after 15 minutes.
- Forgot-password gives the same response whether or not the account exists.
- Login has constant-time behaviour for unknown emails and the same 401 body for both failure cases.
- JWT algorithm pinned to HS256; forged, `alg=none` and expired tokens are rejected.
- Rate limiting on login, register and reset endpoints (10 per 15 min per IP, configurable). Returns 429.
- helmet security headers, `x-powered-by` removed, CORS restricted to `FRONTEND_URL`/`CORS_ORIGINS`.
- 100 kB JSON body limit; malformed JSON returns 400.
- Mass-assignment blocked: unknown body fields are stripped, so you can't set `userId` or `id`.
- bcrypt cost raised from 10 to 12 for new hashes (Argon2id comes in Phase 2).
- `/health` and `/health/ready` (checks DB) endpoints.

### Database changes
- New migration `20261103120000_phase0_task_index`: index on `Task(userId, createdAt)`. This matches the task list query exactly. Additive only; no data changes.
- Reset tokens issued before this upgrade stop working, because they're now compared as hashes. Users simply request a new link.

### Dependencies added
Backend: `zod`, `helmet`, `express-rate-limit`, `pino`, `@prisma/adapter-pg`; `prisma`/`@prisma/client` 6.10 → 6.19.3. Frontend: none.

## Tests run
| Suite | Result |
|---|---|
| Backend Jest (auth, tasks, platform, rate-limit) | **43 / 43 pass** |
| Frontend Vitest (Home, TaskForm, api) | **13 / 13 pass** |
| Mutation check: re-introduced B1 and B2 on the backend and B8 on the frontend | the corresponding tests failed, as expected |
| Safety check: tests refuse to run if `TEST_DATABASE_URL` equals `DATABASE_URL` | confirmed |
| Backend `tsc` typecheck + production build + start | pass |
| Frontend `tsc -b` + `vite build` | pass |
| Browser check (headless Chromium, real API + DB) | wrong-password login shows the correct message; overdue task status change and edit work; wrong current password keeps the user logged in |

## What you need to do on your machine
```bash
# backend
cd backend
npm install
# add TEST_DATABASE_URL to .env (see .env.example) and create that empty database once, e.g.
#   psql -U postgres -c "CREATE DATABASE taskforge_test;"
npx prisma migrate dev        # applies the new index migration + regenerates the client
npm test
npm run dev

# frontend
cd ../frontend
npm install
npm test -- --run
npm run dev
```
Recommended: make `JWT_SECRET` at least 32 random characters (yours is 27; the server will refuse to start in production below 32).

## Remaining issues (carried into Phase 2)
- JWT is still kept in `localStorage`, and there are no refresh tokens or revocation. Fixing this needs the session redesign in Phase 2.
- Register still reveals whether an email exists (409). This will be fixed together with email verification in Phase 2.
- Rate limiting is per IP and in-memory (correct for one instance). Per-account lockout comes in Phase 2.
- Password policy is still at least 6 characters. Phase 2 adds Argon2id and a stronger policy.
- There are three existing lint warnings in files I didn't otherwise change.
- The UI design is unchanged on purpose. The new design system arrives with the app shell in Phase 3.
