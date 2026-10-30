#!/usr/bin/env bash
# Migration / schema consistency check against DISPOSABLE local databases.
# Used by CI (ci/db-migrations.workflow.yml -> .github/workflows/) and for local validation.
#
# Required:
#   DATABASE_URL         empty, throw-away Postgres DB (loopback host only)
#   SHADOW_DATABASE_URL  second empty, throw-away Postgres DB (loopback host only)
#   OXIVOLT_DISPOSABLE_DB=1  explicit acknowledgement that both may be written to
#
# Checks:
#   1. prisma validate
#   2. migrations folder == schema.prisma (diff via shadow DB, must be empty)
#   3. migrate deploy (through the guarded preflight) on the empty DB
#   4. migrate deploy again -> idempotent, nothing pending
#   5. migrate status -> up to date
#   6. live DB == schema.prisma (diff must be empty)
set -euo pipefail

say() { printf '\n[check-migrations] %s\n' "$*"; }
die() { printf '[check-migrations] REFUSED: %s\n' "$*" >&2; exit 1; }

[ "${OXIVOLT_DISPOSABLE_DB:-}" = "1" ] || die "set OXIVOLT_DISPOSABLE_DB=1 to confirm both databases are disposable."
[ -z "${RAILWAY_ENVIRONMENT_NAME:-}" ] || die "must not run inside a Railway environment."
case "${OXIVOLT_ENV:-test}" in production) die "OXIVOLT_ENV=production is not allowed." ;; esac

host_of() { node -e 'try{console.log(new URL(process.argv[1]).hostname)}catch{console.log("")}' "$1"; }
for name in DATABASE_URL SHADOW_DATABASE_URL; do
  url="${!name:-}"
  [ -n "$url" ] || die "$name is not set."
  h="$(host_of "$url")"
  case "$h" in localhost|127.0.0.1|::1|\[::1\]) ;; *) die "$name host '$h' is not loopback." ;; esac
done
[ "$DATABASE_URL" != "$SHADOW_DATABASE_URL" ] || die "DATABASE_URL and SHADOW_DATABASE_URL must differ."

export OXIVOLT_ENV=test
PRISMA=./node_modules/.bin/prisma

say "1/6 prisma validate"
$PRISMA validate

say "2/6 migrations folder vs schema.prisma (must be empty)"
set +e
$PRISMA migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
rc=$?
set -e
[ $rc -eq 0 ] || die "schema.prisma has changes not captured in prisma/migrations (exit $rc). Run 'prisma migrate dev --create-only' locally."

say "3/6 migrate deploy via guarded preflight"
node --import tsx scripts/preflight.ts --migrate

say "4/6 migrate deploy again (idempotency)"
out="$(node --import tsx scripts/preflight.ts --migrate 2>&1)"; echo "$out"
echo "$out" | grep -q "No pending migrations to apply" || die "second migrate deploy was not a no-op."

say "5/6 migrate status"
$PRISMA migrate status

say "6/6 live database vs schema.prisma (must be empty)"
set +e
$PRISMA migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
rc=$?
set -e
[ $rc -eq 0 ] || die "database produced by migrations differs from schema.prisma (exit $rc)."

say "OK — migrations and schema.prisma are consistent."
