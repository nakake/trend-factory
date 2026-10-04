import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedJwks, readAccessConfig, resetJwksCache } from '../src/auth';
import { handle } from '../src/index';
import { b64url, goodClaims, makeKey, request, sign, type TestKey } from './helpers';

let key: TestKey;
let other: TestKey;
beforeAll(async () => {
  key = await makeKey('k1');
  other = await makeKey('k1');
});

beforeEach(resetJwksCache);
afterEach(() => vi.restoreAllMocks());

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
    const p = b64url(JSON.stringify(goodClaims({ email: 'evil@example.com' })));
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

const nowSec = () => Math.floor(Date.now() / 1000);

describe('claims edge cases', () => {
  it('tolerates nbf up to 60 seconds ahead but not beyond; exp stays strict', async () => {
    expect((await get({ key, claims: goodClaims({ nbf: nowSec() + 30 }) })).status).toBe(200);
    expect((await get({ key, claims: goodClaims({ nbf: nowSec() + 120 }) })).status).toBe(403);
    expect((await get({ key, claims: goodClaims({ nbf: 'x' }) })).status).toBe(403);
    expect((await get({ key, claims: goodClaims({ exp: nowSec() - 1 }) })).status).toBe(403);
  });
  it('compares email case-insensitively and trims the configured vars', async () => {
    expect((await get({ key, claims: goodClaims({ email: 'ME@EXAMPLE.COM' }) })).status).toBe(200);
    const e = { ALLOWED_EMAIL: '  Me@Example.com ', ACCESS_AUD: ' test-aud ', ACCESS_TEAM_DOMAIN: ' Test-Team.CloudflareAccess.com ' };
    expect((await get({ key, env: e })).status).toBe(200);
  });
  it('rejects HS256 even if the signature part is well formed', async () => {
    expect((await get({ key, jwt: await sign(key, goodClaims(), { alg: 'HS256' }) })).status).toBe(403);
  });
});

describe('JWKS contents', () => {
  it('re-fetches on an unknown kid (key rotation) and then accepts', async () => {
    const rotated = await makeKey('k2');
    const calls: boolean[] = [];
    const res = await get({ key: rotated, served: [key.jwk], afterRefresh: [key.jwk, rotated.jwk], calls });
    expect(res.status).toBe(200);
    expect(calls).toEqual([false, true]);
  });
  it('rejects a JWK that is not RSA, has no n, or is null', async () => {
    for (const bad of [{ ...key.jwk, kty: 'EC' }, { kty: 'RSA', kid: 'k1', e: key.jwk.e }, null]) {
      const r = await get({ key, served: [bad as never] });
      expect(r.status).toBe(403);
    }
  });
  it('ignores null entries next to a valid key', async () => {
    expect((await get({ key, served: [null as never, key.jwk] })).status).toBe(200);
  });
});

describe('production wiring (cachedJwks + fetch through index.ts)', () => {
  const ask = (fetchFn: typeof fetch, jwt: string) =>
    handle(new Request('https://console.example/', { headers: { 'cf-access-jwt-assertion': jwt } }), env, { fetchFn });

  it('reads the certs URL once and serves later requests from the cache', async () => {
    const f = vi.fn(async (_u: string | URL | Request) => Response.json({ keys: [key.jwk] }));
    const jwt = await sign(key, goodClaims());
    expect((await ask(f as unknown as typeof fetch, jwt)).status).toBe(200);
    expect((await ask(f as unknown as typeof fetch, jwt)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('https://test-team.cloudflareaccess.com/cdn-cgi/access/certs');
  });
  it('is 403 when certs is non-200 or has no keys', async () => {
    const jwt = await sign(key, goodClaims());
    const non200 = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect((await ask(non200, jwt)).status).toBe(403);
    resetJwksCache();
    const noKeys = (async () => Response.json({})) as unknown as typeof fetch;
    expect((await ask(noKeys, jwt)).status).toBe(403);
  });
  it('logs only the reason on 403', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const jwt = await sign(key, goodClaims({ email: 'secret-person@example.com' }));
    await request('GET', '/', { key, jwt });
    expect(warn).toHaveBeenCalledWith('access denied: email-mismatch');
    const all = JSON.stringify(warn.mock.calls);
    expect(all).not.toContain('secret-person');
    expect(all).not.toContain(jwt);
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
  it('rejects a team domain that is not <name>.cloudflareaccess.com', async () => {
    for (const d of ['evil.com/x?', 'evil.com', 'x.cloudflareaccess.com.evil.com', 'a.b.cloudflareaccess.com', '.cloudflareaccess.com']) {
      expect((await get({ key, env: { ACCESS_TEAM_DOMAIN: d } })).status).toBe(503);
    }
  });
  it('normalizes the config', () => {
    expect(readAccessConfig({ ...env, ALLOWED_EMAIL: ' A@B.c ' } as Env)).toMatchObject({ email: 'a@b.c' });
  });
});

describe('JWKS cache', () => {
  const okFetch = (keys: unknown) => vi.fn(async (_u: string) => Response.json({ keys }));
  const as = (f: unknown) => f as unknown as typeof fetch;

  it('fetches certs once within the TTL and refetches on an unknown kid only after a minute', async () => {
    let t = 1_000_000;
    const f = okFetch([key.jwk]);
    const getKeys = cachedJwks('t.cloudflareaccess.com', as(f), () => t);
    await getKeys(false);
    await getKeys(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe('https://t.cloudflareaccess.com/cdn-cgi/access/certs');
    await getKeys(true);
    expect(f).toHaveBeenCalledTimes(1);
    t += 61_000;
    await getKeys(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('refetches after the TTL', async () => {
    let t = 0;
    const f = okFetch([key.jwk]);
    const getKeys = cachedJwks('t.cloudflareaccess.com', as(f), () => t);
    await getKeys(false);
    t += 11 * 60_000;
    await getKeys(false);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('does not reuse the cache when the team domain changes', async () => {
    const f = okFetch([key.jwk]);
    await cachedJwks('a.cloudflareaccess.com', as(f))(false);
    await cachedJwks('b.cloudflareaccess.com', as(f))(false);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      'https://a.cloudflareaccess.com/cdn-cgi/access/certs',
      'https://b.cloudflareaccess.com/cdn-cgi/access/certs',
    ]);
  });
  it('keeps using the old keys when a refetch fails, and retries after a minute', async () => {
    let t = 0;
    let fail = false;
    const f = vi.fn(async (_u: string) => (fail ? new Response('x', { status: 503 }) : Response.json({ keys: [key.jwk] })));
    const getKeys = cachedJwks('t.cloudflareaccess.com', as(f), () => t);
    await getKeys(false);
    fail = true;
    t += 11 * 60_000;
    expect(await getKeys(false)).toEqual([key.jwk]);
    expect(f).toHaveBeenCalledTimes(2);
    t += 30_000;
    expect(await getKeys(false)).toEqual([key.jwk]);
    expect(f).toHaveBeenCalledTimes(2);
    t += 31_000;
    await getKeys(false);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('does not overwrite good keys with an empty or key-less response', async () => {
    let t = 0;
    let body: unknown = { keys: [key.jwk] };
    const f = vi.fn(async (_u: string) => Response.json(body));
    const getKeys = cachedJwks('t.cloudflareaccess.com', as(f), () => t);
    await getKeys(false);
    for (const b of [{ keys: [] }, {}, { keys: [null] }]) {
      body = b;
      t += 11 * 60_000;
      expect(await getKeys(false)).toEqual([key.jwk]);
    }
  });
  it('throws without cache when certs is unavailable, without hammering it', async () => {
    let t = 0;
    const f = vi.fn(async (_u: string) => new Response('x', { status: 500 }));
    const getKeys = cachedJwks('t.cloudflareaccess.com', as(f), () => t);
    await expect(getKeys(false)).rejects.toThrow();
    await expect(getKeys(false)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
    t += 61_000;
    await expect(getKeys(false)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('shares one in-flight request between concurrent callers', async () => {
    const f = okFetch([key.jwk]);
    const getKeys = cachedJwks('t.cloudflareaccess.com', as(f));
    await Promise.all([getKeys(false), getKeys(false), getKeys(true)]);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
