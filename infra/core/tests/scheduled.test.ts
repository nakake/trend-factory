import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import fixture from './fixtures/trends-jp.xml?raw';

afterEach(() => vi.restoreAllMocks());

describe('scheduled entry', () => {
  it('collects through scheduled()', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(fixture));
    await worker.scheduled(createScheduledController({ scheduledTime: new Date('2026-10-02T16:05:00Z') }), env);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM trends').first<{ n: number }>();
    expect(n!.n).toBeGreaterThan(0);
  });

  it('rejects (so the failure is visible) when collecting fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 503 }));
    await expect(
      worker.scheduled(createScheduledController({ scheduledTime: new Date('2026-10-02T16:05:00Z') }), env),
    ).rejects.toThrow('503');
    const run = await env.DB.prepare('SELECT result FROM runs').first();
    expect(run).toEqual({ result: 'failed' });
  });
});
