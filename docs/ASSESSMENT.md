# TaskForge — Phase 1 Assessment

_Assessed: 3 Nov 2026 · Codebase: `taskmanager` (2 commits + uncommitted work) · ~3,100 lines_

---

## 1. Existing project analysis

### What exists today

| Layer | Stack | Notes |
|---|---|---|
| Backend | Node 22, Express 5, TypeScript, Prisma 6, PostgreSQL | Single-file controllers, no service layer |
| Auth | bcrypt (cost 10), `jsonwebtoken` (1-day token), nodemailer via Gmail | Register, login, forgot/reset password, change password |
| Frontend | React 19, Vite 8, Tailwind 4, axios, React Router 7, react-hot-toast | One page (`Home`) + 5 auth pages |
| Tests | Jest + supertest (backend), Vitest + Testing Library (frontend) | 3 test files, all currently broken (see §4) |
| Data model | `User`, `Task` (title, description, status, dueDate, userId) | 3 status values, no priority |

### Working features (to preserve)
- Registration with email normalisation and duplicate check
- Login with generic "invalid email or password" message
- Forgot password → emailed reset link (15-min expiry) → reset page that shows the account email
- Change password (requires current password)
- Per-user task CRUD with ownership enforced server-side (`findFirst({ id, userId })`) — **no IDOR today**
- Inline status change, client-side title search, delete confirmation modal
- Dashboard counts (total / completed / pending) computed from real data
- Toasts, loading screen, error screen with retry

### Uncommitted work ⚠
`Login`, `Register`, `ForgotPassword`, `ResetPassword`, `ChangePassword`, `AuthContext`, `ProtectedRoute`, `background.jpg` are **untracked**, and 5 files are modified. This should be committed before any upgrade work begins so nothing can be lost.

---

## 2. Current architecture assessment

```
React (Home.tsx holds all state) ──axios + Bearer JWT from localStorage──▶ Express
                                                                   ├─ /auth  → authController (394 lines)
                                                                   ├─ /tasks → taskController
                                                                   └─ /user  → mounted in server.ts, not app.ts
                                                                         │
                                                                     Prisma ──▶ PostgreSQL
```

**Strengths:** sensible, mainstream stack that suits the hardware; TypeScript on both sides; Prisma migrations already in place; ownership checks on every task query.

**Weaknesses:**
- **No layering** — HTTP, validation, business logic and DB access are mixed in controllers; nothing is reusable by WebSockets, jobs or AI tools later.
- **No central error handling / validation** — every handler repeats `try/catch` and hand-written checks; bad input types crash into 500s.
- **Config is scattered and hardcoded** — port `3000`, CORS origin, reset-link URL and API base URL are literals even though `.env` defines `PORT` and `FRONTEND_URL`. No startup validation of required secrets.
- **Single-tenant by design** — `Task.userId` is the only scoping key; there's no concept of organisation, project or team.
- **Frontend state is page-local** — `Home.tsx` owns fetching, mutations and filtering; no data-cache layer, no layout shell, no design tokens (white form card on a dark glass UI, emoji icons).
- **No DB indexes** beyond the PK and `User.email` — PostgreSQL does not auto-index foreign keys, so `Task.userId` lookups will scan.

---

## 3. Bugs found

| # | Where | Bug | Effect |
|---|---|---|---|
| B1 | `api.ts` 401 interceptor | Fires on **every** 401, including wrong-password login and wrong current-password | Failed login shows "Session expired"; a wrong current password on Change Password **logs the user out** |
| B2 | `taskController` create/update | "Due date cannot be in the past" also runs on update, and `handleStatusChange` re-sends the existing date | **Status of an overdue task can't be changed** (400) |
| B3 | `authController.register/login` | `email.trim()` runs before the presence check | Missing email → `TypeError` → 500 instead of 400 |
| B4 | `forgotPassword` | Email not lower-cased | Users who type a capital letter get "User not found" |
| B5 | `taskController` | `Number(req.params.id)` not validated | `/tasks/abc` → Prisma error → 500 |
| B6 | `updateTask` | Empty/whitespace title accepted; non-string title crashes; invalid date string → 500 | Data quality + 500s |
| B7 | `server.ts` | `/user` routes mounted outside `app.ts` | Change-password route is invisible to supertest; inconsistent wiring |
| B8 | `TaskForm` | Editing a task without a due date after one with a date keeps the old date; date `min` blocks editing overdue tasks; no Cancel for edit mode | Wrong data saved silently |
| B9 | Date checks | `setHours` uses server-local time | Off-by-one-day near midnight for IST vs UTC servers |
| B10 | Tests | Task tests send no token (always 401); depend on a seeded `bird@gmail.com`; hardcoded July 2026 due dates now in the past; `Home.test` renders without Router/AuthProvider | **Entire test suite fails** |
| B11 | Migrations | `20260722174134_add_password_reset` is empty | Harmless but noise |
| B12 | `frontend/index.html` | Title is "frontend"; `TaskList.tsx` is an empty file | Polish |

---

## 4. Security assessment (OWASP Top 10 lens)

| Severity | Finding | OWASP |
|---|---|---|
| **High** | JWT stored in `localStorage` — any XSS steals a 24-hour session | A07 |
| **High** | No token revocation: password change/reset leaves every existing token valid for up to 24h | A07 |
| **High** | No rate limiting or lockout on login, forgot-password, reset — brute force and email-bombing via Gmail are possible | A07 / A04 |
| **High** | Password reset tokens stored **in plaintext** in the DB (DB leak = account takeover for 15 min) | A02 |
| Medium | User enumeration: forgot-password returns 404 "User not found"; register returns 409 | A07 |
| Medium | `JWT_SECRET` is 27 characters; algorithm not pinned in `jwt.verify`; missing secret only fails at request time | A02 / A05 |
| Medium | Password policy: 6 characters minimum, no breach/complexity check | A07 |
| Medium | No `helmet` security headers; no explicit body-size limit | A05 |
| Medium | No input schema validation (type confusion → 500s; prerequisite for everything else) | A03 / A04 |
| Medium | `console.error(error)` only — no structured logs, no audit trail of sensitive actions | A09 |
| Low | `getResetUser` reveals the account email to anyone holding the link | A01 |
| Low | bcrypt cost 10 — acceptable, but spec asks for Argon2id | A02 |
| ✅ Good | `.env` is git-ignored and has never been committed; Prisma parameterises queries (no SQL injection found); task ownership is enforced server-side; login error message is generic | — |

None of these are fixed yet. Each will be fixed in Phase 2 **with a test that proves it**.

---

## 5. Feature gap analysis (vs. the TaskForge spec)

| Area | Have | Missing (summary) |
|---|---|---|
| Auth & security | Basic JWT, reset, change password | Refresh rotation, sessions, Argon2id, MFA, email verification, rate limits, audit log, headers |
| Multi-tenancy | — | Organisations, invitations, memberships, org switching, branding, tenant-scoped queries |
| RBAC | — | 7 roles, permission map, project/team-level access, enforced in API |
| Tasks | CRUD, 3 statuses, due date | Priority, assignees, subtasks/checklists, dependencies, labels, custom fields, recurrence, estimates, attachments, templates, bulk ops, watchers, history, saved filters, archiving, approvals |
| Views | Card grid | Kanban, list, calendar, timeline, Gantt, My Tasks |
| Projects | — | Projects, milestones, roadmaps, health, progress, budgets, client approvals |
| Collaboration | — | Comments/threads, @mentions, activity feed, notifications, WebSockets, file sharing, workload |
| Analytics | 3 counters | Full dashboard, trends, filters, exports |
| Automation | — | Rule engine, UI, execution log, loop protection |
| AI | — | Everything (modular provider + fallback) |
| Commercial | — | Client portal, plans, limits, trials, billing sandbox |
| Ops | — | Docker, CI, health checks, logging, backups, docs |

**Honest scope note:** the full spec is what a small product team ships over many months. I'll deliver it phase by phase, each phase working and tested before the next begins, and I'll flag anything I defer rather than leave stubbed buttons.

---

## 6. Proposed upgraded architecture

### Principle: modular monolith, one Postgres, nothing heavy required
Fits an i5-1335U / 16 GB laptop: one Node process + Postgres (+ optional Redis) in Docker Compose, well under 2 GB RAM.

```
frontend/ (React 19 + Vite + Tailwind 4)
  app shell · design system · TanStack Query cache · socket client · feature folders

backend/src/
  core/      config (zod-validated env) · logger (pino) · errors · db (Prisma)
             auth (access + refresh) · tenant context · rbac · rate-limit · audit
             events (in-process bus) · jobs (pg-boss) · realtime (socket.io) · storage
  modules/   auth · users · organizations · members · teams · projects · milestones
             tasks · comments · attachments · notifications · activity
             analytics · automations · ai · billing · admin
             (each: routes → controller → service → repository, zod schemas, tests)
```

### Key decisions

| Concern | Decision | Why |
|---|---|---|
| Keep stack | Express 5 + Prisma + PostgreSQL + React/Vite/Tailwind | Already working; no rewrite needed |
| Validation | `zod` schemas on every route | Fixes B3/B5/B6 class of bugs; types shared with frontend |
| Background jobs | **pg-boss** (queue inside Postgres) | No Redis required to run locally; Redis added only as an optional cache |
| Realtime | socket.io, rooms per org/project, auth on handshake | Simple, works behind proxies |
| Tenancy | Shared schema, `organizationId` on every tenant table; org resolved from URL slug **and verified against the caller's membership** on the server; repository helpers that always inject it | "Never trust tenant IDs from the frontend" |
| Auth tokens | 15-min access token held **in memory**; refresh token in `httpOnly; Secure; SameSite=Strict` cookie, stored **hashed** in a `Session` table, rotated on use with reuse detection | Fixes localStorage + revocation findings |
| Passwords | Argon2id; existing bcrypt hashes verified and transparently re-hashed on next login | No forced resets for existing users |
| RBAC | Roles + permission map defined in code; org role + optional project-role override; `requirePermission()` middleware + service-level checks | Avoids over-engineered permission tables; custom roles can come later |
| IDs | New tables use string `cuid` IDs; existing int IDs migrated | Non-enumerable IDs as defence-in-depth |
| AI | `AIProvider` interface: OpenAI-compatible HTTP (works with **Ollama** locally or a cloud key) + deterministic rule-based fallback; AI proposes, user confirms | Optional, swappable, never auto-executes |
| Files | `StorageProvider` (local disk now, S3-compatible later), MIME sniffing, size limits, signed download URLs | Secure uploads without a cloud dependency |

### Core schema (Phase 2–3 subset)
`User · Session · Organization · Membership(role) · Invitation · Team · TeamMember · Project · ProjectMember(role?) · Task(organizationId, projectId, parentId, assigneeId, priority, status, startDate, dueDate, estimate, actual, position, archivedAt, deletedAt) · TaskDependency · Label · TaskLabel · ActivityLog · AuditLog`
Later phases add: `Comment · Attachment · Notification · Milestone · SavedView · CustomField · Automation · AutomationRun · Subscription · Plan`.

Existing data migration: each existing user gets a personal organisation (they become Org Admin) and their tasks move into a default "My Tasks" project — nothing is lost.

---

## 7. Prioritised implementation roadmap

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **0 — Stabilise** (first) | Commit current work; fix B1–B12; restructure into `core/` + `modules/`; zod validation; central error handler; env validation; helmet; isolated test DB + fixed test suite | All existing features still work; test suite green |
| **2 — Identity & tenancy** | Argon2id, refresh-token sessions, logout-all, rate limits/lockout, email verification, hashed reset tokens, organisations, invitations, memberships, org switcher, 7-role RBAC, audit log | Tests for: brute-force lockout, token reuse, cross-tenant denial, privilege escalation, IDOR |
| **3 — Tasks & projects** | Projects, members, priorities, assignees, subtasks, checklists, dependencies, labels, history, archive, bulk ops, filters, saved views; Kanban / List / My Tasks / Calendar / Timeline / Gantt; milestones, progress, health | All views read one API; drag-and-drop persists |
| **4 — Collaboration** | Comments, threads, @mentions, attachments, notifications centre, activity feed, socket.io realtime, workload view | Two browsers see live updates |
| **5 — Analytics** | Dashboard from SQL aggregates, filters, CSV/PDF export | Numbers reconcile with raw records in tests |
| **6 — Automation** | Trigger → condition → action engine on pg-boss, rule builder UI, run log, idempotency + loop guard | Loop and duplicate tests pass |
| **7 — AI** | NL task creation, breakdown, prioritisation, summaries, risk/workload analysis, assistant — with confirm-before-apply and offline fallback | Works with AI disabled |
| **8 — Commercial** | Client role & portal, approvals, plans/limits, trial, Stripe test-mode billing, branding | Limits enforced server-side |
| **9 — Harden & ship** | Security test pass, perf (indexes, N+1), Docker/Compose, GitHub Actions CI, backups, deployment docs, E2E (Playwright) | CI green on every push |

### How I'll work
- Build and test in an isolated workspace with a throwaway PostgreSQL, then write changes back to this folder. Your Windows `node_modules` are left alone — you'll run `npm install` after each phase.
- Each phase ends with a completion report: files changed, migrations, tests run and their results, and remaining issues.
