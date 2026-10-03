import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { collect } from '../src/collect';
import { parseTraffic, parseTrendsRss } from '../src/rss';
import fixture from './fixtures/trends-jp.xml?raw';

const fakeFetch = (xml: string) => (async () => new Response(xml)) as unknown as typeof fetch;
// 2026-10-03 00:10 JST
const AT_JST_0 = new Date('2026-10-02T15:10:00Z');
// 2026-10-03 01:10 JST
const AT_JST_1 = new Date('2026-10-02T16:10:00Z');

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
    expect(first.news[1].url).toMatch(/^https:\/\//);
  });
  it('converts traffic notations', () => {
    expect(parseTraffic('5000+')).toBe(5000);
    expect(parseTraffic('1,000+')).toBe(1000);
    expect(parseTraffic('2万+')).toBe(20000);
    expect(parseTraffic(undefined)).toBe(0);
  });
  it('uses the JST date of pubDate across the day boundary', () => {
    const xml = `<item><title>x &amp; y</title><ht:approx_traffic>10+</ht:approx_traffic>
      <pubDate>Fri, 2 Oct 2026 10:00:00 -0700</pubDate></item>`;
    const [it] = parseTrendsRss(xml);
    expect(it.term).toBe('x & y');
    expect(it.dayJst).toBe('2026-10-03');
  });
});

describe('collect', () => {
  it('upserts and logs a run', async () => {
    const r = await collect(env, AT_JST_1, fakeFetch(fixture));
    expect(r.count).toBe(10);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trends').first<{ n: number }>();
    expect(n!.n).toBe(10);
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

  async function seedOld() {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO trends VALUES ('old', '2025-01-01', 1, '[]', 'a', 'a')`),
      env.DB.prepare(`INSERT INTO trends VALUES ('recent', '2026-09-01', 1, '[]', 'a', 'a')`),
    ]);
  }

  it('purges trends older than retention_days in the JST 0 hour', async () => {
    await seedOld();
    await collect(env, AT_JST_0, fakeFetch(fixture));
    const terms = (await env.DB.prepare(`SELECT term FROM trends WHERE term IN ('old','recent')`).all()).results.map(
      (r) => r.term,
    );
    expect(terms).toEqual(['recent']);
  });

  it('does not purge outside the JST 0 hour', async () => {
    await seedOld();
    await collect(env, AT_JST_1, fakeFetch(fixture));
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM trends WHERE term IN ('old','recent')`).first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it('records a failed run when the fetch fails', async () => {
    const failing = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(collect(env, AT_JST_1, failing)).rejects.toThrow();
    const run = await env.DB.prepare('SELECT result, note FROM runs').first<{ result: string; note: string }>();
    expect(run!.result).toBe('failed');
    expect(run!.note).toContain('500');
  });
});
