import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call } from './helpers';

describe('POST /api/agent/runs', () => {
  it('starts a run and finishes it by id', async () => {
    const s = await call('POST', '/api/agent/runs', { kind: 'build', result: 'started' });
    expect(s.status).toBe(201);
    const { id } = (await s.json()) as { id: number };
    const e = await call('POST', '/api/agent/runs', { kind: 'build', result: 'ok', id, note: 'done\nline2' });
    expect(e.status).toBe(200);
    const row = await env.DB.prepare('SELECT result, note, finished_at FROM runs WHERE id = ?').bind(id).first();
    expect(row).toMatchObject({ result: 'ok', note: 'done\nline2' });
    expect(row!.finished_at).not.toBeNull();
  });

  it('does not rewrite a finished run, and checks kind', async () => {
    const { id } = (await (await call('POST', '/api/agent/runs', { kind: 'ideas', result: 'started' })).json()) as { id: number };
    expect((await call('POST', '/api/agent/runs', { kind: 'build', result: 'ok', id })).status).toBe(409);
    await call('POST', '/api/agent/runs', { kind: 'ideas', result: 'ok', id });
    expect((await call('POST', '/api/agent/runs', { kind: 'ideas', result: 'failed', id })).status).toBe(409);
  });

  it('records a one-shot noop', async () => {
    expect((await call('POST', '/api/agent/runs', { kind: 'build', result: 'noop' })).status).toBe(201);
  });

  it.each([
    [{ kind: 'deploy', result: 'ok' }],
    [{ kind: 'build', result: 'weird' }],
    [{ kind: 'build', result: 'ok', note: 'x'.repeat(1001) }],
    [{ kind: 'build', result: 'ok', note: 'a\u0000b' }],
    [{ kind: 'build', result: 'ok', note: 'a\tb' }],
    [{ kind: 'build', result: 'ok', note: 5 }],
    [{ kind: 'build', result: 'started', id: 1 }],
    [{ kind: 'build', result: 'ok', id: 1.5 }],
    [{ kind: 'build', result: 'ok', id: '1' }],
    [{ kind: 'build', result: 'ok', id: null }],
  ])('rejects %j', async (body) => {
    expect((await call('POST', '/api/agent/runs', body)).status).toBe(400);
  });

  it('returns 429 after 60 ideas/build runs in 24 hours, ignoring collect runs', async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      ...Array.from({ length: 100 }, () => env.DB.prepare(`INSERT INTO runs (kind, started_at, result) VALUES ('collect', ?, 'ok')`).bind(now)),
      ...Array.from({ length: 60 }, () => env.DB.prepare(`INSERT INTO runs (kind, started_at, result) VALUES ('ideas', ?, 'ok')`).bind(now)),
    ]);
    expect((await call('POST', '/api/agent/runs', { kind: 'ideas', result: 'started' })).status).toBe(429);
    await env.DB.prepare(`UPDATE runs SET started_at = '2000-01-01T00:00:00.000Z' WHERE kind = 'ideas' AND id % 2 = 0`).run();
    expect((await call('POST', '/api/agent/runs', { kind: 'ideas', result: 'started' })).status).toBe(201);
  });
});

describe('GET /api/agent/trends', () => {
  const insert = (term: string, traffic: number, seen: string, news = '[]') =>
    env.DB.prepare(`INSERT INTO trends VALUES (?, '2026-10-03', ?, ?, ?, ?)`).bind(term, traffic, news, seen, seen);

  it('returns recent trends, caps hours, and gives up to 3 news titles only', async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 200 * 3600_000).toISOString();
    const news = JSON.stringify([1, 2, 3, 4].map((i) => ({ title: `t${i}`, url: 'https://x.example', source: 's' })));
    await env.DB.batch([insert('new', 5, now, news), insert('old', 5, old)]);
    const body = (await (await call('GET', '/api/agent/trends?hours=999')).json()) as { trends: { term: string; news: unknown[] }[] };
    expect(body.trends.map((t) => t.term)).toEqual(['new']);
    expect(body.trends[0].news).toEqual(['t1', 't2', 't3']);
  });

  it('orders by traffic and honours limit (default 300, max 500)', async () => {
    const now = new Date().toISOString();
    await env.DB.batch(Array.from({ length: 510 }, (_, i) => insert(`term${i}`, i, now)));
    const t = async (q: string) => ((await (await call('GET', `/api/agent/trends${q}`)).json()) as { trends: { term: string }[] }).trends;
    const def = await t('');
    expect(def).toHaveLength(300);
    expect(def[0].term).toBe('term509');
    expect(await t('?limit=2')).toHaveLength(2);
    expect(await t('?limit=9999')).toHaveLength(500);
  });
});
