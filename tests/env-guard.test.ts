import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  EnvGuardError,
  assertDatabaseTargetAllowed,
  checkShopifyApp,
  parseDatabaseUrl,
  resolveEnvironment,
} from '../lib/env-guard';

const PROD_URL = 'postgresql://postgres:secret@postgres.railway.internal:5432/railway';
const V2_URL = 'postgresql://postgres:secret@postgres-staging-v2.railway.internal:5432/railway';

test('resolveEnvironment: production / staging / unknown', () => {
  assert.equal(resolveEnvironment({ RAILWAY_ENVIRONMENT_NAME: 'production' }).kind, 'production');
  assert.equal(resolveEnvironment({ OXIVOLT_ENV: 'production' }).kind, 'production');
  assert.deepEqual(resolveEnvironment({ RAILWAY_ENVIRONMENT_NAME: 'STAGING' }), {
    kind: 'non-production',
    name: 'staging',
    source: 'RAILWAY_ENVIRONMENT_NAME',
    onRailway: true,
  });
  assert.equal(resolveEnvironment({}).kind, 'unknown');
});

test('resolveEnvironment: contradictory / invalid labels are refused', () => {
  assert.throws(() => resolveEnvironment({ OXIVOLT_ENV: 'staging', RAILWAY_ENVIRONMENT_NAME: 'production' }), EnvGuardError);
  assert.throws(() => resolveEnvironment({ OXIVOLT_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'STAGING' }), EnvGuardError);
  assert.throws(() => resolveEnvironment({ OXIVOLT_ENV: 'prod' }), EnvGuardError);
});

test('production is a no-op even with the production DB URL and no guard variables', () => {
  assert.doesNotThrow(() => assertDatabaseTargetAllowed({ RAILWAY_ENVIRONMENT_NAME: 'production', DATABASE_URL: PROD_URL }));
});

test('unknown environment (e.g. docker build) is not enforced at runtime', () => {
  assert.doesNotThrow(() => assertDatabaseTargetAllowed({ DATABASE_URL: PROD_URL }));
  assert.doesNotThrow(() => assertDatabaseTargetAllowed({}));
});

test('STAGING refuses the shared production Postgres hostname even if allow-listed', () => {
  assert.throws(
    () =>
      assertDatabaseTargetAllowed({
        RAILWAY_ENVIRONMENT_NAME: 'STAGING',
        DATABASE_URL: PROD_URL,
        OXIVOLT_DB_ALLOWED_HOSTS: 'postgres.railway.internal',
      }),
    /production Postgres service hostname/,
  );
});

test('STAGING refuses Railway public proxy hosts', () => {
  assert.throws(
    () =>
      assertDatabaseTargetAllowed({
        RAILWAY_ENVIRONMENT_NAME: 'STAGING',
        DATABASE_URL: 'postgresql://u:p@shuttle.proxy.rlwy.net:41234/railway',
        OXIVOLT_DB_ALLOWED_HOSTS: 'shuttle.proxy.rlwy.net',
      }),
    /public proxy/,
  );
});

test('STAGING fails closed without an allow-list and allows only listed hosts', () => {
  assert.throws(() => assertDatabaseTargetAllowed({ RAILWAY_ENVIRONMENT_NAME: 'STAGING', DATABASE_URL: V2_URL }), /not in OXIVOLT_DB_ALLOWED_HOSTS/);
  assert.throws(() => assertDatabaseTargetAllowed({ RAILWAY_ENVIRONMENT_NAME: 'STAGING' }), /DATABASE_URL is not set/);
  assert.doesNotThrow(() =>
    assertDatabaseTargetAllowed({
      RAILWAY_ENVIRONMENT_NAME: 'STAGING',
      OXIVOLT_ENV: 'staging',
      DATABASE_URL: V2_URL,
      OXIVOLT_DB_ALLOWED_HOSTS: ' Postgres-Staging-V2.railway.internal ',
    }),
  );
});

test('loopback is implicitly allowed off Railway only', () => {
  const local = 'postgresql://u:p@127.0.0.1:5433/oxivolt_dev';
  assert.doesNotThrow(() => assertDatabaseTargetAllowed({ OXIVOLT_ENV: 'development', DATABASE_URL: local }));
  assert.throws(() => assertDatabaseTargetAllowed({ OXIVOLT_ENV: 'staging', RAILWAY_ENVIRONMENT_NAME: 'STAGING', DATABASE_URL: local }));
  assert.throws(() => assertDatabaseTargetAllowed({ OXIVOLT_ENV: 'development', DATABASE_URL: 'postgresql://u:p@db.example.com/x' }));
});

test('parseDatabaseUrl never echoes credentials in errors and rejects non-postgres URLs', () => {
  assert.deepEqual(parseDatabaseUrl(V2_URL), { host: 'postgres-staging-v2.railway.internal', port: '5432', database: 'railway' });
  assert.throws(() => parseDatabaseUrl('mysql://u:p@h/db'), /postgresql/);
  try {
    assertDatabaseTargetAllowed({ RAILWAY_ENVIRONMENT_NAME: 'STAGING', DATABASE_URL: PROD_URL });
    assert.fail('expected throw');
  } catch (e) {
    assert.ok(!(e as Error).message.includes('secret'));
  }
});

test('checkShopifyApp refuses the production Shopify client id in non-production', () => {
  const resolved = resolveEnvironment({ RAILWAY_ENVIRONMENT_NAME: 'STAGING' });
  assert.equal(resolved.kind, 'non-production');
  if (resolved.kind !== 'non-production') return;
  assert.throws(() => checkShopifyApp({ SHOPIFY_API_KEY: 'PRODKEY', OXIVOLT_FORBIDDEN_SHOPIFY_API_KEYS: 'prodkey' }, resolved), /PRODUCTION Shopify app/);
  assert.doesNotThrow(() => checkShopifyApp({ SHOPIFY_API_KEY: 'devkey', OXIVOLT_FORBIDDEN_SHOPIFY_API_KEYS: 'prodkey' }, resolved));
  assert.doesNotThrow(() => checkShopifyApp({ SHOPIFY_API_KEY: 'devkey' }, resolved));
});

// --- preflight script end-to-end (no database is reachable at these hosts) ---
const ROOT = path.resolve(__dirname, '..');
function preflight(env: Record<string, string>, args: string[] = []) {
  const clean: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/preflight.ts', ...args], {
    cwd: ROOT,
    env: { ...clean, ...env } as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

test('preflight: production never migrates and exits 0', () => {
  const r = preflight({ RAILWAY_ENVIRONMENT_NAME: 'production', DATABASE_URL: PROD_URL, OXIVOLT_RUN_MIGRATIONS: 'true' }, ['--migrate']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Migration requested in PRODUCTION — ignored/);
  assert.doesNotMatch(r.stdout + r.stderr, /running `prisma migrate deploy`/);
});

test('preflight: STAGING pointed at the production hostname is refused (exit 1)', () => {
  const r = preflight({ RAILWAY_ENVIRONMENT_NAME: 'STAGING', DATABASE_URL: PROD_URL });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REFUSED/);
});

test('preflight: migration in an unknown environment is refused', () => {
  const r = preflight({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x' }, ['--migrate']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /environment unknown/);
});
