declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    AGENT_TOKEN: string;
    PREVIEW_SUFFIX: string;
  }
}
interface Env extends Cloudflare.Env {}

declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[];
  }
}

declare module '*?raw' {
  const content: string;
  export default content;
}
