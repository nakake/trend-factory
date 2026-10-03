import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { collect } from '../src/collect';
import { parseTraffic, parseTrendsRss } from '../src/rss';
import fixture from './fixtures/trends-jp.xml?raw';

const fakeFetch = (xml: string, init?: ResponseInit) => (async () => new Response(xml, init)) as unknown as typeof fetch;
// 2026-10-03 00:10 JST
const AT_JST_0 = new Date('2026-10-02T15:10:00Z');
// 2026-10-03 01:10 JST
const AT_JST_1 = new Date('2026-10-02T16:10:00Z');

const item = (title: string, extra = '', pub = 'Fri, 2 Oct 2026 10:00:00 -0700') =>
  `<item><title>${title}</title><ht:approx_traffic>10+</ht:approx_traffic><pubDate>${pub}</pubDate>${extra}</item>`;
const news = (t: string, url: string) =>
  `<ht:news_item><ht:news_item_title>${t}</ht:news_item_title><ht:news_item_url>${url}</ht:news_item_url><ht:news_item_source>s</ht:news_item_source></ht:news_item>`;

describe('parseTrendsRss', () => {
  it('extracts term, traffic, JST day and news', () => {
    const items = parseTrendsRss(fixture);
    expect(items.length).toBe(10);
    const first = items[0];
    expect(first.term).toBe('熊坂光希');
    expect(first.traffic).toBe(1000);
    expect(first.dayJst).toBe('2026-10-03');
    expect(first.news.length).toBeGreaterThan(0);
    expect(first.news[0].source).not.toBe('');
    expect(first.news[0].url).toMatch(/^https:\/\//);
  });
  it('converts traffic notations', () => {
    expect(parseTraffic('5000+')).toBe(5000);
    expect(parseTraffic('1,000+')).toBe(1000);
    expect(parseTraffic('2万+')).toBe(20000);
    expect(parseTraffic(undefined)).toBe(0);
  });
  it('uses the JST date of pubDate across the day boundary', () => {
    const [it] = parseTrendsRss(item('x &amp; y'));
    expect(it.term).toBe('x & y');
    expect(it.dayJst).toBe('2026-10-03');
  });
  it('replaces out-of-range numeric references with U+FFFD instead of throwing', () => {
    const items = parseTrendsRss(item('a&#99999999999;b&#xD800;c&#0;d&#x41;'));
    expect(items[0].term).toBe('a�b�c�dA');
  });
  it('skips only the broken item', () => {
    const items = parseTrendsRss(
      item('ok1') + item('bad', '', 'not a date') + `<item><title>no date</title></item>` + item('ok2'),
    );
    expect(items.map((i) => i.term)).toEqual(['ok1', 'ok2']);
  });
  it('keeps only https news urls', () => {
    const [it] = parseTrendsRss(
      item('t', news('a', 'javascript:alert(1)') + news('b', 'http://x.example/') + news('c', 'https://x.example/p')),
    );
    expect(it.news.map((n) => n.url)).toEqual(['', '', 'https://x.example/p']);
  });
});

describe('collect', () => {
  it('upserts and logs a run', async () => {
    const r = await collect(env, AT_JST_1, fakeFetch(fixture));
    expect(r.count).toBe(10);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trends').first<{ n: number }>();
    expect(n!.n).toBeGreaterThan(0);
    const run = await env.DB.prepare('SELECT kind, result FROM runs').first();
    expect(run).toEqual({ kind: 'collect', result: 'ok' });
  });

  it('keeps the larger traffic and updates last_seen', async () => {
    await collect(env, AT_JST_1, fakeFetch(fixture));
    const lower = fixture.replace('<ht:approx_traffic>1000+', '<ht:approx_traffic>200+');
    await collect(env, new Date(AT_JST_1.getTime() + 3600_000), fakeFetch(lower));
    const row = await env.DB.prepare(`SELECT traffic, first_seen, last_seen FROM trends WHERE term = '熊坂光希'`).first<{
      traffic: number;
      first_seen: string;
      last_seen: string;
    }>();
    expect(row!.traffic).toBe(1000);
    expect(row!.last_seen > row!.first_seen).toBe(true);

    const higher = fixture.replace('<ht:approx_traffic>1000+', '<ht:approx_traffic>9000+');
    await collect(env, new Date(AT_JST_1.getTime() + 7200_000), fakeFetch(higher));
    const row2 = await env.DB.prepare(`SELECT traffic FROM trends WHERE term = '熊坂光希'`).first<{ traffic: number }>();
    expect(row2!.traffic).toBe(9000);
  });

  it('keeps the existing news when a refetch has none', async () => {
    await collect(env, AT_JST_1, fakeFetch(item('keep', news('headline', 'https://x.example/'))));
    await collect(env, AT_JST_1, fakeFetch(item('keep')));
    const row = await env.DB.prepare(`SELECT news_json FROM trends WHERE term = 'keep'`).first<{ news_json: string }>();
    expect(JSON.parse(row!.news_json)[0].title).toBe('headline');
  });

  it('handles a term repeated in one feed', async () => {
    await collect(env, AT_JST_1, fakeFetch(item('dup') + item('dup')));
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM trends WHERE term = 'dup'`).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  const dayOffset = (d: number) => new Date(AT_JST_0.getTime() + 9 * 3600_000 - d * 86400_000).toISOString().slice(0, 10);
  async function seedDays(...days: number[]) {
    await env.DB.batch(
      days.map((d) => env.DB.prepare(`INSERT INTO trends VALUES (?, ?, 1, '[]', 'a', 'a')`).bind(`d${d}`, dayOffset(d))),
    );
  }
  const remaining = async () =>
    (await env.DB.prepare(`SELECT term FROM trends WHERE term LIKE 'd%' ORDER BY term`).all()).results.map((r) => r.term);

  it('purges at the retention boundary in the JST 0 hour (N days stay, N+1 days go)', async () => {
    await seedDays(400, 401, 10);
    await collect(env, AT_JST_0, fakeFetch(fixture));
    expect(await remaining()).toEqual(['d10', 'd400']);
  });

  it('purges old runs with the same retention in the JST 0 hour, and keeps them otherwise', async () => {
    const at = (d: number) => new Date(AT_JST_0.getTime() - d * 86400_000 - 1000).toISOString();
    const seed = () =>
      env.DB.batch(
        [399, 401].map((d) =>
          env.DB.prepare(`INSERT INTO runs (kind, started_at, finished_at, result) VALUES (?, ?, ?, 'ok')`).bind(`old${d}`, at(d), at(d)),
        ),
      );
    const kinds = async () =>
      (await env.DB.prepare(`SELECT kind FROM runs WHERE kind LIKE 'old%' ORDER BY kind`).all()).results.map((r) => r.kind);
    await seed();
    await collect(env, AT_JST_1, fakeFetch(fixture));
    expect(await kinds()).toEqual(['old399', 'old401']);
    await collect(env, AT_JST_0, fakeFetch(fixture));
    expect(await kinds()).toEqual(['old399']);
    const own = await env.DB.prepare(`SELECT COUNT(*) AS n FROM runs WHERE kind = 'collect'`).first<{ n: number }>();
    expect(own!.n).toBe(2);
  });

  it('has the runs indexes', async () => {
    const r = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'runs'`).all();
    const names = r.results.map((x) => x.name);
    expect(names).toContain('idx_runs_kind_started');
    expect(names).toContain('idx_runs_result_started');
  });

  it('does not purge outside the JST 0 hour', async () => {
    await seedDays(401, 10);
    await collect(env, AT_JST_1, fakeFetch(fixture));
    expect(await remaining()).toEqual(['d10', 'd401']);
  });

  it('honours a non-default retention_days', async () => {
    await env.DB.prepare(`UPDATE settings SET value = '30' WHERE key = 'retention_days'`).run();
    await seedDays(30, 31, 5);
    await collect(env, AT_JST_0, fakeFetch(fixture));
    expect(await remaining()).toEqual(['d30', 'd5']);
  });

  it.each(['5', '0', '-1'])('treats retention_days=%s as 30 days (never wipes the table)', async (v) => {
    await env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'retention_days'`).bind(v).run();
    await seedDays(30, 31, 5);
    await collect(env, AT_JST_0, fakeFetch(fixture));
    expect(await remaining()).toEqual(['d30', 'd5']);
  });

  it('falls back to 400 days when retention_days is not a number', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await env.DB.prepare(`UPDATE settings SET value = 'abc' WHERE key = 'retention_days'`).run();
    await seedDays(400, 401);
    await collect(env, AT_JST_0, fakeFetch(fixture));
    expect(await remaining()).toEqual(['d400']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  async function lastRun() {
    return env.DB.prepare('SELECT result, note FROM runs ORDER BY id DESC').first<{ result: string; note: string }>();
  }

  it('records a failed run on a non-200', async () => {
    await expect(collect(env, AT_JST_1, fakeFetch('x', { status: 500 }))).rejects.toThrow('500');
    const run = await lastRun();
    expect(run!.result).toBe('failed');
    expect(run!.note).toContain('500');
  });

  it('records a failed run when fetch throws', async () => {
    const boom = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(collect(env, AT_JST_1, boom)).rejects.toThrow('network down');
    expect((await lastRun())!.note).toContain('network down');
  });

  it('treats zero items as failed, noting content-type and the head of the body', async () => {
    const html = '<html>' + 'x'.repeat(300);
    await expect(collect(env, AT_JST_1, fakeFetch(html, { headers: { 'content-type': 'text/html' } }))).rejects.toThrow();
    const run = await lastRun();
    expect(run!.result).toBe('failed');
    expect(run!.note).toContain('text/html');
    expect(run!.note).toContain('<html>');
    expect(run!.note.length).toBeLessThan(300);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trends').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('fails on bodies over 1MB (declared and actual)', async () => {
    const big = 'a'.repeat(1_000_001);
    await expect(collect(env, AT_JST_1, fakeFetch(big))).rejects.toThrow('too large');
    const declared = (async () => new Response('x', { headers: { 'content-length': '2000000' } })) as unknown as typeof fetch;
    await expect(collect(env, AT_JST_1, declared)).rejects.toThrow('too large');
    expect((await lastRun())!.result).toBe('failed');
  });

  it('rethrows the original error even if recording the failure fails', async () => {
    const e = { DB: { prepare: () => { throw new Error('db down'); } } } as unknown as Env;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(collect(e, AT_JST_1, fakeFetch('x', { status: 500 }))).rejects.toThrow('500');
    spy.mockRestore();
  });
});
