# ADR 0002 — Sessions, tenant resolution and RBAC

**Status:** Accepted · Phase 2 · 3 Nov 2026

## 1. Sessions: short access token in memory + rotating refresh cookie
- **Access token:** a 15-minute HS256 JWT `{sub, sid, org}` with issuer and audience checked. The browser keeps it in a JavaScript variable only, never in `localStorage`, so an XSS bug can't steal a long-lived credential.
- **Refresh token:** 256 random bits in an `httpOnly; SameSite=Strict; Path=/auth` cookie (`Secure` in production). Only its SHA-256 is stored, in `Session.refreshTokenHash`.
- **Rotation with reuse detection** (OAuth 2.0 Security BCP §4.14): every refresh issues a new token and moves the old hash to `previousTokenHash`. If a rotated-out token comes back more than 30 s later, someone else holds a copy, so the whole session is revoked and the event is audited. A reuse within 30 s returns `409 REFRESH_RACE`, because two tabs refreshing at once is normal. The client then retries once with the newer cookie.
- **Immediate revocation:** `authenticate` checks the session row on every request (one primary-key lookup). Logout, "sign out everywhere", revoking a device, a password reset and a password change (which keeps the current device) all take effect at once, not when the token expires.
- **CSRF:** the two cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) require the `X-TaskForge-CSRF: 1` header and an allowed `Origin`. The custom header forces a CORS preflight that foreign origins fail. This is on top of `SameSite=Strict`.

## 2. Tenant resolution: the server chooses, the database confirms
- The active organisation is stored on the **session** and copied into the signed token. Requests never carry an org id that the server trusts.
- `requireTenant` re-reads `Membership(organizationId, userId)` on every request and takes the **role from the database**, not from the token. A removed member gets `403 NOT_A_MEMBER`, and a demoted admin loses permissions on their very next request.
- Switching organisation (`POST /auth/switch-organization`) is authorised by that same membership check and issues a new token.
- Every tenant query filters by `organizationId` from this context, in the write itself too (`updateMany/deleteMany where {id, organizationId}`). Cross-tenant ids return 404, the same as missing ids.

## 3. RBAC defined in code
- Seven roles: `isSuperAdmin` on User, plus six organisation roles on Membership. Each role maps to a permission list in `core/rbac.ts`. The mapping is versioned, reviewed and tested with the code, which avoids permission tables that would drift.
- Route guards check *"may this role do X at all?"*. Services check resource rules such as *"MEMBER may edit only tasks they created"*.
- **Escalation rule:** only an `ORG_ADMIN` may grant any role; everyone else may only grant roles strictly below their own. The last admin can't be demoted, removed or leave.
- **Super Admin** sees platform metadata (organisations, users, counts) but gets **no tenant data access**. The flag can only be set by a CLI script; there's no API for it.

## 4. Passwords and brute force
- Argon2id (19 MiB, t=2, p=1, the OWASP baseline, chosen to be laptop-friendly). Legacy bcrypt hashes are verified and upgraded transparently on the next login.
- Per-IP rate limits on `/auth/*`, plus per-account lockout (5 failures → 15 min). The lockout responds differently from a wrong password, so it reveals the account exists. That's an accepted, common trade-off; registration and forgot-password don't reveal it.
- Password policy: 8–128 characters plus a deny-list of common passwords (NIST SP 800-63B: length over composition rules).

## Consequences
- Each authenticated request costs two small indexed lookups (session + membership). A short-TTL cache can be added if profiling ever shows it matters.
- Existing users must sign in again once after this upgrade: old tokens lack `sid`/`iss`/`aud`, and `localStorage` tokens are cleared.
