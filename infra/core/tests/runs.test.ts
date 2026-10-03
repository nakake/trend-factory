import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { call } from './helpers';

describe('POST /api/agent/runs', () => {
  it('starts a run and finishes it by id', async () => {
    const s = await call('POST', '/api/agent/runs', { kind: 'build', result: 'started' });
    expect(s.status).toBe(201);
    const { id } = (await s.json()) as { id: number };
    const e = await call('POST', '/api/agent/runs', { kind: 'build', result: 'ok', id, note: 'done' });
    expect(e.status).toBe(200);
    const row = await env.DB.prepare('SELECT result, note, finished_at FROM runs WHERE id = ?').bind(id).first();
    expect(row).toMatchObject({ result: 'ok', note: 'done' });
    expect(row!.finished_at).not.toBeNull();
  });

  it('does not rewrite a finished run', async () => {
    const { id } = (await (await call('POST', '/api/agent/runs', { kind: 'ideas', result: 'started' })).json()) as { id: number };
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
    [{ kind: 'build', result: 'started', id: 1 }],
  ])('rejects %j', async (body) => {
    expect((await call('POST', '/api/agent/runs', body)).status).toBe(400);
  });
});

describe('GET /api/agent/trends', () => {
  it('returns recent trends and caps hours', async () => {
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 200 * 3600_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO trends VALUES ('new', '2026-10-03', 5, '[{"title":"t"}]', ?1, ?1)`).bind(now),
      env.DB.prepare(`INSERT INTO trends VALUES ('old', '2026-09-20', 5, '[]', ?1, ?1)`).bind(old),
    ]);
    const body = (await (await call('GET', '/api/agent/trends?hours=999')).json()) as { trends: { term: string; news: unknown[] }[] };
    expect(body.trends.map((t) => t.term)).toEqual(['new']);
    expect(body.trends[0].news).toEqual([{ title: 't' }]);
  });
});
