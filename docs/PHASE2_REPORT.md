# Phase 2 — Identity, multi-tenancy and RBAC: completion report

_3 Nov 2026_

## Summary
TaskForge is now a multi-tenant product. Users belong to one or more **organisations** with one of **six organisation roles** (plus a platform Super Admin). They invite teammates by email and switch between organisations. Every API call is checked against their live membership and role.

Sign-in uses **Argon2id** passwords, **15-minute access tokens kept only in memory**, and **rotating httpOnly refresh cookies with theft detection**. It also adds per-account **lockout**, **email verification**, **session management** and an **audit log**.

Existing data is migrated: every existing user became the admin of a personal organisation that now holds their tasks.

**Tests:** 84 backend (was 43) and 30 frontend (was 13), all passing. I also checked that the tests catch sabotage of four security controls, and ran a two-person browser test end to end.

## What was built

### Database (migration `20261103150000_phase2_tenancy_identity`)
| Table | Purpose |
|---|---|
| `Organization` | Tenant: name and unique slug |
| `Membership` | User ↔ organisation with `OrgRole`; unique per pair |
| `Invitation` | Email + role + **hashed** token, 7-day expiry, single use, revocable |
| `Session` | One row per signed-in device; **hashed** refresh token + previous hash for reuse detection |
| `UserToken` | **Hashed** single-use email-verification and password-reset tokens (replaces `User.resetToken`) |
| `AuditLog` | Append-only security events with actor, target, IP and user agent |
| `User` + | `name`, `emailVerifiedAt`, `isSuperAdmin`, `failedLoginCount`, `lockedUntil` |
| `Task` + | `organizationId` (required, indexed); `userId` renamed to `createdById` |

The migration is hand-written to **preserve data**, because Prisma's generated version would have dropped `Task.userId`. I verified it two ways:
1. Applied to a copy with legacy users and tasks, then checked that organisations, admin memberships and task ownership all came through.
2. Compared the resulting schema with what Prisma generates from `schema.prisma`: they're identical, so `prisma migrate dev` on your machine will report no drift.

It was also applied to the Phase 0 dev database, and its demo user and tasks survived.

### API
| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` (new org *or* invitation), `login`, `refresh`, `logout`, `logout-all`, `verify-email`, `resend-verification`, `forgot-password`, `reset-password/:token`, `GET /auth/me`, `POST /auth/switch-organization`, `GET/DELETE /auth/sessions` |
| Organisations | `POST /orgs`, `GET/PATCH /orgs/current`, `POST /orgs/current/leave`, `GET /orgs/current/members`, `PATCH/DELETE /orgs/current/members/:userId`, `GET/POST/DELETE /orgs/current/invitations`, `GET /orgs/current/audit-logs` (cursor-paginated) |
| Invitations | `GET /invitations/:token` (public preview), `POST /invitations/:token/accept` |
| Platform | `GET /admin/organizations`, `GET /admin/users` (Super Admin; metadata only) |
| Tasks | Same URLs as before, now scoped to the active organisation with role-based permissions |
| User | `PUT /user/change-password` (signs out other devices), `PATCH /user/profile` |

Tenant endpoints use `/orgs/current/...`. The organisation always comes from the server-side session, never from the URL or body. See `docs/adr/0002-sessions-tenancy-rbac.md`.

### Roles and permissions
| | Org Admin | Project Manager | Team Lead | Member | Client | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| View tasks | ✓ | ✓ | ✓ | ✓ | — ¹ | ✓ |
| Create tasks | ✓ | ✓ | ✓ | ✓ | — | — |
| Edit/delete any task | ✓ | ✓ | ✓ | own only | — | — |
| See members | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Invite people | ✓ any role | ✓ roles below PM | — | — | — | — |
| Change roles / remove | ✓ | — | — | — | — | — |
| Rename organisation, audit log | ✓ | — | — | — | — | — |

¹ Clients get access to specific projects in Phase 3. Until then they see a clear "no task access yet" screen.

### Frontend
- **Auth rewritten:** the access token is in memory only. The session is silently restored on reload from the httpOnly cookie, and concurrent 401s share one refresh. The old `localStorage` token is cleared on first load.
- **New pages:** Organisation settings (rename, invite, members with role change and removal, pending invitations, audit log, create organisation, leave); Security (email verification status and resend, active devices, sign out a device or everywhere); Accept invitation; Verify email.
- **Task board:** organisation switcher and role badge in the header, and an unverified-email banner. Edit, delete and status controls only appear when your role allows them, and the server still enforces this. There are screens for Client and no-organisation users.
- Register asks for an organisation name, or joins the inviting organisation when it comes from an invite link.

## Security tests (each proven to fail if the control is removed)
| Threat | Test | Sabotaged control → result |
|---|---|---|
| Cross-tenant access | Other org's task returns 404 on GET/PATCH/DELETE; switching into a foreign org returns 403; a validly signed token for a foreign org returns 403 | Membership check removed → **2 tests fail** |
| Stolen/replayed session | Logout, logout-all, device revoke, password reset and password change take effect immediately | Session revocation ignored → **6 fail** |
| Privilege escalation | Member can't self-promote; PM can't invite Admin or PM; unknown roles rejected; last admin protected | Role rule removed → **1 fails** |
| Refresh token theft | Replayed rotated token revokes the session and is audited; multi-tab race tolerated | Reuse revocation removed → **1 fails** |
| IDOR | Other users' sessions and other orgs' invitations return 404 | — |
| Tampering / mass assignment | Edited JWT → 401; `organizationId`/`createdById` in body ignored | — |
| Brute force | Per-IP 429; per-account lockout after 5 failures; reset clears it | — |
| Enumeration | Register and forgot-password responses identical for known and unknown emails | — |
| CSRF | Refresh/logout need the custom header and an allowed Origin | — |
| Token storage | Refresh, reset, verify and invite tokens all stored as SHA-256 | — |
| Role changes | Demotion and removal apply on the very next request | — |

**Browser end-to-end check** (headless Chromium against the real API and database):
1. A legacy-password user signs in, and their hash upgrades.
2. A reload keeps the session, with `localStorage` empty and the cookie httpOnly.
3. The admin invites Bob. Bob registers from the link (email pre-filled and locked), sees shared tasks as Team Member and can edit only his own.
4. The admin demotes Bob to Viewer, and Bob's next load is read-only.
5. "Sign out everywhere" works. No server errors were logged.

## Dependencies added
Backend: `argon2` (prebuilt binaries include Windows x64), `cookie-parser`. Frontend: none.

## What you need to do on your machine
```bash
cd backend
npm install
npx prisma migrate dev      # applies the Phase 2 migration and regenerates the client
npm test
npm run dev
# optional: make yourself platform Super Admin
npm run make-super-admin -- you@example.com

cd ../frontend
npm install
npm test -- --run
npm run dev
```
Everyone needs to **sign in once again** after the upgrade, because old tokens are no longer accepted. Existing accounts are marked email-verified. Without `EMAIL_USER`/`EMAIL_PASS`, verification, reset and invitation links are printed in the backend console in development.

## Remaining issues (honest list)
| Item | Plan |
|---|---|
| **MFA (TOTP)** not built | Phase 9 hardening |
| **Teams** and team-level access | Phase 3, alongside projects (team access only matters once projects exist) |
| Client project access | Phase 3 (project membership), Phase 8 (client portal) |
| Organisation branding, usage statistics, deletion | Phase 8 |
| Super Admin has API + CLI only, no UI | Phase 8 admin console |
| Rate-limit counters are in-memory (correct for one server) | Shared store when scaling out (Phase 9) |
| Refresh sessions slide for 30 days with no absolute maximum | Add an absolute cap in Phase 9 |
| Two lint warnings (one existing, one in `AuthContext` that's intentional) | — |
| UI still uses the Phase 0 visual style | New design system and app shell in Phase 3 |
