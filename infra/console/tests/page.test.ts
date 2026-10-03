import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeKey, request, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey('k1');
});

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const page = async () => {
  const res = await request('GET', '/', { key });
  return { res, html: await res.text() };
};

const insertRun = (kind: string, result: string, msAgo: number, note: string | null = null) =>
  env.DB.prepare('INSERT INTO runs (kind, started_at, finished_at, result, note) VALUES (?, ?, ?, ?, ?)')
    .bind(kind, iso(msAgo), iso(msAgo), result, note)
    .run();

const insertIdea = (slug: string, o: Record<string, unknown> = {}) =>
  env.DB.prepare(
    'INSERT INTO ideas (slug, title, summary, sources_json, scores_json, total, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      slug,
      o.title ?? `title ${slug}`,
      o.summary ?? 'summary',
      o.sources ?? '["https://example.com/a"]',
      o.scores ?? '{"need":20,"effort":15}',
      o.total ?? 75,
      o.status ?? 'candidate',
      o.attempts ?? 0,
      iso(1000),
    )
    .run();

describe('page', () => {
  it('renders 200 with an empty database', async () => {
    const { res, html } = await page();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('成功した記録がありません');
    expect(html).toContain('trends 0 / ideas 0 / builds 0 / runs 0');
  });

  it('sends the security headers', async () => {
    for (const path of ['/', '/style.css', '/nope']) {
      const res = await request('GET', path, { key });
      expect(res.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('uses no inline style or script', async () => {
    await insertIdea('a-idea');
    const { html } = await page();
    expect(html).not.toMatch(/<script|style=|<style/i);
  });

  it('serves css and 404s elsewhere', async () => {
    const css = await request('GET', '/style.css', { key });
    expect(css.headers.get('content-type')).toContain('text/css');
    expect((await request('GET', '/other', { key })).status).toBe(404);
  });

  it('warns when the last successful collect is 2 hours old or more', async () => {
    await insertRun('collect', 'ok', 3 * 3600_000);
    expect((await page()).html).toContain('2 時間以上成功していません');
  });

  it('does not warn when collect is recent, and ignores failed collects as success', async () => {
    await insertRun('collect', 'ok', 30 * 60_000);
    await insertRun('collect', 'failed', 1000, 'boom');
    const { html } = await page();
    expect(html).not.toContain('2 時間以上成功していません');
    expect(html).toContain('boom');
  });

  it('shows last ideas/build runs and 7-day failures only', async () => {
    await insertRun('ideas', 'ok', 5000, 'made 3');
    await insertRun('build', 'noop', 4000);
    await insertRun('build', 'failed', 3 * 86400_000, 'recent-fail');
    await insertRun('build', 'failed', 9 * 86400_000, 'old-fail');
    const { html } = await page();
    expect(html).toContain('made 3');
    expect(html).toContain('recent-fail');
    expect(html).not.toContain('old-fail');
  });

  it('formats times in JST', async () => {
    await env.DB.prepare('INSERT INTO runs (kind, started_at, finished_at, result) VALUES (?, ?, ?, ?)')
      .bind('collect', '2026-10-03T15:30:00.000Z', '2026-10-03T15:30:01.000Z', 'ok')
      .run();
    expect((await page()).html).toContain('2026-10-04 00:30');
  });

  it('shows ideas with Japanese status, scores and attempts', async () => {
    await insertIdea('build-me', { status: 'building', attempts: 2 });
    const { html } = await page();
    expect(html).toContain('実装中');
    expect(html).toContain('need 20');
    expect(html).toContain('https://example.com/a');
  });

  it('lists builds with links only for the expected shapes', async () => {
    const ok = `https://good-tool-preview.${env.PREVIEW_SUFFIX}`;
    const pr = 'https://github.com/nakake/trend-factory/pull/7';
    await env.DB.prepare('INSERT INTO builds (slug, preview_url, pr_url, created_at) VALUES (?, ?, ?, ?)')
      .bind('good-tool', ok, pr, iso(1000))
      .run();
    await env.DB.prepare('INSERT INTO builds (slug, preview_url, pr_url, created_at) VALUES (?, ?, ?, ?)')
      .bind('bad-tool', 'https://evil.example/x', 'https://github.com/other/repo/pull/1', iso(2000))
      .run();
    const { html } = await page();
    expect(html).toContain(`href="${ok}" rel="noopener noreferrer"`);
    expect(html).toContain(`href="${pr}" rel="noopener noreferrer"`);
    expect(html).toContain('href="https://tool-good-tool.nakake.com"');
    expect(html).toContain('マージ後に有効');
    expect(html).not.toContain('href="https://evil.example');
    expect(html).not.toContain('href="https://github.com/other');
  });

  it('does not link previews while PREVIEW_SUFFIX is a placeholder', async () => {
    const url = 'https://good-tool-preview.REPLACE-ME.workers.dev';
    await env.DB.prepare('INSERT INTO builds (slug, preview_url, pr_url, created_at) VALUES (?, ?, ?, ?)')
      .bind('good-tool', url, 'https://github.com/nakake/trend-factory/pull/1', iso(1000))
      .run();
    const res = await request('GET', '/', { key, env: { PREVIEW_SUFFIX: 'REPLACE-ME.workers.dev' } });
    expect(await res.text()).not.toContain(`href="${url}"`);
  });

  it('shows the 30 biggest trends from the last 24 hours with news', async () => {
    const ins = (term: string, traffic: number, msAgo: number, news = '[]') =>
      env.DB.prepare('INSERT INTO trends (term, day_jst, traffic, news_json, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(term, '2026-10-03', traffic, news, iso(msAgo), iso(msAgo))
        .run();
    await ins('big-term', 100000, 1000, JSON.stringify([{ title: 'headline-1', url: 'https://news.example/1', source: 's' }]));
    await ins('stale-term', 999999, 30 * 3600_000);
    for (let i = 0; i < 35; i++) await ins(`filler-${i}`, i, 1000);
    const { html } = await page();
    expect(html).toContain('big-term');
    expect(html).toContain('<a href="https://news.example/1" rel="noopener noreferrer">headline-1</a>');
    expect(html).not.toContain('stale-term');
    expect(html.match(/<tr><td>(big-term|filler-\d+)<\/td>/g)).toHaveLength(30);
  });
});

describe('XSS', () => {
  it('escapes DB strings and refuses dangerous hrefs', async () => {
    await insertIdea('xss-idea', {
      title: '<script>alert(1)</script>',
      summary: '"onmouseover="alert(2)" <img src=x onerror=alert(3)>',
      sources: JSON.stringify(['javascript:alert(4)', 'https://ok.example/"onmouseover="x', 'https://ok.example/fine']),
      scores: JSON.stringify({ '<b>k</b>': '<i>v</i>' }),
    });
    await env.DB.prepare('INSERT INTO builds (slug, preview_url, pr_url, created_at) VALUES (?, ?, ?, ?)')
      .bind('x"onload="y', 'javascript:alert(5)', 'javascript:alert(6)', iso(1000))
      .run();
    await env.DB.prepare('INSERT INTO trends (term, day_jst, traffic, news_json, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('<script>t</script>', '2026-10-03', 5, JSON.stringify([{ title: '<svg onload=1>', url: 'javascript:alert(7)' }]), iso(10), iso(10))
      .run();
    await insertRun('build', 'failed', 1000, '<script>note</script>');
    const { html } = await page();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/<b>k/);
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('href="https://ok.example/&quot;');
    // エスケープ済みの文字として残るのは構わない。実際のタグの属性になっていないことを見る
    expect(html).not.toMatch(/<[^>]*\son\w+=/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('href="https://ok.example/fine"');
  });
});

describe('read-only', () => {
  it('returns 405 for everything but GET/HEAD, even without a JWT', async () => {
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await request(m, '/', { key, jwt: null });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD');
    }
  });
  it('allows HEAD', async () => {
    expect((await request('HEAD', '/', { key })).status).toBe(200);
  });
});
