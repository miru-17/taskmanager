# Phase 3a — Projects, teams and the advanced task model

**Status:** complete · **Branch:** `phase-3` · **Date:** 2026-11-03

Phase 3 was split in two. This part (3a) covers projects, teams, milestones, the full task model, five project views and the new app design. Part 3b covers recurring tasks, templates, custom fields, attachments and approval workflows.

## What was built

### Backend

**Project-scoped access (`core/access.ts`).** Every project and task query goes through one filter, `projectAccessWhere`:

- Org admins and project managers see every project in the organization.
- Clients see only projects they were explicitly added to.
- Everyone else sees organization-visible projects, plus private projects they belong to directly or through the project's team.

A task in a project the caller can't see returns 404, exactly like a task that doesn't exist.

**Rights per project (`resolveProjectAccess`).** A person's rights in a project start from their org role and are then adjusted:

- **Project manager or owner:** full rights.
- **Lead of the project's team:** can edit and delete any task.
- **Project viewer, or any client:** read-only.
- **"Own" scope:** covers tasks the person created. For edits only, it also covers tasks assigned to them.

**Projects:**

- **Keys:** each project has a key (`WEB`, auto-suggested from the name), unique per organization. Tasks are numbered `WEB-1`, `WEB-2` and so on; numbering is serialized by a row lock, and a concurrency test covers it.
- **Settings:** status, visibility, colour, team, start and target dates.
- **Lifecycle:** archiving makes a project read-only. Permanent delete is limited to org admins and only works on an archived project.
- **Default project:** every new organization gets a **General** project, and the migration backfilled one for every existing organization, so no existing task was lost.

**Health and progress.** Both come from real task data through grouped queries, with no N+1. The rules are visible to users:

- **Off track:** past the target date with open work, or at least 25% of open tasks overdue.
- **At risk:** any overdue task, or progress more than 20 points behind elapsed time.

**Milestones** have their own progress. **Teams** support lead and member roles:

- A lead manages membership but can't appoint other leads.
- Clients can't join teams.

**The task model:**

- **Fields:** priority, start and due dates, estimate and time spent, assignee, milestone, labels.
- **Subtasks:** up to 3 levels deep, with protection against cycles.
- **Dependencies:**
  - Cycles are detected with a recursive CTE.
  - Marking a task done while a blocker is unfinished returns `409 TASK_BLOCKED` and names the blocker.
- **Other features:** checklist, watchers (the creator and assignee are added automatically), field-level change history, archive, and soft delete (subtasks are deleted too; deletion is audited).
- **Validation:** the assignee must be an organization member who can actually see the project. Labels and milestones must belong to the same organization and project.

**Listing.** Filters by project, status, priority, assignee (`me`/`none`), creator, label, milestone, parent, text or key search (`WEB-12`), due-date range, overdue, archived and watching. Sorting and pagination use a whitelist; the response shape is `{items,total,limit,offset}`.

**Bulk actions** cover up to 200 tasks and are all-or-nothing: if any task is missing or forbidden, nothing changes, and the response lists the offending ids. Each task goes through the same rules as a single update.

**Labels** are org-wide; team leads and above manage them. **Saved views** are personal or shared; only the owner or an org admin can change them.

### Frontend

**Design and shell:**

- A new design system built on theme tokens, with light and dark themes. The theme follows the OS setting, can be toggled, and survives reloads.
- Self-hosted Inter font, so there are no external requests.
- An app shell with a sidebar: organization switcher, navigation, project list, user menu, and a mobile menu.
- The existing settings and auth pages were re-themed to match.
- The data layer uses TanStack Query. Caches are scoped by organization and cleared on sign-out.

**Views:**

- **My tasks:** tasks assigned to me, created by me, or watched, grouped as Overdue, Today, Next 7 days, Later and No date.
- **Projects:** project cards with health, progress and owner.
- **Project views:**
  - *Overview:* stats, health with the reason in plain words, status counts, overdue and upcoming tasks, milestones, members.
  - *Board:* drag and drop between and within columns, keyboard dragging, optimistic updates that roll back when the server refuses.
  - *List:* sortable columns, selection, bulk actions, load more.
  - *Calendar:* month grid; drag a task to another day to change its due date.
  - *Timeline:* Gantt bars with dependency arrows (red when the plan is impossible), three zoom levels, drag to shift dates.
  - *Settings:* details, members, milestones, archive and delete.
- **Task drawer:** opened with `?task=ID`, so tasks can be linked. It edits every field and covers subtasks, checklist, blockers (search by key), watching, archive, delete and readable activity history. It is read-only exactly when the server says so.
- **Composer:** one shared new-task form; the `C` key opens it.
- **Teams page** and **saved views**.
- **Filters** live in the URL, so a filtered view can be bookmarked.

## Verification

| Check | Result |
|---|---|
| Backend tests (Jest + real Postgres) | **116 passed** (32 new) |
| Mutation tests: 6 backend controls disabled one at a time | each one fails a test |
| Frontend tests (Vitest) | **36 passed** (20 new) |
| Mutation tests: 3 UI rules broken | each one fails a test |
| Typecheck, lint, production build | clean |
| Browser E2E against real API and DB (Playwright) | **19/19 checks**, no script errors |

The E2E checks confirm results directly in the database:

- A board drag is saved.
- Completing a blocked task is refused and the field reverts.
- Checklist and bulk changes are saved.
- The label filter matches the database.
- The timeline draws the 3 seeded dependencies.
- The overview total equals the database count.
- The dark theme persists.
- An invited member can't see the private project (from the sidebar or by direct URL) and can't edit or delete other people's tasks.
- The mobile layout works.

### Bugs the E2E run caught and fixed

1. The login and sign-up inputs had no accessible labels; they now have them.
2. Checklist checkboxes only flipped after the server round-trip; they now flip immediately.
3. Filter selects stretched to full width because of a CSS class conflict.
4. Board cards a person can't move were announced as "disabled" to screen readers; they are now plain buttons that open the task.

## Breaking API changes

- `GET /tasks` returns `{items,total,limit,offset}` instead of an array.
- Clients now have `tasks:read`, scoped to the projects they were added to.
- Task status gains `IN_REVIEW`.
- `POST /tasks` accepts an optional `projectId`. Without it, the task goes to the organization's oldest active project.

## Remaining issues (honest list)

- **3b is not done yet:** recurring tasks, templates, custom fields, attachments and approval workflows.
- **List cap:** lists return at most 500 rows per request. The board shows the first 500 and says so; the list view loads more up to 500.
- **Positions are never rebalanced.** Board positions are float midpoints. After roughly 50 drops into the same gap, precision runs out; a rebalancing job is planned.
- **Moving tasks between projects** isn't supported yet, because task numbers are per project.
- **No restore for soft-deleted tasks** in the UI. They are kept in the database.
- **Team leads** can remove other leads from their team. That is allowed by design today; it may need tightening.
- **Calendar dragging** uses native HTML5 drag, so it is mouse-only. Keyboard users change dates in the task drawer.
- **Bundle size:** the frontend bundle is over 500 kB with no code splitting yet; this is planned for Phase 9.
- **No live updates.** Other users' changes appear on refetch (window focus or after your own change), not in real time. Real-time updates are Phase 4.
- **Assignee lists:** the picker lists all organization members. For a private project, the server rejects assignees who can't see it and shows a clear message; the picker doesn't pre-filter them.
