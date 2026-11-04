# Phase 6 — Automation

**Status:** complete · **Branch:** `phase-3` (stacked on Phases 3–5) · **Date:** 2026-11-04

Exit criterion from the plan: *loop and duplicate tests pass*. They do:
- in unit tests,
- against the real pg-boss worker,
- in a browser run against the running server.

## What was built

### The rule language

A rule belongs to one project and reads as **when** → **only if** → **then**. The UI shows every rule as one sentence, for example:

> When a task is created, if priority is Critical and the title contains "bug": add the label "urgent", notify project managers and comment "Escalated to the project leads."

| Part | Options |
|---|---|
| **When** (trigger) | Task created · Status changes (optionally *from* / *to*) · Assignee changes · Priority changes (optionally *to*) · Someone comments · Due in N days (0–30) · Becomes overdue |
| **Only if** (all must hold, up to 10) | Status is / isn't · Priority is / isn't · Someone or nobody assigned · Assigned to a person · Has / lacks a label · Title contains · Has / lacks a due date · Is / isn't a subtask |
| **Then** (in order, 1–10) | Set status · Set priority · Assign (to the creator, a person, or nobody) · Set due date N days ahead · Add / remove a label · Add a comment · Notify (the assignee, the creator, watchers, project managers, or a person) |

**Validation on save:**
- Everything is checked with zod. Unknown fields, triggers or actions are rejected.
- Trigger options must fit the trigger.
- Labels must belong to this organization.
- People must be org members who can see the project.
- A rule may set the status, priority, assignee or due date only once, and can't add and remove the same label.

**References are checked again when the rule runs**, because people leave and labels get deleted.

### Engine (`backend/src/modules/automation/`)

- **Events** are emitted after a change commits:
  - task created (directly or from a template),
  - status, assignee or priority changed (edits, bulk edits, board drags, approval decisions),
  - comment added.
  An event is queued only when the project has an enabled rule for that trigger, so ordinary edits cost one indexed count.
- **Time triggers.** An hourly sweep (a pg-boss cron job) queues *due soon* and *overdue* events. Event ids come from the task and its due date, so each task fires each rule **once per due date**, however often the sweep runs. Changing the due date fires it again.
- **Actions follow the same rules as a person's edit:**
  - Every field change goes through the same update path as the API, so blocked tasks can't be completed and required approvals still apply.
  - Field changes are applied as **one** update: either all land or none do. Comments and notifications go out only after that update succeeds.
  - History, notifications and live updates name the rule ("Automation 'Escalate critical bugs'").
  - Comments written by a rule show as **Automation · rule name**.

### Loop and duplicate protection

| Guard | How |
|---|---|
| **Duplicates** | Each run is keyed by (rule, event), which is unique in the database. The run row is written before any action, so a redelivered or concurrent copy of an event stops at the insert. Delivery is therefore *at most once* per rule and event. |
| **Loops** | Every event carries the chain of rules that caused it. A rule never runs again inside a chain it is already part of. Rules A → B → A is stopped at the second A. |
| **Depth** | Chains are cut off after 5 automations in a row. |
| **Runaways** | A rule that runs more than 60 times in a minute (for example across many tasks) is switched off. |
| **Failures** | A rule switches itself off after 5 failures in a row. Its creator gets a notification with the reason. Turning it back on clears the streak. |
| **Echo** | Comments written by an automation don't trigger comment rules. |

### Queue

- Jobs run on **pg-boss 10** in Postgres, so there is no Redis to operate. They are retried with backoff, and several API processes can share the queue.
- If the queue can't start, events run in-process, the sweep falls back to a timer, and the server logs an error.
- Tests use the in-process mode, plus one test file that runs the real queue.

### API

| Endpoint | Who |
|---|---|
| `GET /projects/:id/automations` | Anyone in the project except clients. The response says whether you can manage. |
| `POST /projects/:id/automations` | Project managers: org admins, project managers and project owners |
| `PATCH /automations/:id` and `DELETE /automations/:id` | Project managers. An update is validated as a whole rule, after merging. |
| `GET /automations/:id/runs?status=&limit=` | Same as reading. Newest first, with counts per outcome. |
| `POST /automations/:id/test` | Project managers. A dry run against one task that changes and records nothing. |

- Creating, updating and deleting rules are audited.
- Another organization's rule, or a rule in a private project you can't see, returns 404.

### Frontend: the project's **Automations** tab

- **Empty state** with five quick-start recipes: escalate critical work, start work on assignment, ask for review, nudge before the deadline, flag overdue tasks. A recipe only fills in the builder; nothing is saved until you press Save.
- **Builder:**
  - Trigger with its options, condition and action rows, and a live sentence preview.
  - Save is refused with the reason, using checks that mirror the server's.
  - Fits a phone screen.
- **Rule cards** show:
  - the sentence, an on/off switch, the run count, the last run and the author;
  - a banner when the system switched the rule off, saying why.
- **Run log** per rule:
  - Filter by outcome: Running, Ran, Skipped, Failed, Stopped. Every outcome has an icon and a label, not just a colour.
  - Each run's task links to the task.
  - Each run gets a plain reason, such as "Skipped: not true that priority is Critical" or "Stopped a loop: this rule's own change came back around to it". Runs triggered by another automation are marked "chained".
- **Dry run:** pick a task to see which conditions hold and what would happen.
- **Members** see rules and run logs read-only. **Clients** don't get the tab.

## Verification

| Check | Result |
|---|---|
| Backend tests | **197 passed** (19 new: 18 engine/API + 1 on the real pg-boss queue) |
| Loop tests | Two rules undoing each other stop after one round (SUCCEEDED → SUCCEEDED → LOOP_BLOCKED), and the rules still work on the next human change. A rule never re-triggers itself. The depth limit holds. The rate guard switches a runaway off. |
| Duplicate tests | 6 concurrent copies of one event plus a later redelivery: one run, one comment. The time sweep run 3 times fires once per task per due date. The same event put on the real queue 3 times runs once. |
| Other | Validation (14 bad rules rejected), permissions per role, cross-org and private-project 404s, blocked tasks can't be completed by a rule (and no partial comment is left behind), failure switch-off and re-enable, run log and dry run |
| Mutation tests | 14 bugs introduced one at a time. **13 fail a test.** The 14th, dropping the org filter on rule lookup, is still blocked by the project-access check, which returns 404. That filter is a second layer, not the only one. |
| Frontend tests | **74 passed** (10 new) |
| Browser run against the real server and pg-boss worker | **24/24 checks**, no browser errors |

The browser run covered:
- Building a rule from a recipe and one by hand, and confirming the saved JSON matches the builder.
- Rules firing on the worker: label added, project manager notified, the comment and history credited to the automation, the bell message.
- The assignment recipe moving a task to In progress.
- The A/B loop stopped and shown in the run log.
- A duplicate job inserted straight into pg-boss running once.
- The dry run, and the on/off switch.
- A member getting read-only access, with the API refusing their edit.
- Dark mode, and the builder at 390 px with no horizontal overflow.

### Found and fixed during this phase

1. **Startup crash in the condition schema.** zod refuses a discriminated union with two shapes for the same field (assignee "set/empty" and assignee "is person"). The typechecker didn't catch it. A runtime check did. The "is person" case is now its own field, `assignee_is`.
2. **Wrong error code.** A person outside the organization named in a rule returned 403 instead of a validation error (400). Fixed.
3. **"Skipped" while still running.** The run row (the duplicate guard) was first written as *Skipped* until the actions finished, so the log briefly misreported in-progress runs. The browser run caught this under load. It now uses a proper **Running** status.
4. **Raw status codes in the run log** ("IN_REVIEW") are now plain words ("In review").
5. **Flaky Phase 4 comment test (pre-existing).** After a mention was picked, the cursor was restored one frame later, so text typed in that window could land in the wrong place. The cursor is now restored in the same render. The suite then passed 6 times in a row.
6. **Automations completing recurring tasks.** When a recurring task's creator account was gone, an automation completing it would have tried to record the system (user 0) as creator of the next occurrence, and the completion would fail. It now records nobody.

## Honest limitations

- **At most once, not exactly once.** If a worker crashes after claiming a run but before its actions finish, that run stays *Running* and is not retried. I chose this over the alternative, actions running twice. There is no sweeper for stuck runs yet.
- **No organization-wide rules.** Every rule belongs to one project. There are no cross-project rules, no webhooks, no Slack or email-to-outside actions, and no "create a task" or "create a subtask" action.
- **Time triggers use UTC days and run hourly**, not in each viewer's time zone. *Overdue* looks back 7 days, so a rule created today won't fire for tasks that went overdue more than a week ago.
- **Conditions can't use custom fields, dates beyond "set or empty", or OR logic.**
- **Rate and failure limits are fixed** (60 runs a minute, 5 failures) and not configurable per organization.
- **Run logs are kept forever.** There is no retention or cleanup job yet.
- **Carried over:** no code splitting (the bundle-size warning remains), and the 500-row cap on task lists.
