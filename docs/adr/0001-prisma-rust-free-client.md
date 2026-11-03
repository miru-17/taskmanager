# ADR 0001 — Prisma 6.19 with the Rust-free client and `@prisma/adapter-pg`

**Status:** Accepted · Phase 0 · 3 Nov 2026

## Context
The backend used Prisma 6.10 with the default Rust query engine, a native binary downloaded per OS at install time. That causes:
- binary mismatches between Windows, WSL2 and Linux Docker images (the same `node_modules` can't be shared);
- an extra ~20–40 MB native library and a separate engine process/thread pool per app instance;
- installs that fail wherever `binaries.prisma.sh` is unreachable (locked-down CI runners, sandboxes).

The Rust-free client (`engineType = "client"`) became generally available in Prisma 6.16. It compiles queries in WebAssembly and sends them through a standard JavaScript driver (`pg`).

## Decision
- Upgrade `prisma` and `@prisma/client` from 6.10 to **6.19.3**. This stays on the same major version, and the schema language and client API are unchanged.
- Set `engineType = "client"` in `schema.prisma` and construct the client with `new PrismaPg({ connectionString })` (`src/core/prisma.ts`).
- Keep `url = env("DATABASE_URL")` in the datasource so the Prisma CLI (`migrate dev`, `migrate deploy`, `studio`) works exactly as before.

## Consequences
- No native query engine to download or match per platform; lower memory use.
- Same Prisma API in application code; no query changes were needed.
- The connection pool now belongs to `pg` (default 10 connections; tune with `?connection_limit=` style options on the adapter if needed later).
- Prisma 7 can be adopted later with minimal change, because it uses this same model by default.
