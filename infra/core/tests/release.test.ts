import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { call, idea } from './helpers';

const row = async (slug: string) =>
  env.DB.prepare('SELECT status, attempts, claimed_at FROM ideas WHERE slug = ?').bind(slug).first<{
    status: string;
    attempts: number;
    claimed_at: string | null;
  }>();
const release = (slug: unknown, outcome: unknown) => call('POST', '/api/agent/release', { slug, outcome });
const claim = async () => ((await (await call('POST', '/api/agent/claim')).json()) as { idea: { slug: string } }).idea.slug;

describe('POST /api/agent/release', () => {
  it('requires the token', async () => {
    expect((await call('POST', '/api/agent/release', { slug: 'aa-one', outcome: 'skip' }, null)).status).toBe(401);
  });

  it('retry returns a building idea to candidate and clears claimed_at', async () => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90)]);
    await claim();
    const res = await release('aa-one', 'retry');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: 'aa-one', status: 'candidate' });
    expect(await row('aa-one')).toEqual({ status: 'candidate', attempts: 1, claimed_at: null });
  });

  it('a released idea can be claimed again right away, and the attempt is counted at claim', async () => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90)]);
    await claim();
    await release('aa-one', 'retry');
    expect(await claim()).toBe('aa-one');
    expect((await row('aa-one'))!.attempts).toBe(2);
  });

  it('retry on the third attempt skips the idea', async () => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90), idea('bb-next', 80)]);
    for (let i = 1; i <= 2; i++) {
      expect(await claim()).toBe('aa-one');
      expect(await (await release('aa-one', 'retry')).json()).toEqual({ slug: 'aa-one', status: 'candidate' });
    }
    expect(await claim()).toBe('aa-one');
    expect(await (await release('aa-one', 'retry')).json()).toEqual({ slug: 'aa-one', status: 'skipped' });
    expect(await row('aa-one')).toEqual({ status: 'skipped', attempts: 3, claimed_at: null });
    expect(await claim()).toBe('bb-next');
  });

  it('skip skips at once, even on the first attempt, and frees the pipeline', async () => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90), idea('bb-next', 80)]);
    await claim();
    const res = await release('aa-one', 'skip');
    expect(await res.json()).toEqual({ slug: 'aa-one', status: 'skipped' });
    expect(await row('aa-one')).toEqual({ status: 'skipped', attempts: 1, claimed_at: null });
    expect(await claim()).toBe('bb-next');
  });

  it.each(['candidate', 'built', 'skipped'])('returns 409 and changes nothing when the idea is %s', async (status) => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90)]);
    await env.DB.prepare(`UPDATE ideas SET status = ?`).bind(status).run();
    for (const outcome of ['retry', 'skip']) {
      expect((await release('aa-one', outcome)).status).toBe(409);
    }
    expect((await row('aa-one'))!.status).toBe(status);
  });

  it('returns 409 for an unknown slug', async () => {
    expect((await release('no-such-idea', 'skip')).status).toBe(409);
  });

  it('touches only the named idea', async () => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90), idea('bb-two', 80)]);
    await env.DB.prepare(`UPDATE ideas SET status = 'building', claimed_at = '2026-10-04T00:00:00.000Z'`).run();
    await release('aa-one', 'skip');
    expect((await row('bb-two'))!.status).toBe('building');
  });

  it.each([
    ['missing outcome', { slug: 'aa-one' }],
    ['unknown outcome', { slug: 'aa-one', outcome: 'built' }],
    ['outcome with other case', { slug: 'aa-one', outcome: 'Skip' }],
    ['missing slug', { outcome: 'skip' }],
    ['invalid slug', { slug: 'AA one', outcome: 'skip' }],
    ['array body', ['aa-one', 'skip']],
    ['not JSON', '{'],
  ])('returns 400 for %s and changes nothing', async (_n, body) => {
    await call('POST', '/api/agent/ideas', [idea('aa-one', 90)]);
    await claim();
    expect((await call('POST', '/api/agent/release', body)).status).toBe(400);
    expect((await row('aa-one'))!.status).toBe('building');
  });

  it('answers only POST', async () => {
    expect((await call('GET', '/api/agent/release')).status).toBe(404);
  });
});
