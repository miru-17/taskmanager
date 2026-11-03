# Phase 3b — Custom fields, templates, recurring tasks, attachments, approvals

**Status:** complete · **Branch:** `phase-3` · **Date:** 2026-11-03

This finishes Phase 3. Phase 3a (projects, teams, the task model and the views) is in `PHASE3A_REPORT.md`.

## What was built

### Custom fields

**What they are.** Typed fields defined per project:
- Types: text, number, date, single select, multi select, checkbox, link and person.
- Each field can be marked required and given help text.
- Select options have colours.

**Who manages them.** Only project managers can create, edit or delete field definitions.

**Server-side validation.** Every value is validated by the server against its field type:
- Links must be `http` or `https`, so a `javascript:` link can never be stored or clicked.
- People must be members of the organization.
- Select values must be one of the field's current options.
- Required fields are enforced when a task is created and whenever someone tries to clear them.

**Option cleanup.** Removing an option clears it from every task that had it selected.

**UI:**
- An editor for each field type in the task panel.
- The same editors in the New task dialog.
- A field manager in project Settings.

### Templates

- **Saving.** "Save as template" on any task snapshots its title, description, priority, estimate, labels, checklist and up to 50 subtasks. It also keeps the task's duration relative to its start.
- **Scope.** A template is either limited to one project, in which case it keeps custom field values, or offered in every project.
- **Using one.** In the New task dialog, pick a template. Its checklist and subtasks are created in a single transaction.
- **Re-checking on use.** Labels deleted since the template was saved are skipped. Required fields are enforced again.
- **Permissions.** Team leads and above manage templates. Anyone who can create tasks can use them.

### Recurring tasks

- **Rules.** Daily, weekly (on chosen weekdays), monthly or yearly, every N periods. A series can end on a date or after N occurrences.
- **Date handling.** Month ends are clamped, so a series anchored to Jan 31 continues Feb 28, then Mar 31. Feb 29 is handled.
- **How the next one appears.** It is created **when the current one is completed**, so there is no background job that could fire twice.
- **What carries over.** Assignee, labels, checklist and custom field values. A row lock means two simultaneous completions still create exactly one next task.
- **UI.** A Repeat section in the task panel shows the rule and links to the previous and next occurrence.

### Attachments

**Storage.** Files are stored on local disk under `UPLOAD_DIR`, behind a small storage interface so they can move to S3-compatible storage later. Each file is saved under a random server-generated name, never the name it was uploaded with.

**Upload rules:**
- An allow-list of file types (images, PDF, text, CSV and JSON, zip, Office formats).
- The file's first bytes must match its extension, so a renamed executable or an HTML page posing as a `.png` is rejected.
- Limits per file, per task and per organization. The org quota is checked under a lock, so parallel uploads can't sneak past it.

**Download rules:**
- Files can only be downloaded by people who can see the task.
- Downloads are sent with `nosniff`, a sandboxing Content-Security-Policy and `no-store`.
- Only images and PDFs can be shown in the browser; everything else downloads.

**Who can delete.** The uploader, or someone who can edit every task in the project. Deleting a project also removes its files from disk.

**UI.** Upload with a button or drag and drop, with upload progress. Files can be viewed or downloaded, and the panel shows storage usage.

### Approvals

**Requesting.** Any task can be sent for sign-off to named approvers, with a rule of *any one* or *every one* and an optional note. The task moves to In review.

**Who can approve:**
- Clients can approve, which is how they sign off deliverables.
- Viewers can't, including someone demoted to Viewer after being named.
- Nobody can approve their own request.
- Every approver must be able to see the project.

**Outcomes:**
- **Approval:** completes the task automatically. If unfinished blocking tasks remain, it waits for them instead.
- **Rejection:** sends the task back to In progress with the approver's comment.
- **Cancelling:** the requester or a project manager can cancel a pending request.

**Optional project policy.** A setting that requires approval before any task can be completed. Each approval is used once, so reopening a task needs a new approval. Creating a task directly as Done also respects the policy.

**UI:**
- An Approvals page with "Waiting on me" and "Requested by me".
- A sidebar badge showing how many approvals are waiting.
- An approval section in the task panel.
- The policy toggle in project Settings.

## Verification

| Check | Result |
|---|---|
| Migration check: a database built from the migrations equals one built straight from the schema (enum order included) | identical |
| Backend tests (Jest + real Postgres) | **145 passed** (29 new) |
| Mutation tests: 7 security controls disabled one at a time | each one fails a test |
| Frontend tests (Vitest) | **47 passed** (11 new) |
| Mutation tests: 2 UI rules broken | each one fails a test |
| Typecheck, lint, production build | clean |
| Browser E2E against real API, DB and disk storage (Playwright) | **20/20 checks** |

The browser checks confirmed each result in the database or on disk:
- Field values are saved, and a `javascript:` link is refused.
- A disguised HTML "png" is rejected, and a real PNG is stored under a random name and downloads byte-for-byte identical.
- Requesting approval moves the task to In review, and marking it done while approval is pending is refused.
- A client sees the badge, can't edit or upload, and approves, which completes the task.
- Completing a weekly-Friday task creates the next one, due on a Friday.
- A template saved from a task applies with its 3 checklist items and its subtask.
- With the approval policy on, direct completion is refused.

### Found and fixed during this phase

1. An approver demoted to Viewer could still decide; they now can't, and a test covers it.
2. The approval-policy checkbox only flipped after the server responded; it now flips immediately.

## Configuration (new, all optional)

`UPLOAD_DIR` (default `storage/uploads`, ignored by git), `MAX_UPLOAD_MB` (10), `MAX_ATTACHMENTS_PER_TASK` (20), `ORG_STORAGE_QUOTA_MB` (1024). Back up `UPLOAD_DIR` along with the database.

## Remaining issues (honest list)

- **Attachments:**
  - No virus scanning; uploads are type-checked but not scanned.
  - Files are held in memory while uploading, which is fine at 10 MB.
  - There are no image thumbnails.
  - A file whose database row is deleted while it is still being written can leave an orphan file. There is no cleanup job yet.
- **Recurrence:** the next occurrence appears only when the current one is completed. A series nobody completes never moves forward; there is no calendar-driven creation.
- **Approvals:** there are no notifications yet. Approvers find requests through the sidebar badge, which refreshes every minute, or the Approvals page. Email and in-app notifications are Phase 4.
- **Custom fields:** they can't be filtered, sorted or shown as list columns yet. They are only edited in the task panel and the New task dialog.
- **Templates:** they can't be edited after saving (delete and save again), and they don't store assignees or dependencies.
- **Carried over from 3a:** the 500-row list cap, position rebalancing, moving tasks between projects, restoring soft-deleted tasks, no code splitting, and no real-time updates.
