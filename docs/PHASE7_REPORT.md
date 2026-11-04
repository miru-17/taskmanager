# Phase 7 — AI

**Status:** complete · **Branch:** `phase-3` (stacked on Phases 3–6) · **Date:** 2026-11-04

Exit criterion from the plan: *works with AI disabled*. It does. With no model configured, or with AI switched off for the organization, every AI feature still works using built-in rules. The full browser run passes in that mode with no model called at all.

## How it works

- **One provider, any OpenAI-compatible API.** Set `AI_BASE_URL` to Ollama on your laptop (`http://localhost:11434/v1`, no key) or to a hosted API with `AI_API_KEY`. Leave it unset and nothing is ever sent anywhere.
- **Every feature has a rule-based fallback.** Each request tries the model, validates its answer, and uses the rules if anything goes wrong:
  - AI not set up
  - switched off for the organization
  - service unreachable, timed out or returned an error
  - an answer that isn't valid JSON or doesn't fit the expected shape
- **After 3 failures in a row** the model is skipped for 60 seconds, so a stopped Ollama doesn't make every click wait for a timeout.
- **Every result says where it came from.** The UI labels each one **AI suggestion** or **Rule-based**, with the reason on hover and for screen readers.
- **AI only proposes.** Nothing changes until a person confirms. Confirmed changes go through the same task API as manual edits, with the same permission checks.

## Features

| Feature | Where | AI path | Rule-based fallback |
|---|---|---|---|
| **Describe-it task entry** | Task composer | Reads a sentence into title, description, priority, due date, assignee, labels and project | A parser for priorities (`!high`, "urgent", "p1"), dates ("by friday", "next week", "in 3 days", "12 dec", "end of month", ISO dates), `@person` / "for Sam", `#label`, "in Website" / `[WEB]` |
| **Breakdown** | Task panel | Proposes 3–8 subtasks with estimates | Uses the steps already listed in the description, otherwise a plan for that kind of task (bug, design, writing, launch, meeting, research, general) |
| **Task summary** | Task panel | Progress, open questions from comments, next step | Status, priority, owner and due date in one sentence, plus blockers, checklist, subtasks, latest comment and recent changes |
| **Project status report** | Project overview | Short status report | Done and total, completed in the last 7 days, in progress, due soon, overdue, blocked |
| **Priority suggestions** | Project overview | Suggested changes with reasons | Raises overdue work (to critical if it blocks others), work due within 2 days, and work blocking 2 or more tasks. Lowers "high" work that has been untouched for 30+ days with no due date |
| **Risks and workload** | Project overview | Writes the explanation | **Detection is always the rules:** overdue work, tasks waiting on overdue work, unowned critical or high work, unowned work due within 3 days, overloaded people (more than 40 estimated hours or more than 10 tasks due within 7 days), work stuck in progress for 14+ days. Plus a per-person workload table. |
| **Assistant** | Sidebar → Assistant | Answers questions about your work, linking the tasks it mentions | Answers "what's overdue / due today / this week / blocked", "who is overloaded", and "what should I work on next" (your most urgent unblocked tasks). Anything else gets a list of what works offline. |
| **AI setting** | Organization settings | Org admins can switch AI off for the whole organization (audited) | Shows whether AI is set up, which model is used, and what gets sent |

**Confirm-before-apply in practice:**
- Describe-it only fills in the form; you press Create.
- A breakdown lists the subtasks to tick and edit; only the ticked ones are created.
- Priority suggestions show current → suggested with a reason; you apply the ticked rows.
- The assistant can't change anything.

## Security and privacy

- **The model only sees what the caller can see.**
  - Context is built from the caller's visible tasks.
  - The assignee list only includes people who can see the target project.
  - Private projects you aren't in, and other organizations, never reach a prompt.
  - Tests check the prompts that are actually sent.
- **Every id the model returns is checked.** Unknown task ids, outsiders, other organizations' labels, unknown projects and past due dates are dropped one by one and reported ("Ignored a suggested assignee…"). Priority suggestions only cover tasks the caller may edit.
- **Prompt injection.** User-written content is wrapped in `<data>` blocks, and the system prompt says to treat it as information, never as instructions. That alone isn't a guarantee, so the real protection is the validation above plus nothing being applied without a person.
- **Assistant answers are shown as plain text.** Task links appear only for tasks the caller can see.
- **Clients get no AI features.** Summaries and workload would reveal internal information. The client portal is part of Phase 8.
- **Rate limit:** 60 AI requests per user per 5 minutes (`AI_RATE_LIMIT`).
- **Logs** record the feature, timing and whether the answer was usable, never the content. Provider error bodies are never echoed back.

## Configuration (`backend/.env`)

```
AI_BASE_URL=http://localhost:11434/v1   # unset = rules only
AI_MODEL=llama3.2
AI_API_KEY=                             # for hosted APIs
AI_TIMEOUT_MS=20000
AI_MAX_OUTPUT_TOKENS=1200
AI_RATE_LIMIT=60
```

Migration `20261104150000_phase7_ai` adds `Organization.aiEnabled` (default on).

## Verification

| Check | Result |
|---|---|
| Backend tests | **216 passed** (19 new) |
| Rules, unit level | Parser across priorities, labels, assignee ambiguity (two Alexes), weekday edges ("wednesday" on a Wednesday, "next wednesday"), year rollover, invalid dates, "Sun logo" not read as Sunday, time zones (20:00 UTC is tomorrow in India). Priority, risk, workload, breakdown and assistant rules checked against hand-worked numbers. |
| With AI disabled | Every endpoint returns a working rule-based result labelled `rules` / `not_configured`, and no model request is made |
| Org switch | Admin only, audited. Once off, nothing is sent; other organizations are unaffected. |
| With a model (a real local HTTP server speaking the OpenAI format) | Request shape, key and JSON mode checked. Hostile output (outsiders, foreign labels, unknown projects, past dates, other orgs' or private tasks, made-up ids) is filtered. Chatty, fenced, malformed, empty, slow and failing replies all fall back. The circuit breaker stops calling a dead model. |
| Access | Clients get 403. Viewers can read summaries and risks but can't parse, break down or reprioritize. Other orgs and private projects return 404. Inputs are validated (lengths, history size, no "system" turns). Rate limit is per user. |
| Mutation tests | 13 bugs introduced one at a time (ignoring the org switch, trusting assignees or labels, linking any task, wider assistant context, suggesting for tasks you can't edit, no breaker, no timeout, trusting bad output, letting clients in, removing the data fence, keeping past dates, offering people who can't see the project). **Each one fails a test.** One of them first survived and got a new test. |
| Frontend tests | **84 passed** (10 new), stable across repeated runs |
| Browser run, **AI disabled** | **18/18 checks**: describe-it to create with reviewed fields, summary, breakdown (only ticked subtasks added), risks plus workload, priority suggestions applied via bulk update, assistant with links, settings text, dark mode, phone width, no browser errors |
| Browser run, **AI on** against a local stand-in | **20/20 checks**: the same flows labelled "AI suggestion". User text fenced in every request, the private project's tasks never sent, a made-up task id dropped. After the admin switches AI off, nothing more reaches the model. When the service is killed, the app falls back in about 0.5 s. |

**What the AI-on run does and doesn't prove.** This workspace can't download model weights (Hugging Face and the Ollama registry are blocked). The AI-on run therefore used a local stand-in that speaks the same API. It proves the wiring, the safety checks and the fallbacks, but **not the quality of a real model's answers**. To try a real model:
1. Run `ollama pull llama3.2`.
2. Set `AI_BASE_URL=http://localhost:11434/v1`.
3. Restart the backend.

Small local models may sometimes return invalid JSON. That just shows up as "Rule-based".

### Found and fixed during this phase

1. **Blank screen when opening the assistant in Chrome.** Newer Chromium returns a Promise from `scrollIntoView`, and an effect returned it to React as a cleanup. The unit-test DOM doesn't do this, so only the browser run caught it.
2. **The assistant showed "AI" for up to a minute after an admin switched it off.** The status is now re-checked when the panel opens, and the header follows the latest answer's source.
3. **"#urgent" read as a priority.** The word inside a label was taken as a priority, and the leftover text stayed in the title. Labels are now read first.
4. **"for @sam" left "for" in the title.** Fixed.
5. **Short weekday names like "Sun logo" became dates.** Short forms now need a cue word ("by fri").
6. **Test isolation in the rate limiter.** It now keys on organization plus user.

## Honest limitations

- **Not tested against a real model** (see above). Prompts are written for small local models but haven't been tuned on one.
- **The assistant is read-only and stateless.** It doesn't remember conversations between sessions, can't search comments or attachments, and only sees up to 150 of your most relevant open tasks.
- **The rule parser is English-only.** It ignores times of day and recurring phrases ("every monday"), and reads "12/11" as nothing because of the day/month ambiguity.
- **No AI usage metering per organization yet.** Plan limits on AI belong in Phase 8.
- **Summaries aren't cached.** Each click is a new request.
- **Carried over:** no code splitting (the bundle-size warning remains), and the 500-row cap on task lists.
