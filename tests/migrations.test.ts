// Static guards for the migration setup (no database needed). The full
// schema-vs-migrations comparison runs in scripts/check-migrations.sh (CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('baseline migration 0_init and migration_lock.toml exist (postgresql)', () => {
  assert.match(read('prisma/migrations/migration_lock.toml'), /provider\s*=\s*"postgresql"/);
  const sql = read('prisma/migrations/0_init/migration.sql');
  for (const t of ['ShopSession', 'ShopBilling', 'EditLog', 'UsageCounter']) {
    assert.match(sql, new RegExp(`CREATE TABLE "${t}"`));
  }
});

test('migrations are additive-only: no DROP / TRUNCATE / DELETE FROM in any migration', () => {
  const dir = path.join(ROOT, 'prisma/migrations');
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, 'utf8').replace(/--.*$/gm, '');
    assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i, `${name} contains a destructive statement — needs explicit review`);
  }
});

test('container startup no longer runs `prisma db push` and goes through the preflight guard', () => {
  const docker = read('Dockerfile');
  const cmd = docker.split('\n').filter((l) => /^\s*(CMD|ENTRYPOINT)\b/.test(l)).join('\n');
  assert.doesNotMatch(cmd, /db push/);
  assert.doesNotMatch(cmd, /migrate (reset|dev|resolve)/);
  assert.match(cmd, /scripts\/preflight\.ts/);
  const pkg = JSON.parse(read('package.json'));
  for (const [name, script] of Object.entries<string>(pkg.scripts)) {
    assert.doesNotMatch(script, /db push|migrate reset|--force-reset|--accept-data-loss/, `script "${name}"`);
  }
});

test('lib/db.ts runs the database target guard before creating PrismaClient', () => {
  const src = read('lib/db.ts');
  const guard = src.indexOf('assertDatabaseTargetAllowed(process.env)');
  assert.ok(guard > 0, 'guard call missing');
  assert.ok(guard < src.indexOf('new PrismaClient('), 'guard must run before PrismaClient is created');
});
