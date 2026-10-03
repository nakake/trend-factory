import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { cachedJwks, resetJwksCache } from '../src/auth';
import { goodClaims, makeKey, request, sign, type TestKey } from './helpers';

let key: TestKey;
let other: TestKey;
beforeAll(async () => {
  key = await makeKey('k1');
  other = await makeKey('k1');
});

const get = (o: Parameters<typeof request>[2]) => request('GET', '/', o);

describe('Access JWT verification', () => {
  it('accepts a valid token', async () => {
    expect((await get({ key })).status).toBe(200);
  });
  it('accepts aud given as a plain string', async () => {
    expect((await get({ key, claims: goodClaims({ aud: env.ACCESS_AUD }) })).status).toBe(200);
  });
  it('rejects a missing header', async () => {
    expect((await get({ key, jwt: null })).status).toBe(403);
  });
  it('rejects garbage', async () => {
    for (const jwt of ['', 'a.b', 'a.b.c', 'x.y.z.w']) expect((await get({ key, jwt })).status).toBe(403);
  });
  it('rejects a signature made by another key with the same kid', async () => {
    expect((await get({ key, jwt: await sign(other, goodClaims()) })).status).toBe(403);
  });
  it('rejects an unknown kid', async () => {
    const stranger = await makeKey('zzz');
    expect((await get({ key, jwt: await sign(stranger, goodClaims()) })).status).toBe(403);
  });
  it('rejects a tampered payload', async () => {
    const [h, , s] = (await sign(key, goodClaims())).split('.');
    const p = btoa(JSON.stringify(goodClaims({ email: 'evil@example.com' }))).replace(/=+$/, '');
    expect((await get({ key, jwt: `${h}.${p}.${s}` })).status).toBe(403);
  });
  it('rejects a wrong aud', async () => {
    expect((await get({ key, claims: goodClaims({ aud: ['other'] }) })).status).toBe(403);
    expect((await get({ key, claims: goodClaims({ aud: undefined }) })).status).toBe(403);
  });
  it('rejects a wrong iss', async () => {
    expect((await get({ key, claims: goodClaims({ iss: 'https://evil.cloudflareaccess.com' }) })).status).toBe(403);
  });
  it('rejects an expired or exp-less token', async () => {
    expect((await get({ key, claims: goodClaims({ exp: Math.floor(Date.now() / 1000) - 10 }) })).status).toBe(403);
    expect((await get({ key, claims: goodClaims({ exp: undefined }) })).status).toBe(403);
  });
  it('rejects a wrong or missing email', async () => {
    expect((await get({ key, claims: goodClaims({ email: 'someone@example.com' }) })).status).toBe(403);
    expect((await get({ key, claims: goodClaims({ email: undefined }) })).status).toBe(403);
  });
  it('rejects alg other than RS256', async () => {
    expect((await get({ key, jwt: await sign(key, goodClaims(), { alg: 'none' }) })).status).toBe(403);
  });
  it('is 403 when the JWKS cannot be fetched', async () => {
    const { handle } = await import('../src/index');
    const jwt = await sign(key, goodClaims());
    const res = await handle(new Request('https://console.example/', { headers: { 'cf-access-jwt-assertion': jwt } }), env, {
      getKeys: async () => {
        throw new Error('down');
      },
    });
    expect(res.status).toBe(403);
  });
  it('protects /style.css too', async () => {
    expect((await request('GET', '/style.css', { key, jwt: null })).status).toBe(403);
    expect((await request('GET', '/style.css', { key })).status).toBe(200);
  });
});

describe('unconfigured vars give 503 for every request', () => {
  for (const name of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'ALLOWED_EMAIL'] as const) {
    for (const v of ['REPLACE-ME', '', undefined]) {
      it(`${name}=${JSON.stringify(v)}`, async () => {
        const e = { [name]: v } as Partial<Env>;
        expect((await get({ key, env: e })).status).toBe(503);
        expect((await get({ key, jwt: null, env: e })).status).toBe(503);
      });
    }
  }
  it('rejects a team domain that is not a plain hostname', async () => {
    expect((await get({ key, env: { ACCESS_TEAM_DOMAIN: 'evil.com/x?' } })).status).toBe(503);
  });
});

describe('JWKS cache', () => {
  it('fetches certs once within the TTL and refetches on an unknown kid after a minute', async () => {
    resetJwksCache();
    let t = 1_000_000;
    const f = vi.fn(async (_url: string) => Response.json({ keys: [key.jwk] }));
    const getKeys = cachedJwks('t.cloudflareaccess.com', f as unknown as typeof fetch, () => t);
    await getKeys(false);
    await getKeys(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('https://t.cloudflareaccess.com/cdn-cgi/access/certs');
    await getKeys(true);
    expect(f).toHaveBeenCalledTimes(1);
    t += 61_000;
    await getKeys(true);
    expect(f).toHaveBeenCalledTimes(2);
    resetJwksCache();
  });
});
