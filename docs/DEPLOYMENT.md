# Deploying TaskForge

TaskForge is three containers: **PostgreSQL 16**, the **API** (Node 22), and **web** (nginx serving the built app and proxying `/api` to the API). Everything else is optional: email, AI, Stripe.

## 1. First start

```bash
cp deploy/.env.example .env
# Edit .env: set POSTGRES_PASSWORD and JWT_SECRET (openssl rand -hex 32), and PUBLIC_URL
docker compose up -d --build --wait
```

Open `PUBLIC_URL` (default http://localhost:8080) and create the first account. That person becomes the first organization's admin.

- **Migrations** run automatically when the API container starts (`prisma migrate deploy`). Already-applied migrations are skipped.
- **Health:**
  - `GET /api/health` means the process is up.
  - `GET /api/health/ready` means the database is reachable.
  - `GET /healthz` is nginx itself.
  - Compose waits on these before marking the stack healthy.
- **Uploads** live in the `uploads` volume, and the database in `db-data`.

## 2. HTTPS

Put TaskForge behind your TLS terminator (Caddy, Traefik, a cloud load balancer) and forward to the `web` container's port. Then in `.env`:

```
PUBLIC_URL=https://tasks.example.com
COOKIE_SECURE=true
```

The API trusts one proxy hop (`trust proxy 1`), so client IPs in rate limits and audit logs are correct behind a single proxy. If you add more layers, adjust that setting in `backend/src/app.ts`.

## 3. Optional services

| Feature | Variables | Without it |
|---|---|---|
| Email (invitations, verification, notifications) | `EMAIL_USER`, `EMAIL_PASS` (Gmail app password) | Nothing is sent and the API logs that a message was skipped. Sign-up still works, but verification, reset and invitation links can't reach anyone. `MAIL_LOG_CONTENT=true` writes the messages, links included, to the log instead: only do that if you control who can read the logs. |
| AI | `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` (any OpenAI-compatible API; Ollama on the host is `http://host.docker.internal:11434/v1`) | Every AI feature uses built-in rules |
| Billing | `STRIPE_SECRET_KEY` (test mode only), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS` | Plans are set by the operator, plus the free trial |

**Stripe webhook:** point it at `https://<your host>/api/billing/webhook`. For local testing, run `stripe listen --forward-to localhost:8080/api/billing/webhook`.

## 4. Operating it

```bash
# Set an organization's plan (when Stripe isn't used)
docker compose exec backend node dist/cli/set-plan.js <org-slug> PRO

# Make someone a platform super-admin
docker compose exec backend node dist/cli/make-super-admin.js <email>

# Logs (JSON, one line per event; credentials and tokens are redacted)
docker compose logs -f backend
```

### Backups

```bash
./deploy/backup.sh ./backups          # database (pg_dump custom format) + uploaded files
KEEP=30 ./deploy/backup.sh ./backups  # keep the last 30 (default 14)
```

- Each backup is checked after it's written: the dump must list, and the archive must open.
- Run it from cron. Example, daily at 02:15:
  ```
  15 2 * * * cd /srv/taskforge && ./deploy/backup.sh /srv/backups >> /var/log/taskforge-backup.log 2>&1
  ```
- Copy the backup folder off the machine. A backup on the same disk isn't a backup.

**Restore** replaces all data and asks you to type `RESTORE` first:

```bash
./deploy/restore.sh backups/db-<stamp>.dump backups/uploads-<stamp>.tar.gz
```

Restoring an older backup is fine: the API applies any newer migrations when it starts. **Test a restore** on a spare machine now and then.

### Upgrades

```bash
git pull
docker compose up -d --build --wait
```

Take a backup first. Migrations only ever add or change schema in ways the code that ships with them expects, and they run before the new API starts serving.

## 5. Sizing

One API container and Postgres comfortably serve a few hundred users on 1 vCPU / 2 GB RAM.

**Background work** runs on pg-boss (inside Postgres): automations and the hourly sweeps. With several API replicas the queue is shared safely.

**Two exceptions before you scale out:**
- Uploads use the local volume, so all replicas need shared storage (or swap the `Storage` implementation in `backend/src/core/storage.ts` for S3).
- The AI rate limiter is per process.

## 6. CI

`.github/workflows/ci.yml` runs on every push:
1. **Backend:** typecheck; migrations applied to an empty database and checked for drift against the schema; all tests; build; audit.
2. **Frontend:** lint, tests, build, audit.
3. **End-to-end:** Playwright against the built API and app with a real database.
4. **Docker:** both images built, the Compose stack started, health and the cookie-based session refresh checked through nginx.
