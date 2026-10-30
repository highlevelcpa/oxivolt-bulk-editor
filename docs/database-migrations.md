# Database migrations — OXIVOLT Bulk Editor

## What changed

| Before | After |
|---|---|
| Container start ran `prisma db push --skip-generate` against whatever `DATABASE_URL` pointed at | Container start runs `scripts/preflight.ts`, then `exec ./node_modules/.bin/next start` (no `yarn` at runtime, so no Corepack download of Yarn on every start; works without internet access) |
| No migration history | `prisma/migrations/0_init` baseline (byte-identical to `prisma migrate diff --from-empty --to-schema-datamodel`) |
| No guard against STAGING using production resources | `lib/env-guard.ts` (runtime + preflight) fails closed in non-production |
| No CI check | `ci/db-migrations.workflow.yml` → `scripts/check-migrations.sh` on disposable Postgres 18 (**inactive until moved to `.github/workflows/db-migrations.yml`** — the PR bot lacks the GitHub `workflows` permission) |

## Startup behaviour (`scripts/preflight.ts`)

| Environment (resolved from `OXIVOLT_ENV`, else `RAILWAY_ENVIRONMENT_NAME`) | Behaviour |
|---|---|
| `production` | **No database operation at all.** Migration requests are logged and ignored. Exit 0 → app starts. |
| unknown (neither variable set) | Guard skipped; any migration request is refused (exit 1). |
| non-production (`STAGING`, `development`, `test`) | `DATABASE_URL` host must be in `OXIVOLT_DB_ALLOWED_HOSTS` (loopback implicitly allowed off Railway); `postgres.railway.internal` and `*.proxy.rlwy.net` always refused; `SHOPIFY_API_KEY` must not be in `OXIVOLT_FORBIDDEN_SHOPIFY_API_KEYS`. Then `prisma migrate deploy` **only** if `OXIVOLT_RUN_MIGRATIONS=true`. Any violation → exit 1, app does not start. |

`lib/db.ts` re-applies the database rule at runtime before creating `PrismaClient`, so a STAGING deployment that bypasses the preflight still cannot open a connection to a non-allow-listed host.

**Why `postgres.railway.internal` is refused outside production:** the production Postgres service has that hostname, and so does the legacy STAGING database (Railway environments clone service names). A non-production deployment must use a uniquely named service such as `postgres-staging-v2`.

## STAGING rollout (requires separate approval — not done by this PR)

1. Create an empty `postgres-staging-v2` service in STAGING only (no public networking, no data copy).
2. In the STAGING app service only, set:
   `OXIVOLT_ENV=staging`, `OXIVOLT_DB_ALLOWED_HOSTS=postgres-staging-v2.railway.internal`,
   `DATABASE_URL=${{postgres-staging-v2.DATABASE_URL}}`, `OXIVOLT_RUN_MIGRATIONS=true`,
   `OXIVOLT_FORBIDDEN_SHOPIFY_API_KEYS=<production client id>`, and the **development** Shopify app credentials.
3. Deploy this branch to STAGING. `migrate deploy` applies `0_init` to the empty DB.

Until step 2 is done, deploying this code to STAGING will **intentionally fail to start** (the current STAGING `DATABASE_URL` uses `postgres.railway.internal`).

## Production — NOT ready, NOT approved

Production currently has **no backups** (Railway Hobby) and the project owner has decided not to create any. Consequences:

- This PR contains **no step that touches the production database**. The preflight hard-skips production.
- Merging this PR to `main` auto-deploys Production (Railway deploys `main`). The only production effect is that `prisma db push` no longer runs at startup; no schema change, no migration, no new required variable. Merging is still a production deploy and needs its own approval.
- Production has no `_prisma_migrations` table. Adopting migrations there would require `prisma migrate resolve --applied 0_init` (writes a row to production) after confirming the live schema matches `0_init`. **Not done, not scripted, and not safe to claim safe.**
- Any future production schema change carries an **unrecoverable data-loss risk**: if a migration or operator error damages data, there is no backup to restore from. A separate risk review and explicit approval are required before any production migration.

## Adding a future migration

```bash
# against a LOCAL disposable database only
OXIVOLT_ENV=development npx prisma migrate dev --create-only --name <change>
# review SQL; CI rejects DROP / TRUNCATE / DELETE FROM without explicit review
```

## Local / CI validation

```bash
OXIVOLT_DISPOSABLE_DB=1 \
DATABASE_URL=postgresql://u:p@127.0.0.1:5432/oxivolt_tmp \
SHADOW_DATABASE_URL=postgresql://u:p@127.0.0.1:5432/oxivolt_tmp_shadow \
yarn db:check-migrations
```

The script refuses non-loopback hosts, Railway environments and `OXIVOLT_ENV=production`.

### Activating the GitHub Actions check (repository owner only)

GitHub only lets a credential with the `workflow` scope (or a GitHub App with the
`workflows` permission) create files under `.github/workflows/`. The bot that
prepared this PR does not have it, so the workflow is shipped under `ci/`.
To activate it, a repository admin copies the file unchanged, e.g. in the
GitHub web UI: **Add file → Create new file** on branch
`chore/prisma-migrate-baseline`, path `.github/workflows/db-migrations.yml`,
content = `ci/db-migrations.workflow.yml`. The workflow uses only a disposable
`postgres:18` service container and references no repository secrets.
