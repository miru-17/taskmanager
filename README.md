# TaskForge

Multi-tenant task and project management: organizations and roles, projects with board, list, calendar, timeline and Gantt views, comments and live updates, analytics, automations, optional AI (with built-in fallbacks), plans and Stripe test-mode billing, and a client portal.

- **Run it:** see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (`docker compose up -d --build`).
- **Develop:**
  - `backend/` (Express 5, Prisma, PostgreSQL): `npm run dev`
  - `frontend/` (React 19, Vite, Tailwind 4): `npm run dev`
  - Copy each `.env.example` to `.env` first.
- **Tests:**
  - `backend`: `npm test` (needs `TEST_DATABASE_URL`)
  - `frontend`: `npx vitest run`
  - `e2e`: `npx playwright test` (against running servers)
- **How it was built:** phase reports in [docs/](docs/), from the initial assessment to Phase 9.
