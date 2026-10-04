import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, HN, idea, scoresFor } from './helpers';

const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM ideas').first<{ n: number }>())!.n;

describe('POST /api/agent/ideas', () => {
  it('inserts valid ideas', async () => {
    const res = await call('POST', '/api/agent/ideas', [idea('aa-one'), idea('bb-two')]);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: ['aa-one', 'bb-two'], skipped: [] });
    const list = (await (await call('GET', '/api/agent/ideas')).json()) as { ideas: Record<string, unknown>[] };
    expect(list.ideas).toHaveLength(2);
    expect(Object.keys(list.ideas[0]).sort()).toEqual(['created_at', 'slug', 'status', 'title', 'total']);
    expect(list.ideas[0].status).toBe('candidate');
  });

  it.each([
    ['uppercase slug', idea('A_bad')],
    ['short slug', idea('ab')],
    ['leading digit', idea('1abc')],
    ['leading hyphen', idea('-abc')],
    ['trailing hyphen', idea('abc-')],
    ['39+ char slug', idea('a' + 'b'.repeat(40))],
    ['long title', idea('aa-x', 80, { title: 'x'.repeat(101) })],
    ['title over 300 bytes', idea('aa-x', 80, { title: 'あ'.repeat(100) + 'x' })],
    ['long summary', idea('aa-x', 80, { summary: 'x'.repeat(2001) })],
    ['empty title', idea('aa-x', 80, { title: '' })],
    ['non-numeric score', idea('aa-x', 80, { scores: { ...scoresFor(80), need: 'high' } })],
    ['missing scores', idea('aa-x', 80, { scores: undefined })],
    ['missing score key', idea('aa-x', 50, { scores: { need: 30, demand: 20, fit: 0, novelty: 0 } })],
    ['extra score key', idea('aa-x', 80, { scores: { ...scoresFor(80), effort: 0 } })],
    ['renamed score key', idea('aa-x', 30, { scores: { Need: 30, demand: 0, fit: 0, novelty: 0, longevity: 0 } })],
    ['scores as array', idea('aa-x', 80, { scores: [30, 25, 25, 0, 0] })],
    ['need over 30', idea('aa-x', 31, { scores: { need: 31, demand: 0, fit: 0, novelty: 0, longevity: 0 } })],
    ['demand over 25', idea('aa-x', 26, { scores: { need: 0, demand: 26, fit: 0, novelty: 0, longevity: 0 } })],
    ['fit over 25', idea('aa-x', 26, { scores: { need: 0, demand: 0, fit: 26, novelty: 0, longevity: 0 } })],
    ['novelty over 10', idea('aa-x', 11, { scores: { need: 0, demand: 0, fit: 0, novelty: 11, longevity: 0 } })],
    ['longevity over 10', idea('aa-x', 11, { scores: { need: 0, demand: 0, fit: 0, novelty: 0, longevity: 11 } })],
    ['negative score', idea('aa-x', 9, { scores: { need: -1, demand: 10, fit: 0, novelty: 0, longevity: 0 } })],
    ['fractional score', idea('aa-x', 20.5, { scores: { need: 20.5, demand: 0, fit: 0, novelty: 0, longevity: 0 } })],
    ['total above the sum', idea('aa-x', 80, { total: 81 })],
    ['total below the sum', idea('aa-x', 80, { total: 79 })],
    ['total over 100', idea('aa-x', 101)],
    ['negative total', idea('aa-x', -1)],
    ['string total', idea('aa-x', 80, { total: '80' })],
    ['missing total', idea('aa-x', 80, { total: undefined })],
    ['http source', idea('aa-x', 80, { sources: ['http://news.ycombinator.com/item?id=1'] })],
    ['javascript source', idea('aa-x', 80, { sources: ['javascript:alert(1)'] })],
    ['source on another host', idea('aa-x', 80, { sources: ['https://example.com/'] })],
    ['HN URL that is not an item', idea('aa-x', 80, { sources: ['https://news.ycombinator.com/user?id=1'] })],
    ['HN item with a non-numeric id', idea('aa-x', 80, { sources: ['https://news.ycombinator.com/item?id=1x'] })],
    ['HN item with extra parameters', idea('aa-x', 80, { sources: ['https://news.ycombinator.com/item?id=1&x=2'] })],
    ['HN lookalike host', idea('aa-x', 80, { sources: ['https://news.ycombinator.com.evil.example/item?id=1'] })],
    ['Product Hunt without www', idea('aa-x', 80, { sources: ['https://producthunt.com/posts/x'] })],
    ['Product Hunt lookalike host', idea('aa-x', 80, { sources: ['https://www.producthunt.com.evil.example/posts/x'] })],
    ['Product Hunt userinfo trick', idea('aa-x', 80, { sources: ['https://www.producthunt.com@evil.example/'] })],
    ['source with space', idea('aa-x', 80, { sources: ['https://www.producthunt.com/a b'] })],
    ['source over 1500 bytes', idea('aa-x', 80, { sources: ['https://www.producthunt.com/' + 'a'.repeat(1500)] })],
    ['6 sources', idea('aa-x', 80, { sources: Array.from({ length: 6 }, () => HN) })],
    ['non-string source', idea('aa-x', 80, { sources: [1] })],
    ['control char in title', idea('aa-x', 80, { title: 'a\u0000b' })],
    ['newline in title', idea('aa-x', 80, { title: 'a\nb' })],
    ['DEL in summary', idea('aa-x', 80, { summary: 'a\u007fb' })],
    ['bidi override in title', idea('aa-x', 80, { title: 'a\u202eb' })],
    ['zero-width space in title', idea('aa-x', 80, { title: 'a\u200bb' })],
    ['BOM in summary', idea('aa-x', 80, { summary: 'a\ufeffb' })],
    ['isolate in summary', idea('aa-x', 80, { summary: 'a\u2066b' })],
    ['zero-width char in source', idea('aa-x', 80, { sources: ['https://www.producthunt.com/a\u200bb'] })],
    ['bidi char in source', idea('aa-x', 80, { sources: ['https://www.producthunt.com/a\u202eb'] })],
    ['tab in summary', idea('aa-x', 80, { summary: 'a\tb' })],
  ])('rejects %s with 400 and inserts nothing', async (_n, badIdea) => {
    const res = await call('POST', '/api/agent/ideas', [idea('good-one'), badIdea]);
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('allows newlines in summary and edge values', async () => {
    const res = await call('POST', '/api/agent/ideas', [
      idea('aa-edge', 100, { summary: 'line1\nline2' }),
      idea('bb-zero', 0),
      idea('cc-wide', 50, { title: 'あ'.repeat(100), summary: 'あ'.repeat(2000) }),
      idea('dd-nosrc', 60, { sources: [] }),
      idea('ee-nosrc', 60, { sources: undefined }),
      idea('ff-srcs', 60, {
        sources: [HN, 'https://news.ycombinator.com/item?id=45678901', 'https://www.producthunt.com/posts/some-tool', 'https://www.producthunt.com/products/x?utm=1', 'https://www.producthunt.com/'],
      }),
    ]);
    expect(res.status).toBe(201);
    const row = await env.DB.prepare(`SELECT scores_json, total FROM ideas WHERE slug = 'aa-edge'`).first();
    expect(row).toEqual({ scores_json: JSON.stringify({ need: 30, demand: 25, fit: 25, novelty: 10, longevity: 10 }), total: 100 });
  });

  it('names the failing field in the 400 body', async () => {
    const res = await call('POST', '/api/agent/ideas', [idea('aa-x', 80, { total: 81, sources: ['https://example.com/'] })]);
    const body = (await res.json()) as { error: string[] };
    expect(body.error).toEqual([
      '[0].sources[0] must be https://news.ycombinator.com/item?id=<digits> or start with https://www.producthunt.com/',
      '[0].total must equal the sum of scores',
    ]);
  });

  it('rejects non-arrays, empty arrays and more than 20', async () => {
    expect((await call('POST', '/api/agent/ideas', idea('aa-x'))).status).toBe(400);
    expect((await call('POST', '/api/agent/ideas', [])).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => idea(`slug-${i}`));
    expect((await call('POST', '/api/agent/ideas', many)).status).toBe(400);
  });

  it('rejects bodies that are not JSON, huge, or contain 1e999', async () => {
    expect((await call('POST', '/api/agent/ideas', '{not json')).status).toBe(400);
    expect((await call('POST', '/api/agent/ideas', '')).status).toBe(400);
    const big = JSON.stringify([idea('aa-x', 80, { summary: 'x'.repeat(300_000) })]);
    expect((await call('POST', '/api/agent/ideas', big)).status).toBe(413);
    const inf = '[{"slug":"aa-inf","title":"t","summary":"s","scores":{"need":1e999,"demand":0,"fit":0,"novelty":0,"longevity":0},"total":50}]';
    expect((await call('POST', '/api/agent/ideas', inf)).status).toBe(400);
    const infTotal = '[{"slug":"aa-inf","title":"t","summary":"s","total":1e999}]';
    expect((await call('POST', '/api/agent/ideas', infTotal)).status).toBe(400);
  });

  it('returns 413 from content-length without reading the body', async () => {
    const res = await (await import('./helpers')).callWith(env, 'POST', '/api/agent/ideas', '[]', 'test-token', {
      'content-length': '999999',
    });
    expect(res.status).toBe(413);
  });

  it('returns 409 when every slug is a duplicate', async () => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90)]);
    const res = await call('POST', '/api/agent/ideas', [idea('aa-one', 10, { title: 'overwrite?' })]);
    expect(res.status).toBe(409);
    const row = await env.DB.prepare(`SELECT title, total FROM ideas WHERE slug = 'aa-one'`).first();
    expect(row).toEqual({ title: 'title aa-one', total: 90 });
  });

  it('inserts the new ones and reports duplicates as skipped', async () => {
    await call('POST', '/api/agent/ideas', [idea('aa-one')]);
    const res = await call('POST', '/api/agent/ideas', [idea('aa-one'), idea('cc-new')]);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: ['cc-new'], skipped: ['aa-one'] });
  });

  it('treats a duplicate inside one request as skipped, not inserted', async () => {
    const res = await call('POST', '/api/agent/ideas', [idea('dd-one', 70), idea('dd-one', 99)]);
    expect(await res.json()).toEqual({ inserted: ['dd-one'], skipped: ['dd-one'] });
    const row = await env.DB.prepare(`SELECT total FROM ideas WHERE slug = 'dd-one'`).first();
    expect(row).toEqual({ total: 70 });
  });

  it('returns 429 beyond 40 ideas in 24 hours, and ignores older ones', async () => {
    const batch = (p: string) => Array.from({ length: 20 }, (_, i) => idea(`${p}-${i}`));
    expect((await call('POST', '/api/agent/ideas', batch('aa'))).status).toBe(201);
    expect((await call('POST', '/api/agent/ideas', batch('bb'))).status).toBe(201);
    const res = await call('POST', '/api/agent/ideas', [idea('cc-over')]);
    expect(res.status).toBe(429);
    expect(await count()).toBe(40);
    await env.DB.prepare(`UPDATE ideas SET created_at = '2000-01-01T00:00:00.000Z'`).run();
    expect((await call('POST', '/api/agent/ideas', [idea('cc-over')])).status).toBe(201);
  });
});
