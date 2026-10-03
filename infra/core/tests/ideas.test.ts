import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, idea } from './helpers';

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
    ['non-numeric score', idea('aa-x', 80, { scores: { a: 'high' } })],
    ['bad score key', idea('aa-x', 80, { scores: { 'Bad Key': 1 } })],
    ['score key too long', idea('aa-x', 80, { scores: { ['a'.repeat(31)]: 1 } })],
    ['11 score keys', idea('aa-x', 80, { scores: Object.fromEntries('abcdefghijk'.split('').map((k) => [k, 1])) })],
    ['scores as array', idea('aa-x', 80, { scores: [1] })],
    ['total over 100', idea('aa-x', 101)],
    ['negative total', idea('aa-x', -1)],
    ['string total', idea('aa-x', 80, { total: '80' })],
    ['http source', idea('aa-x', 80, { sources: ['http://example.com'] })],
    ['javascript source', idea('aa-x', 80, { sources: ['javascript:alert(1)'] })],
    ['source with space', idea('aa-x', 80, { sources: ['https://example.com/a b'] })],
    ['source over 1500 bytes', idea('aa-x', 80, { sources: ['https://e.com/' + 'a'.repeat(1500)] })],
    ['21 sources', idea('aa-x', 80, { sources: Array.from({ length: 21 }, () => 'https://example.com') })],
    ['non-string source', idea('aa-x', 80, { sources: [1] })],
    ['control char in title', idea('aa-x', 80, { title: 'a\u0000b' })],
    ['newline in title', idea('aa-x', 80, { title: 'a\nb' })],
    ['DEL in summary', idea('aa-x', 80, { summary: 'a\u007fb' })],
    ['bidi override in title', idea('aa-x', 80, { title: 'a\u202eb' })],
    ['zero-width space in title', idea('aa-x', 80, { title: 'a\u200bb' })],
    ['BOM in summary', idea('aa-x', 80, { summary: 'a\ufeffb' })],
    ['isolate in summary', idea('aa-x', 80, { summary: 'a\u2066b' })],
    ['zero-width char in source', idea('aa-x', 80, { sources: ['https://example.com/a\u200bb'] })],
    ['bidi char in source', idea('aa-x', 80, { sources: ['https://example.com/a\u202eb'] })],
    ['tab in summary', idea('aa-x', 80, { summary: 'a\tb' })],
  ])('rejects %s with 400 and inserts nothing', async (_n, badIdea) => {
    const res = await call('POST', '/api/agent/ideas', [idea('good-one'), badIdea]);
    expect(res.status).toBe(400);
    expect(await count()).toBe(0);
  });

  it('allows newlines in summary and edge values', async () => {
    const res = await call('POST', '/api/agent/ideas', [
      idea('aa-edge', 100, { summary: 'line1\nline2', scores: { a_b: -1.5, c: 0 } }),
      idea('bb-zero', 0),
      idea('cc-wide', 50, { title: 'あ'.repeat(100), summary: 'あ'.repeat(2000) }),
    ]);
    expect(res.status).toBe(201);
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
    const inf = '[{"slug":"aa-inf","title":"t","summary":"s","scores":{"a":1e999},"total":50}]';
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
