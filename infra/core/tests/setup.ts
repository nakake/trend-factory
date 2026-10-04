import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM trends'),
    env.DB.prepare('DELETE FROM ideas'),
    env.DB.prepare('DELETE FROM builds'),
    env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('retention_days', '400'), ('min_score', '60'), ('candidate_ttl_days', '21')`),
  ]);
});
