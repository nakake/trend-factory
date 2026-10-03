import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { call, callWith, envWith } from './helpers';

describe('auth and routing', () => {
  it('rejects a missing token', async () => {
    expect((await call('GET', '/api/agent/ideas', undefined, null)).status).toBe(401);
  });
  it('rejects a wrong token', async () => {
    expect((await call('GET', '/api/agent/ideas', undefined, 'nope')).status).toBe(401);
  });
  it('accepts the right token', async () => {
    expect((await call('GET', '/api/agent/ideas')).status).toBe(200);
  });
  it('returns 401 when AGENT_TOKEN is empty or undefined, even for an empty bearer', async () => {
    for (const t of ['', undefined]) {
      const e = envWith({ AGENT_TOKEN: t as unknown as string });
      expect((await callWith(e, 'GET', '/api/agent/ideas', undefined, '')).status).toBe(401);
      expect((await callWith(e, 'GET', '/api/agent/ideas', undefined, 'x')).status).toBe(401);
      expect((await callWith(e, 'GET', '/api/agent/ideas', undefined, null)).status).toBe(401);
    }
  });
  it('returns 404 outside /api/agent/ even without a token', async () => {
    expect((await call('GET', '/', undefined, null)).status).toBe(404);
    expect((await call('GET', '/api/other', undefined, null)).status).toBe(404);
  });
  it('returns 404 for unknown routes and paths with repeated slashes', async () => {
    expect((await call('GET', '/api/agent/unknown')).status).toBe(404);
    expect((await call('GET', '/api/agent//ideas')).status).toBe(404);
    expect((await call('GET', '/api/agent/ideas//')).status).toBe(404);
  });
  it('accepts one trailing slash', async () => {
    expect((await call('GET', '/api/agent/ideas/')).status).toBe(200);
  });
  it('returns a JSON 500 without details when a handler throws', async () => {
    const broken = { ...envWith({}), DB: {} } as unknown as Env;
    const res = await callWith(broken, 'GET', '/api/agent/ideas');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: ['internal error'] });
  });
});

describe('through the worker entry (src/index.ts)', () => {
  it('serves fetch', async () => {
    const res = await SELF.fetch('https://agent.example/api/agent/ideas', {
      headers: { authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    expect((await SELF.fetch('https://agent.example/api/agent/ideas')).status).toBe(401);
    expect((await SELF.fetch('https://agent.example/')).status).toBe(404);
  });
});
