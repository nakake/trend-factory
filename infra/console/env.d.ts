declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUD: string;
    ALLOWED_EMAIL: string;
    PREVIEW_SUFFIX: string;
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[];
  }
}
interface Env extends Cloudflare.Env {}
