import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, idea } from './helpers';

type Claim = { idea: Record<string, unknown> & { slug: string; status: string; attempts: number; scores: Record<string, number> } };

const agoHours = (h: number) => new Date(Date.now() - h * 3600_000 - 60_000).toISOString();
const status = async (slug: string) =>
  env.DB.prepare('SELECT status, attempts, claimed_at FROM ideas WHERE slug = ?').bind(slug).first<{
    status: string;
    attempts: number;
    claimed_at: string | null;
  }>();

describe('POST /api/agent/claim', () => {
  it('returns 204 when there is nothing to claim', async () => {
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
  });

  it('ignores candidates below min_score', async () => {
    await call('POST', '/api/agent/ideas', [idea('low-one', 59)]);
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
  });

  it('uses a non-default min_score from settings', async () => {
    await env.DB.prepare(`UPDATE settings SET value = '70' WHERE key = 'min_score'`).run();
    await call('POST', '/api/agent/ideas', [idea('mid-one', 69), idea('hit-one', 70)]);
    const res = await call('POST', '/api/agent/claim');
    expect(((await res.json()) as Claim).idea.slug).toBe('hit-one');
    await env.DB.prepare(`UPDATE ideas SET status = 'built'`).run();
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
  });

  it('falls back to 60 when min_score is not a number', async () => {
    await env.DB.prepare(`UPDATE settings SET value = 'x' WHERE key = 'min_score'`).run();
    await call('POST', '/api/agent/ideas', [idea('low-one', 59), idea('hit-one', 60)]);
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('hit-one');
  });

  it('claims the highest score at or above min_score and counts the attempt', async () => {
    await call('POST', '/api/agent/ideas', [idea('mid-one', 70), idea('top-one', 90), idea('edge-one', 60)]);
    const a = await call('POST', '/api/agent/claim');
    expect(a.status).toBe(200);
    const first = ((await a.json()) as Claim).idea;
    expect(first.slug).toBe('top-one');
    expect(first.status).toBe('building');
    expect(first.attempts).toBe(1);
    expect(first.scores).toEqual({ need: 30, demand: 25, fit: 25, novelty: 10, longevity: 0 });
  });

  it('does not return sources', async () => {
    await call('POST', '/api/agent/ideas', [idea('top-one', 90)]);
    const body = ((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea;
    expect(Object.keys(body).sort()).toEqual(
      ['attempts', 'claimed_at', 'created_at', 'id', 'scores', 'slug', 'status', 'summary', 'title', 'total'].sort(),
    );
    expect(JSON.stringify(body)).not.toContain('ycombinator');
  });

  it('prefers the newer idea when totals are equal', async () => {
    await call('POST', '/api/agent/ideas', [idea('old-one', 80), idea('mid-one', 80), idea('new-one', 80), idea('low-one', 70)]);
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'old-one'`).bind(agoHours(48)).run();
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'new-one'`).bind(agoHours(-1)).run();
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('new-one');
  });

  it('prefers the larger id when total and created_at are equal', async () => {
    await call('POST', '/api/agent/ideas', [idea('first-one', 80), idea('second-one', 80)]);
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('second-one');
  });

  it('still prefers a higher total over a newer idea', async () => {
    await call('POST', '/api/agent/ideas', [idea('top-one', 90), idea('new-one', 80)]);
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'top-one'`).bind(agoHours(48)).run();
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('top-one');
  });

  it('skips candidates older than candidate_ttl_days before claiming', async () => {
    await call('POST', '/api/agent/ideas', [idea('stale-one', 95), idea('edge-one', 90), idea('fresh-one', 70), idea('stale-low', 10)]);
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug LIKE 'stale-%'`).bind(agoHours(21 * 24)).run();
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'edge-one'`).bind(agoHours(21 * 24 - 1)).run();
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('edge-one');
    expect((await status('stale-one'))!.status).toBe('skipped');
    expect((await status('stale-low'))!.status).toBe('skipped');
    expect((await status('fresh-one'))!.status).toBe('candidate');
  });

  it('expires old candidates even when the claim itself returns 204', async () => {
    await call('POST', '/api/agent/ideas', [idea('stale-one', 95)]);
    await env.DB.prepare(`UPDATE ideas SET created_at = ?`).bind(agoHours(22 * 24)).run();
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
    expect((await status('stale-one'))!.status).toBe('skipped');
  });

  it('does not expire built or building ideas', async () => {
    await call('POST', '/api/agent/ideas', [idea('done-one', 90), idea('busy-one', 90)]);
    await env.DB.prepare(`UPDATE ideas SET status = 'built' WHERE slug = 'done-one'`).run();
    await env.DB.prepare(`UPDATE ideas SET status = 'building', claimed_at = ? WHERE slug = 'busy-one'`).bind(agoHours(1)).run();
    await env.DB.prepare(`UPDATE ideas SET created_at = ?`).bind(agoHours(30 * 24)).run();
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
    expect((await status('done-one'))!.status).toBe('built');
    expect((await status('busy-one'))!.status).toBe('building');
  });

  it('expires an old idea that timed out of building instead of handing it out again', async () => {
    await call('POST', '/api/agent/ideas', [idea('stuck-one', 90)]);
    await call('POST', '/api/agent/claim');
    await env.DB.prepare(`UPDATE ideas SET claimed_at = ?, created_at = ?`).bind(agoHours(7), agoHours(22 * 24)).run();
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
    expect((await status('stuck-one'))!.status).toBe('skipped');
  });

  it('uses candidate_ttl_days from settings', async () => {
    await env.DB.prepare(`UPDATE settings SET value = '3' WHERE key = 'candidate_ttl_days'`).run();
    await call('POST', '/api/agent/ideas', [idea('four-days', 90), idea('two-days', 80)]);
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'four-days'`).bind(agoHours(4 * 24)).run();
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'two-days'`).bind(agoHours(2 * 24)).run();
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('two-days');
    expect((await status('four-days'))!.status).toBe('skipped');
  });

  it.each(['x', '', '0', '-5'])('falls back to a safe TTL when candidate_ttl_days is %j', async (value) => {
    await env.DB.prepare(`UPDATE settings SET value = ? WHERE key = 'candidate_ttl_days'`).bind(value).run();
    await call('POST', '/api/agent/ideas', [idea('recent-one', 90)]);
    await env.DB.prepare(`UPDATE ideas SET created_at = ?`).bind(agoHours(12)).run();
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('recent-one');
  });

  it('uses 21 days when candidate_ttl_days is missing', async () => {
    await env.DB.prepare(`DELETE FROM settings WHERE key = 'candidate_ttl_days'`).run();
    await call('POST', '/api/agent/ideas', [idea('old-one', 90), idea('ok-one', 80)]);
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'old-one'`).bind(agoHours(22 * 24)).run();
    await env.DB.prepare(`UPDATE ideas SET created_at = ? WHERE slug = 'ok-one'`).bind(agoHours(20 * 24)).run();
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('ok-one');
    expect((await status('old-one'))!.status).toBe('skipped');
  });

  it('returns 204 while another idea is building, then hands out the next one after it is built', async () => {
    await call('POST', '/api/agent/ideas', [idea('mid-one', 70), idea('top-one', 90)]);
    await call('POST', '/api/agent/claim');
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
    await env.DB.prepare(`UPDATE ideas SET status = 'built' WHERE slug = 'top-one'`).run();
    expect(((await (await call('POST', '/api/agent/claim')).json()) as Claim).idea.slug).toBe('mid-one');
  });

  it('does not hand out the same idea to concurrent claims', async () => {
    await call('POST', '/api/agent/ideas', [idea('only-one', 90), idea('next-one', 80)]);
    const rs = await Promise.all([call('POST', '/api/agent/claim'), call('POST', '/api/agent/claim')]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 204]);
  });

  it('returns ideas building for 6 hours or more to candidate and claims them again', async () => {
    await call('POST', '/api/agent/ideas', [idea('stuck-one', 90)]);
    await call('POST', '/api/agent/claim');
    await env.DB.prepare(`UPDATE ideas SET claimed_at = ?`).bind(agoHours(6)).run();
    const res = await call('POST', '/api/agent/claim');
    expect(res.status).toBe(200);
    const body = ((await res.json()) as Claim).idea;
    expect(body.slug).toBe('stuck-one');
    expect(body.attempts).toBe(2);
  });

  it('keeps recent building ideas as they are', async () => {
    await call('POST', '/api/agent/ideas', [idea('fresh-one', 90), idea('other-one', 80)]);
    await call('POST', '/api/agent/claim');
    await env.DB.prepare(`UPDATE ideas SET claimed_at = ? WHERE slug = 'fresh-one'`).bind(agoHours(5)).run();
    expect((await call('POST', '/api/agent/claim')).status).toBe(204);
    expect((await status('fresh-one'))!.status).toBe('building');
  });

  it('skips an idea whose third attempt times out', async () => {
    await call('POST', '/api/agent/ideas', [idea('stuck-one', 90), idea('next-one', 80)]);
    for (let i = 0; i < 3; i++) {
      const r = await call('POST', '/api/agent/claim');
      expect(((await r.json()) as Claim).idea.slug).toBe('stuck-one');
      await env.DB.prepare(`UPDATE ideas SET claimed_at = ? WHERE slug = 'stuck-one'`).bind(agoHours(7)).run();
    }
    expect((await status('stuck-one'))!.attempts).toBe(3);
    const r = await call('POST', '/api/agent/claim');
    expect(((await r.json()) as Claim).idea.slug).toBe('next-one');
    expect((await status('stuck-one'))!.status).toBe('skipped');
  });
});
