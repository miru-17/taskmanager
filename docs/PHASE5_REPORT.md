# Phase 5 — Analytics and reporting

**Status:** complete · **Branch:** `phase-3` (stacked on Phases 3–4) · **Date:** 2026-11-04

Exit criterion from the plan: *numbers reconcile with raw records in tests*. They do. Every figure is recomputed independently from raw rows, in three time zones, and also checked in a real browser against the database.

## What was built

### Backend: `/analytics`

All figures are SQL aggregates computed in Postgres. Each one counts only tasks in projects the caller can see. Deleted tasks are always excluded; archived tasks are excluded from "open" and "now" figures.

| Endpoint | What it returns |
|---|---|
| `GET /analytics/summary` | Open now, overdue now, created and completed in the range, cycle time (average and median, in days), on-time rate (completed by the due date), actual vs estimated hours, tasks by status, open tasks by priority |
| `GET /analytics/trend` | Created and completed per day (ranges up to 62 days) or per ISO week, plus running scope, done and remaining for a burn-up chart |
| `GET /analytics/workload` | Per person, plus "Unassigned": open, overdue, due in 7 days, open estimate hours, open tasks without an estimate, completed in the range |
| `GET /analytics/projects` | Per project: total, done, open, overdue, progress, health, completed in the range |
| `GET /analytics/export.csv?dataset=tasks\|workload` | CSV download, audited |

**Filters:** project, assignee (including Unassigned), and a date range of up to 366 days that defaults to the last 30.

**Time zones.** Days are calendar days in the viewer's own time zone, so a task finished at 20:00 UTC counts as the next day in India.
- Legacy zone names are mapped to current ones. Chrome reports India as `Asia/Calcutta`, which this Postgres doesn't recognise.
- Every zone is checked against Postgres's own list before any query runs.

**Who can see analytics.** A new `analytics:read` permission is granted to every role except Client. Viewers can read analytics.

**CSV safety:**
- Every cell is quoted, and quotes inside cells are doubled.
- A cell starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'`, so Excel and Sheets show it as text instead of running it as a formula.
- The file starts with a byte-order mark so Excel reads UTF-8 names correctly.
- Exports are capped at 10,000 rows, and an `X-Export-Truncated` header says when the cap was hit.

### Frontend: the Analytics page

**Layout:**
- One row of filters above everything (range presets or custom dates, project, assignee). The filters live in the URL, so a report can be shared.
- Seven stat tiles.
- Throughput and burn-up line charts.
- Bar lists for status and priority.
- A workload table with inline bars, and a projects table with health and progress.

**Charts follow the charting guidance:**
- They use the validated categorical slots 1 and 2. The validator passed every check in light and dark against this app's own surfaces.
- Hairline grids, 2 px lines, end labels and a legend.
- A crosshair tooltip that lists every series at the hovered day; arrow keys move it.
- A "Show table" view on every chart.

**Exports:**
- **CSV** downloads for tasks and for workload. A warning appears if an export was truncated.
- **PDF** through the browser's print dialog ("Save as PDF"). A print stylesheet hides the app's sidebar and controls, and pop-up notifications. It always prints in the light theme, even from dark mode, and keeps cards from splitting across pages.

**Live.** The dashboard refreshes when tasks change, through Phase 4's live updates.

## Verification

| Check | Result |
|---|---|
| Reconciliation tests: summary in UTC, Asia/Kolkata and America/Los_Angeles; trend buckets sum to the totals; daily running totals; weekly buckets start on Mondays; workload; per project; project and assignee filters | **all match the raw rows** |
| Edge cases: completed exactly on the due date (on time) vs a day after (late); 20:00 UTC counted as the next day in India; legacy zone names; deleted and archived tasks | pass |
| Access: private projects excluded; another organization never counted; clients get 403; an unknown project gets 400; bad ranges and time zones rejected (including an SQL-injection attempt in `tz`) | pass |
| Backend tests | **178 passed** (16 new) |
| Mutation tests: 8 bugs introduced one at a time (ignoring project access, counting deleted tasks, ignoring the time zone, no CSV formula guard, on-time off by one day, overdue including today, open counting archived tasks, legacy zones not resolved) | each one fails a test |
| Full backend suite with the server set to Asia/Calcutta and America/Los_Angeles | passes: timestamps are read correctly whatever the machine's zone |
| Frontend tests | **64 passed** (7 new) |
| Browser E2E against real data (160 tasks over 75 days) | **15/15 checks** |

The browser checks covered:
- The admin's tiles match counts computed directly from the database.
- The chart's table adds up to the tile totals.
- Filtering to one project matches that project's rows.
- The CSV has one row per task, and a formula in a title is neutralised.
- The PDF is produced.
- A member's numbers exclude the private project, which they also can't pick.
- The charts fit their cards at 1440 px and still fit at 900 px.

### Found and fixed during this phase

1. **Indian time broke every analytics request.** Chrome sends `Asia/Calcutta`, and this Postgres only knows `Asia/Kolkata`. The unit tests hadn't caught it because they sent the current name. Fixed with the alias mapping and a check against Postgres's zone list, plus a test that fails without the fix.
2. **On-time boundary untested.** Random data never exercised "completed exactly on the due date". I added a test for that boundary.
3. **Charts overflowed their cards.** Each chart's width fed back into its column's width. Fixed, and the browser test now measures the fit.
4. **Notifications in printed PDFs.** Pop-up notifications appeared in the PDF; they're now hidden when printing.

## Honest limitations

- **History is rebuilt from timestamps.** Trends use creation and completion times, so a task completed and then reopened no longer counts as completed on that day, and deleted tasks drop out of past charts. Exact history would need daily snapshots or an event log (a possible addition alongside Phase 6 automation).
- **No server-side PDF.** PDF export uses the browser's print dialog. That keeps the stack light and includes the charts, but there is no scheduled or emailed PDF report yet.
- **Subtasks count as tasks.** They are included in every count, which the page footnotes.
- **Estimate comparison is partial.** "Actual vs estimate" only uses completed tasks that have both numbers; the tile shows how many that is.
- **No custom-field charts.** Charts can't be broken down by custom fields yet.
- **No time-tracking analytics.** Time tracking is a single "actual hours" number per task, with no timesheets.
- **Carried over** from earlier phases: no code splitting (the bundle warning remains), and the 500-row cap on task lists (analytics itself is not capped).
