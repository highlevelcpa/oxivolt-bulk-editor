/**
 * Container start preflight (runs before `next start`, see Dockerfile).
 *
 *   node --import tsx scripts/preflight.ts            # guard only
 *   node --import tsx scripts/preflight.ts --migrate  # guard + `prisma migrate deploy`
 *
 * Migrations also run when OXIVOLT_RUN_MIGRATIONS=true.
 *
 *  production     -> never contacts the database, never migrates, exits 0 so
 *                    the app starts exactly as before (minus `db push`).
 *  unknown        -> guard skipped; a migration request is REFUSED (exit 1).
 *  non-production -> DB/Shopify guard (exit 1 on violation), then optional
 *                    `prisma migrate deploy` against the allow-listed DB.
 *
 * Credentials are never printed.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import {
  EnvGuardError,
  checkDatabaseTarget,
  checkShopifyApp,
  resolveEnvironment,
} from '../lib/env-guard';

// Same precedence as the Prisma CLI / Next: real env vars win over .env.
loadDotenv({ path: path.resolve(process.cwd(), '.env') });

const log = (msg: string) => console.log(`[preflight] ${msg}`);
const fail = (msg: string): never => {
  console.error(`[preflight] REFUSED: ${msg}`);
  process.exit(1);
};

function main(): void {
  const wantMigrate = process.argv.includes('--migrate') || process.env.OXIVOLT_RUN_MIGRATIONS === 'true';

  let resolved;
  try {
    resolved = resolveEnvironment(process.env);
  } catch (e) {
    return fail((e as Error).message);
  }

  if (resolved.kind === 'production') {
    log(`environment=production (via ${resolved.source}); no database operations are performed at startup.`);
    if (wantMigrate) {
      console.error(
        '[preflight] Migration requested in PRODUCTION — ignored. Production schema changes are disabled in this ' +
          'codebase and require a separate, explicitly approved risk review (docs/database-migrations.md).',
      );
    }
    return;
  }

  if (resolved.kind === 'unknown') {
    if (wantMigrate) return fail('environment unknown — set OXIVOLT_ENV (staging | development | test) before migrating.');
    log('environment=unknown (no OXIVOLT_ENV / RAILWAY_ENVIRONMENT_NAME); guard skipped, no migrations.');
    return;
  }

  let target;
  try {
    target = checkDatabaseTarget(process.env, resolved);
    checkShopifyApp(process.env, resolved);
  } catch (e) {
    if (e instanceof EnvGuardError) return fail(e.message);
    throw e;
  }
  log(`environment=${resolved.name} (via ${resolved.source}); database ${target.host}:${target.port}/${target.database} allowed.`);

  if (!wantMigrate) {
    log('migrations not requested (OXIVOLT_RUN_MIGRATIONS != "true").');
    return;
  }

  log('running `prisma migrate deploy` ...');
  const bin = path.resolve(process.cwd(), 'node_modules', '.bin', 'prisma');
  const r = spawnSync(bin, ['migrate', 'deploy'], { stdio: 'inherit', env: process.env });
  if (r.error) return fail(`could not run prisma: ${r.error.message}`);
  if (r.status !== 0) return fail(`prisma migrate deploy exited with code ${r.status}.`);
  log('migrations up to date.');
}

main();
