# Phase 4 — Collaboration: comments, mentions, notifications, live updates

**Status:** complete · **Branch:** `phase-3` (Phase 4 commits stacked on Phase 3) · **Date:** 2026-11-04

## What was built

### Comments

**Threads.** Comments sit on tasks, with one level of replies so threads stay readable. A deleted comment that has replies stays as a "comment deleted" placeholder.

**Who can do what:**
- Everyone who can see the task can comment, including clients on their projects.
- Org Viewers can read comments but not write them.
- Only the author can edit; the comment shows "(edited)".
- The author can delete their own comment, and a project manager can delete anyone's. A manager's deletion is recorded in the audit log.
- Archived tasks and archived projects can't be commented on.

**Formatting.** A small markdown subset: **bold**, *italic*, `code`, http(s) links and line breaks. Comments are rendered as React elements, never as HTML, so `<script>` and `onerror=` attributes show up as text. `javascript:` links are never linked.

**Reactions.** A fixed set (👍 👎 🎉 ❤️ 😄 👀 🚀 ✅) that can be toggled on and off.

**Watching.** Commenting on a task automatically makes you a watcher.

**Rate limit.** Writes are limited per user (30 per minute), so a script can't flood a thread or everyone's inbox.

### Mentions

- **Picking.** Typing `@` opens a picker; arrow keys move, Enter or Tab picks, and Escape closes it. Names typed without the picker stay plain text.
- **Server checks.** Only people who can see the task can be mentioned. Anyone else becomes plain `@text` and isn't notified.
- **No impersonation.** The display name is rewritten to the person's real name, so `@[CEO](user:7)` can't pose as someone else.
- **Edits.** Editing a comment notifies only the people newly mentioned.

### Notifications

**Types:**
- Mentioned
- New comment on a task you watch
- Assigned to you
- Status changed on a task you watch
- Approval requested
- Approval decided
- Due tomorrow

**Who gets them.** Never the person who caused the change. Recipients are re-checked when the notification is sent: anyone who has lost access to the project gets nothing.

**Bell and inbox.**
- A bell with an unread badge and an inbox panel.
- Clicking a notification opens the task and marks it read.
- Opening a task marks all of its notifications read.
- "Mark all read" clears the rest.
- Notifications stay separate per organization.

**Email:**
- On by default only for things that ask something of you: mentions, assignments and approval requests.
- Each person picks their own email types under Settings → Notifications; in-app notifications are always on.
- Everything user-written is HTML-escaped in emails.
- Without SMTP configured, emails are written to the server log, and the settings page says so.

**Due-tomorrow reminders.** An hourly job sends at most one reminder per task per day. A database lock lets only one server process run it.

### Live updates

**How it works:** Server-Sent Events over Postgres LISTEN/NOTIFY. This works across several API processes and needs no Redis, which fits the lightweight architecture.

**Events carry ids only, never content.** The browser refetches through the normal, permission-checked API, so the live stream can't leak data.

**Each connection only gets signals:**
- For its own organization.
- For projects the person can see.
- For notifications addressed to them.

**Security:**
- The stream needs a valid access token.
- Every minute it re-checks the session and membership; a revoked session or removal from the org closes it.
- It also closes when its access token expires, and the browser reconnects with a fresh one.
- Each user can have at most 5 streams open.

**In the browser:**
- One connection per tab.
- After a reconnect it backs off, then refetches everything in case something was missed.
- It skips echoes of your own changes.
- The sidebar shows whether live updates are on.

### Activity feed

The project Overview has a "Recent activity" card that merges task changes and comments, newest first.

## Verification

| Check | Result |
|---|---|
| Migration check: a database built from the migrations equals one built straight from the schema | identical (additive only) |
| Backend tests (Jest + real Postgres, real SSE over HTTP) | **162 passed** (17 new) |
| Mutation tests: 8 controls disabled one at a time (mention visibility, stream org/project/recipient filters, revoked streams, notification access, email escaping, viewer write block) | each one fails a test |
| Frontend tests (Vitest) | **57 passed** (10 new) |
| Mutation tests: 2 UI rules broken (javascript: links, viewer comment box) | each one fails a test |
| Typecheck, lint, production build | clean |
| Two-browser E2E against real API and DB (Playwright) | **15/15 checks** |

In the two-browser run, Maya and Sam were signed in at the same time:
- Maya moved a card and Sam's board followed without a reload.
- Maya @mentioned Sam using the picker, and the comment appeared live in Sam's open task. The mention showed as a chip, the link was clickable, and `<script>` appeared as plain text.
- Sam's reply appeared live for Maya.
- Sam's bell showed the mention, and opening the task marked it read.
- Maya was notified of the reply as a watcher.
- The mention email was generated; the plain comment wasn't emailed.
- The activity feed showed the comments.
- Sam's email preference was saved.

### Found and fixed during this phase

- **A test gap.** Disabling the stream's organization check didn't fail any test. Isolation still held, because the project and recipient filters also block other-org events, but the check wasn't proven on its own. I added a test that sends an organization-wide event to org A and confirms org B never receives it.
- **A hanging test.** The revocation test could hang the whole run when it failed; it now always closes its stream.

## Remaining issues (honest list)

- **No retry for missed emails.** Emails are sent right after the notification is created. If the server stops in between, that email isn't retried; the in-app notification is still there.
- **No email batching.** There is no digest; each email-enabled notification is its own message.
- **No presence.** There's no "who's viewing this task" indicator, and no typing indicator.
- **No comment attachments.** Comments can't carry files, though tasks can.
- **No comment search.** Search covers task titles and descriptions only.
- **Reverse proxies.** In production, a proxy must not buffer `/events`. The stream sends `X-Accel-Buffering: no` for nginx; other proxies need the same setting (covered in Phase 9).
- **Carried over** from earlier phases: the 500-row list cap, no position rebalancing, no code splitting, and no virus scanning of uploads.
