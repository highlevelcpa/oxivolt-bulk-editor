/**
 * Environment safety guard — keeps non-production deployments (STAGING, local
 * development, CI) from talking to the PRODUCTION database or Shopify app.
 *
 * Design rules:
 *  - PRODUCTION behaviour is unchanged: when the environment resolves to
 *    `production` every check is a no-op (no new required variables).
 *  - Unknown environments (no OXIVOLT_ENV and no RAILWAY_ENVIRONMENT_NAME, e.g.
 *    a Docker build step) are not enforced at runtime; the migration preflight
 *    refuses to migrate them instead.
 *  - Positively identified NON-production environments fail CLOSED: the
 *    database host must be explicitly allow-listed.
 *
 * Pure functions only (no I/O, no network) so it is safe to import anywhere
 * and trivially unit-testable.
 */

export type EnvName = 'production' | 'staging' | 'development' | 'test';
export type Resolved =
  | { kind: 'production'; source: string }
  | { kind: 'non-production'; name: Exclude<EnvName, 'production'>; source: string; onRailway: boolean }
  | { kind: 'unknown' };

type Env = Record<string, string | undefined>;

const DECLARED: readonly EnvName[] = ['production', 'staging', 'development', 'test'];

/**
 * Hostname of the Railway Postgres service named "Postgres". The PRODUCTION
 * database uses it — and so does the legacy STAGING database, because Railway
 * environments clone service names. A non-production deployment must point at
 * a uniquely named service (e.g. postgres-staging-v2.railway.internal) so a
 * copied/forked DATABASE_URL can never silently resolve to production's DB.
 */
export const SHARED_PRODUCTION_DB_HOSTS: readonly string[] = ['postgres.railway.internal'];

/** Railway public TCP proxy domains — never valid for non-production use. */
const PUBLIC_PROXY_SUFFIXES: readonly string[] = ['.proxy.rlwy.net', '.rlwy.net'];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class EnvGuardError extends Error {
  constructor(message: string) {
    super(`[env-guard] ${message}`);
    this.name = 'EnvGuardError';
  }
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** Resolve which environment we are running in. Throws on contradictory labels. */
export function resolveEnvironment(env: Env): Resolved {
  const declaredRaw = env.OXIVOLT_ENV?.trim().toLowerCase();
  const railwayRaw = env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
  const onRailway = Boolean(railwayRaw);

  if (declaredRaw && !DECLARED.includes(declaredRaw as EnvName)) {
    throw new EnvGuardError(`OXIVOLT_ENV="${env.OXIVOLT_ENV}" is not one of ${DECLARED.join(', ')}.`);
  }
  const declared = declaredRaw as EnvName | undefined;

  if (declared && railwayRaw) {
    const declaredProd = declared === 'production';
    const railwayProd = railwayRaw === 'production';
    if (declaredProd !== railwayProd) {
      throw new EnvGuardError(
        `environment label mismatch: OXIVOLT_ENV="${declared}" but RAILWAY_ENVIRONMENT_NAME="${env.RAILWAY_ENVIRONMENT_NAME}". ` +
          'Variables were probably copied between environments — refusing to continue.',
      );
    }
  }

  if (declared === 'production') return { kind: 'production', source: 'OXIVOLT_ENV' };
  if (declared) return { kind: 'non-production', name: declared, source: 'OXIVOLT_ENV', onRailway };
  if (railwayRaw === 'production') return { kind: 'production', source: 'RAILWAY_ENVIRONMENT_NAME' };
  if (railwayRaw) return { kind: 'non-production', name: 'staging', source: 'RAILWAY_ENVIRONMENT_NAME', onRailway };
  return { kind: 'unknown' };
}

export interface DbTarget {
  host: string;
  port: string;
  database: string;
}

/** Parse a postgres URL without ever returning/logging credentials. */
export function parseDatabaseUrl(url: string | undefined): DbTarget {
  if (!url || !url.trim()) throw new EnvGuardError('DATABASE_URL is not set.');
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new EnvGuardError('DATABASE_URL is not a valid URL.');
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
    throw new EnvGuardError(`DATABASE_URL must use postgresql://, got "${u.protocol}".`);
  }
  const host = u.hostname.toLowerCase();
  if (!host) throw new EnvGuardError('DATABASE_URL has no host.');
  return { host, port: u.port || '5432', database: decodeURIComponent(u.pathname.replace(/^\//, '')) };
}

/**
 * Non-production database rules (throws EnvGuardError on violation):
 *  1. never a public Railway TCP proxy host;
 *  2. never the shared production service hostname (postgres.railway.internal);
 *  3. host must be listed in OXIVOLT_DB_ALLOWED_HOSTS — loopback hosts are
 *     implicitly allowed only OFF Railway (local dev / CI).
 */
export function checkDatabaseTarget(env: Env, resolved: Extract<Resolved, { kind: 'non-production' }>): DbTarget {
  const target = parseDatabaseUrl(env.DATABASE_URL);
  const where = `${resolved.name} (${resolved.source})`;

  if (PUBLIC_PROXY_SUFFIXES.some((s) => target.host.endsWith(s))) {
    throw new EnvGuardError(`${where}: DATABASE_URL host "${target.host}" is a Railway public proxy — refused.`);
  }
  if (SHARED_PRODUCTION_DB_HOSTS.includes(target.host)) {
    throw new EnvGuardError(
      `${where}: DATABASE_URL host "${target.host}" is the production Postgres service hostname — refused. ` +
        'Point this environment at a uniquely named database service (e.g. postgres-staging-v2.railway.internal).',
    );
  }
  const allowed = list(env.OXIVOLT_DB_ALLOWED_HOSTS);
  const ok = allowed.includes(target.host) || (!resolved.onRailway && LOOPBACK.has(target.host));
  if (!ok) {
    throw new EnvGuardError(
      `${where}: DATABASE_URL host "${target.host}" is not in OXIVOLT_DB_ALLOWED_HOSTS ` +
        `(${allowed.length ? allowed.join(', ') : 'empty'}) — refused.`,
    );
  }
  return target;
}

/**
 * Non-production Shopify rule: SHOPIFY_API_KEY (the public client id) must not
 * be one of OXIVOLT_FORBIDDEN_SHOPIFY_API_KEYS (set this to the production app's
 * client id in STAGING). No-op when the deny-list is empty.
 */
export function checkShopifyApp(env: Env, resolved: Extract<Resolved, { kind: 'non-production' }>): void {
  const key = env.SHOPIFY_API_KEY?.trim().toLowerCase();
  if (key && list(env.OXIVOLT_FORBIDDEN_SHOPIFY_API_KEYS).includes(key)) {
    throw new EnvGuardError(
      `${resolved.name} (${resolved.source}): SHOPIFY_API_KEY is the PRODUCTION Shopify app — refused. Use a separate development app.`,
    );
  }
}

/**
 * Runtime guard used by lib/db.ts before creating the Prisma client.
 * Production and unknown environments: no-op. Non-production: enforce.
 */
export function assertDatabaseTargetAllowed(env: Env): void {
  const resolved = resolveEnvironment(env);
  if (resolved.kind !== 'non-production') return;
  checkDatabaseTarget(env, resolved);
}
