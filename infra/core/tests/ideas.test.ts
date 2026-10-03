import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, idea } from './helpers';

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
    ['bad slug', idea('A_bad')],
    ['short slug', idea('a')],
    ['leading hyphen', idea('-abc')],
    ['long title', idea('aa-x', 80, { title: 'x'.repeat(101) })],
    ['long summary', idea('aa-x', 80, { summary: 'x'.repeat(2001) })],
    ['non-numeric score', idea('aa-x', 80, { scores: { a: 'high' } })],
    ['total over 100', idea('aa-x', 101)],
    ['negative total', idea('aa-x', -1)],
  ])('rejects %s with 400 and inserts nothing', async (_n, bad) => {
    const res = await call('POST', '/api/agent/ideas', [idea('good-one'), bad]);
    expect(res.status).toBe(400);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM ideas').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('rejects non-arrays, empty arrays and more than 20', async () => {
    expect((await call('POST', '/api/agent/ideas', idea('aa-x'))).status).toBe(400);
    expect((await call('POST', '/api/agent/ideas', [])).status).toBe(400);
    const many = Array.from({ length: 21 }, (_, i) => idea(`slug-${i}`));
    expect((await call('POST', '/api/agent/ideas', many)).status).toBe(400);
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
});
