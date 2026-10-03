import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { call, callWith, envWith, idea } from './helpers';

const PR = 'https://github.com/nakake/trend-factory/pull/12';
const preview = (slug: string) => `https://${slug}-preview.${env.PREVIEW_SUFFIX}`;

async function building(slug: string) {
  await call('POST', '/api/agent/ideas', [idea(slug, 90)]);
  await call('POST', '/api/agent/claim');
}
const post = (slug: string, pr = PR) => call('POST', '/api/agent/builds', { slug, preview_url: preview(slug), pr_url: pr });

describe('POST /api/agent/builds', () => {
  it('records the build and marks the idea built', async () => {
    await building('tool-one');
    expect((await post('tool-one')).status).toBe(201);
    const row = await env.DB.prepare(`SELECT status FROM ideas WHERE slug = 'tool-one'`).first();
    expect(row).toEqual({ status: 'built' });
  });

  it('accepts a trailing slash on preview_url', async () => {
    await building('tool-one');
    const res = await call('POST', '/api/agent/builds', { slug: 'tool-one', preview_url: `${preview('tool-one')}/`, pr_url: PR });
    expect(res.status).toBe(201);
  });

  it.each([
    ['http scheme', (s: string) => `http://${s}-preview.${env.PREVIEW_SUFFIX}`],
    ['other slug', () => preview('other-one')],
    ['other host', (s: string) => `https://${s}-preview.evil.example`],
    ['suffix as unescaped regex (dot wildcard)', (s: string) => `https://${s}-preview.${env.PREVIEW_SUFFIX.replace('.', 'x')}`],
    ['trailing path', (s: string) => `${preview(s)}/x`],
    ['userinfo', (s: string) => `https://evil.example@${s}-preview.${env.PREVIEW_SUFFIX}`],
  ])('rejects preview_url: %s', async (_n, make) => {
    await building('tool-one');
    const res = await call('POST', '/api/agent/builds', { slug: 'tool-one', preview_url: make('tool-one'), pr_url: PR });
    expect(res.status).toBe(400);
  });

  it.each([
    'https://github.com/other/repo/pull/1',
    'https://github.com/nakake/trend-factory/pull/x',
    'https://github.com/nakake/trend-factory/pull/1/files',
    'http://github.com/nakake/trend-factory/pull/1',
  ])('rejects pr_url %s', async (pr) => {
    await building('tool-one');
    expect((await post('tool-one', pr)).status).toBe(400);
  });

  it('returns 409 for ideas that are not building', async () => {
    await call('POST', '/api/agent/ideas', [idea('cand-one', 90)]);
    expect((await post('cand-one')).status).toBe(409);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM builds').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('returns 409 for unknown slugs and for a second registration', async () => {
    expect((await post('tool-one')).status).toBe(409);
    await building('tool-one');
    expect((await post('tool-one')).status).toBe(201);
    expect((await post('tool-one')).status).toBe(409);
  });

  it('returns 409 (and leaves the idea building) when pr_url is already used', async () => {
    await building('tool-one');
    expect((await post('tool-one')).status).toBe(201);
    await env.DB.prepare(`UPDATE ideas SET status = 'built'`).run();
    await building('tool-two');
    const res = await post('tool-two');
    expect(res.status).toBe(409);
    const row = await env.DB.prepare(`SELECT status FROM ideas WHERE slug = 'tool-two'`).first();
    expect(row).toEqual({ status: 'building' });
  });

  it('returns 429 after 5 builds in 24 hours', async () => {
    const now = new Date().toISOString();
    for (let i = 1; i <= 5; i++)
      await env.DB.prepare(`INSERT INTO builds VALUES (?, 'p', ?, ?)`).bind(`old-${i}`, `https://github.com/nakake/trend-factory/pull/${100 + i}`, now).run();
    await building('tool-one');
    expect((await post('tool-one')).status).toBe(429);
    await env.DB.prepare(`UPDATE builds SET created_at = '2000-01-01T00:00:00.000Z' WHERE slug = 'old-1'`).run();
    expect((await post('tool-one')).status).toBe(201);
  });

  it.each([undefined, '', 'REPLACE-ME.workers.dev'])('returns 503 when PREVIEW_SUFFIX is %j', async (suffix) => {
    await building('tool-one');
    const e = envWith({ PREVIEW_SUFFIX: suffix as unknown as string });
    const res = await callWith(e, 'POST', '/api/agent/builds', { slug: 'tool-one', preview_url: 'https://tool-one-preview.x', pr_url: PR });
    expect(res.status).toBe(503);
  });

  it('turns unexpected errors into a JSON 500 without leaking details', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = { ...envWith({}), DB: { prepare: () => { throw new Error('secret detail'); } } } as unknown as Env;
    const res = await callWith(e, 'POST', '/api/agent/builds', { slug: 'tool-one', preview_url: preview('tool-one'), pr_url: PR });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret');
    spy.mockRestore();
  });
});
