import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, idea } from './helpers';

const PR = 'https://github.com/nakake/trend-factory/pull/12';
const preview = (slug: string) => `https://${slug}-preview.${env.PREVIEW_SUFFIX}`;

async function building(slug: string) {
  await call('POST', '/api/agent/ideas', [idea(slug, 90)]);
  await call('POST', '/api/agent/claim');
}

describe('POST /api/agent/builds', () => {
  it('records the build and marks the idea built', async () => {
    await building('tool-one');
    const res = await call('POST', '/api/agent/builds', { slug: 'tool-one', preview_url: preview('tool-one'), pr_url: PR });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare(`SELECT status FROM ideas WHERE slug = 'tool-one'`).first();
    expect(row).toEqual({ status: 'built' });
  });

  it('accepts a trailing slash on preview_url', async () => {
    await building('tool-one');
    const res = await call('POST', '/api/agent/builds', {
      slug: 'tool-one',
      preview_url: `${preview('tool-one')}/`,
      pr_url: PR,
    });
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
    const res = await call('POST', '/api/agent/builds', { slug: 'tool-one', preview_url: preview('tool-one'), pr_url: pr });
    expect(res.status).toBe(400);
  });

  it('returns 409 for ideas that are not building', async () => {
    await call('POST', '/api/agent/ideas', [idea('cand-one', 90)]);
    const res = await call('POST', '/api/agent/builds', { slug: 'cand-one', preview_url: preview('cand-one'), pr_url: PR });
    expect(res.status).toBe(409);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM builds').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it('returns 409 for unknown slugs and for a second registration', async () => {
    const body = { slug: 'tool-one', preview_url: preview('tool-one'), pr_url: PR };
    expect((await call('POST', '/api/agent/builds', body)).status).toBe(409);
    await building('tool-one');
    expect((await call('POST', '/api/agent/builds', body)).status).toBe(201);
    expect((await call('POST', '/api/agent/builds', body)).status).toBe(409);
  });
});
