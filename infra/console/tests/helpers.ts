import { env } from 'cloudflare:workers';
import { handle } from '../src/index';
import type { Jwk } from '../src/auth';

export const b64url = (b: ArrayBuffer | string) => {
  const bytes = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };

export async function makeKey(kid: string) {
  const pair = (await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk;
  return { kid, priv: pair.privateKey, jwk: { ...jwk, kid } as Jwk };
}

export type TestKey = Awaited<ReturnType<typeof makeKey>>;

export async function sign(key: TestKey, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.priv, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

export const goodClaims = (over: Record<string, unknown> = {}) => ({
  iss: `https://${env.ACCESS_TEAM_DOMAIN}`,
  aud: [env.ACCESS_AUD],
  email: env.ALLOWED_EMAIL,
  exp: Math.floor(Date.now() / 1000) + 600,
  ...over,
});

export async function request(
  method: string,
  path: string,
  opts: {
    key: TestKey;
    jwt?: string | null;
    claims?: Record<string, unknown>;
    env?: Partial<Env>;
    served?: Jwk[];
    // refresh=true で呼ばれたときに返す鍵(鍵のローテーション直後を再現する)
    afterRefresh?: Jwk[];
    calls?: boolean[];
  },
) {
  const jwt = opts.jwt === undefined ? await sign(opts.key, opts.claims ?? goodClaims()) : opts.jwt;
  const headers: Record<string, string> = {};
  if (jwt !== null) headers['cf-access-jwt-assertion'] = jwt;
  const served = opts.served ?? [opts.key.jwk];
  return handle(new Request(`https://console.example${path}`, { method, headers }), { ...env, ...opts.env } as Env, {
    getKeys: async (refresh) => {
      opts.calls?.push(refresh);
      return refresh && opts.afterRefresh ? opts.afterRefresh : served;
    },
  });
}
