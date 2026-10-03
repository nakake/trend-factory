import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  // スキーマの正本は core。console は読むだけなのでマイグレーションを持たない
  const migrations = await readD1Migrations('../core/migrations');
  return {
    test: { setupFiles: ['./tests/setup.ts'] },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // pool が持つ workerd は本番用 wrangler より古く、wrangler.jsonc の日付(2026-10-01)を起動できない
          compatibilityDate: '2026-08-01',
          bindings: {
            ACCESS_TEAM_DOMAIN: 'test-team.cloudflareaccess.com',
            ACCESS_AUD: 'test-aud',
            ALLOWED_EMAIL: 'me@example.com',
            PREVIEW_SUFFIX: 'preview.example.workers.dev',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
  };
});
