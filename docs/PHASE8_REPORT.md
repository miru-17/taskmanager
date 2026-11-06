# Phase 8 — Commercial

**Status:** complete · **Branch:** `phase-3` · **Date:** 2026-11-06

Exit criterion from the plan: *limits enforced server-side*. They are. Every limit is checked by the API, inside the same transaction as the change where a race is possible. The UI only displays the limits and explains the server's 402 responses.

## What was built

### Plans and limits (`backend/src/core/plans.ts`)

| | Free | Pro | Business |
|---|---|---|---|
| Team members (all roles except Client, pending invitations included) | 5 | 25 | Unlimited |
| Clients (pending invitations included) | 2 | 25 | Unlimited |
| Active projects (archived don't count) | 3 | 50 | Unlimited |
| File storage | 500 MB | 10 GB | 100 GB |
| Enabled automations | 3 | 50 | Unlimited |
| AI model calls a month | 50 | 2,000 | 20,000 |
| Logo and brand colour | No | Yes | Yes |

**Where the limits are checked:**
- **Seats:** on invitation, on accepting an invitation, on registering through one, and on role changes that move someone between internal and client. Re-sending an invitation doesn't count twice.
- **Projects:** on creating one and on restoring one from the archive.
- **Storage:** on upload. The server-wide `ORG_STORAGE_QUOTA_MB` still applies on top.
- **Automations:** on creating an enabled rule and on switching one on.
- **AI:** past the monthly allowance, AI features keep working with the built-in rules (reason `plan_limit`). Rule-based answers are never counted.
- **Branding:** a paid plan or trial is required.

**Races.** Seat and project checks run under a per-organization Postgres advisory lock, so parallel requests can't overshoot. A test proves the create waits while another connection holds the lock.

**Downgrades never delete anything.** Over-limit data stays; only adding more is blocked. Every refusal is a `402 PLAN_LIMIT` with `{limit, plan, max, used}` and a message that says what to do.

### Trial
- One 14-day Pro trial per organization, started by an org admin from Free.
- A conditional update stops double starts. It's audited.
- When the trial ends, Free limits apply again, with nothing removed.
- A trial never lowers a paid plan.

### Billing: Stripe test mode
- **Only test keys.** Config rejects anything that isn't `sk_test_…`.
- **Checkout:**
  - Creates one Stripe customer per organization (idempotency key) and a subscription Checkout session tied to the organization.
  - Admins only (new `billing:manage` permission).
  - The plan doesn't change on return from Checkout, only when Stripe confirms through the webhook.
- **Billing portal** for card changes and cancellation.
- **Webhook `/billing/webhook`:**
  - The signature is verified over the raw body with a 5-minute tolerance.
  - Each event is applied exactly once: the event id is stored in the same transaction as the change.
  - Subscription state is **re-read from Stripe**, so out-of-order events can't regress the plan.
  - `active`, `trialing` and `past_due` keep the paid plan; anything else means Free.
  - A subscription whose customer doesn't match the organization is ignored, so metadata can't move a subscription onto someone else's org.
  - Plan changes are audited.
- **Without Stripe**, the page says so. Operators can run `npm run plan:set -- <org-slug> <FREE|PRO|BUSINESS>` (audited).

### Client portal
- Clients land on **/portal**, which shows:
  - their organization's logo and name;
  - tasks **waiting for their approval** (one click opens the task to approve or reject);
  - **only the projects they were added to**, with progress, health and due date.
- Clients get no billing page or billing API (403), no AI, no automations and no teams, as before.

### Branding
- Org admins on a paid plan or trial can upload a logo and set a brand colour.
- **Logos:**
  - PNG, JPEG or WebP, **sniffed from the bytes** (SVG refused because it can carry script), up to 512 KB.
  - Served only to members of that organization, with `nosniff` and `default-src 'none'`.
- **Brand colours:**
  - Must have at least 4.5:1 contrast with white, so button text stays readable. Too-light colours are refused with the measured ratio.
  - Dark mode uses a lighter tint with dark text.
  - The colour replaces the accent everywhere, including the portal.

## Verification

| Check | Result |
|---|---|
| Backend tests | **229 passed** (13 new) |
| Mutation tests | 12 bugs introduced one at a time: pending invites not counted, no lock, no re-check on accept, no customer guard, trusting the event over Stripe, no event dedupe, repeatable trial, no AI allowance, no unarchive check, no role-change seat check, logo not sniffed, and the clients' billing 403. **Each one fails a test.** |
| Frontend tests | **90 passed** (6 new) |
| Browser run (real server, real browser) | **18/18 checks**: Free refuses the 4th project with the reason shown; the billing meters match the database; the trial lifts the limit; a too-light colour is refused; the brand colour and a real PNG logo are applied; the client lands on the portal, sees only their project, approves from it, and gets no billing or AI; when the trial ends, existing data is kept and new additions are refused; dark mode, phone width, no browser errors |

### Found and fixed during this phase
- **Clients could read billing.** They could see plan usage and seat counts through `GET /billing`, because they have `org:read`. It now requires `members:read`, with a test.
- **Test reset missed a table.** The test reset didn't clear the new Stripe event table, so a second run treated an old event id as a duplicate. That was the product guard working correctly; the reset now clears it.
- **A parallel test couldn't catch a missing lock.** The parallel-create test passed even with the lock removed. It was replaced by a deterministic test that holds the lock from another connection.

## Honest limitations
- **No real Stripe call was made.** This workspace can't reach Stripe. Checkout, portal and webhooks are tested with Stripe's own signature algorithm and a scripted Stripe client.
- **To try it for real:**
  1. Create a test-mode product with two prices.
  2. Set the four `STRIPE_*` variables.
  3. Run `stripe listen --forward-to localhost:3000/billing/webhook`.
- **Prices aren't shown in the app.** They live in Stripe. No proration preview, invoices page or tax handling yet.
- **Billing is a flat monthly price per organization, not per seat.**
- **Clients see all comments** on tasks in their projects. There's no "internal only" comment yet.
- **Plans are defined in code.** Changing limits is a code change, not an admin screen.
