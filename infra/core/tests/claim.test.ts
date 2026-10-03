import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, idea } from './helpers';

type Claim = { idea: { slug: string; status: string; scores: Record<string, number> } };

describe('POST /api/agent/claim', () => {
  it('returns 204 when there is nothing to claim', async () => {
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
  });

  it('ignores candidates below min_score', async () => {
    await call('POST', '/api/agent/ideas', [idea('low-one', 59)]);
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
  });

  it('claims the highest score at or above min_score, and never twice', async () => {
    await call('POST', '/api/agent/ideas', [idea('mid-one', 70), idea('top-one', 90), idea('edge-one', 60)]);
    const a = await call('POST', '/api/agent/claim');
    expect(a.status).toBe(200);
    const first = ((await a.json()) as Claim).idea;
    expect(first.slug).toBe('top-one');
    expect(first.status).toBe('building');
    expect(first.scores).toEqual({ need: 20, effort: 20 });

    const b = await call('POST', '/api/agent/claim');
    expect(((await b.json()) as Claim).idea.slug).toBe('mid-one');
  });

  it('does not hand out the same idea to concurrent claims', async () => {
    await call('POST', '/api/agent/ideas', [idea('only-one', 90)]);
    const rs = await Promise.all([call('POST', '/api/agent/claim'), call('POST', '/api/agent/claim')]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 204]);
  });

  it('returns ideas building for 6 hours or more to candidate', async () => {
    await call('POST', '/api/agent/ideas', [idea('stuck-one', 90)]);
    await call('POST', '/api/agent/claim');
    const old = new Date(Date.now() - 6 * 3600_000 - 60_000).toISOString();
    await env.DB.prepare(`UPDATE ideas SET claimed_at = ? WHERE slug = 'stuck-one'`).bind(old).run();
    const res = await call('POST', '/api/agent/claim');
    expect(res.status).toBe(200);
    expect(((await res.json()) as Claim).idea.slug).toBe('stuck-one');
  });

  it('keeps recent building ideas as they are', async () => {
    await call('POST', '/api/agent/ideas', [idea('fresh-one', 90)]);
    await call('POST', '/api/agent/claim');
    const recent = new Date(Date.now() - 5 * 3600_000).toISOString();
    await env.DB.prepare(`UPDATE ideas SET claimed_at = ? WHERE slug = 'fresh-one'`).bind(recent).run();
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
  });
});
