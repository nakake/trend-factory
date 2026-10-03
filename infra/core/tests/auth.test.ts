import { describe, expect, it } from 'vitest';
import { call } from './helpers';

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
  it('returns 404 outside /api/agent/ even without a token', async () => {
    expect((await call('GET', '/', undefined, null)).status).toBe(404);
    expect((await call('GET', '/api/other', undefined, null)).status).toBe(404);
  });
  it('returns 404 for unknown agent routes', async () => {
    expect((await call('GET', '/api/agent/unknown')).status).toBe(404);
  });
});
