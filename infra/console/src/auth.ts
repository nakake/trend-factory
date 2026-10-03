export interface AccessConfig {
  teamDomain: string;
  aud: string;
  email: string;
}

export type Jwk = JsonWebKey & { kid?: string };

const isUnset = (v: unknown): v is undefined | '' =>
  typeof v !== 'string' || v.trim() === '' || v.includes('REPLACE-ME');

// 未設定のまま動くと「検証する相手がいない」状態になるので、読めない設定は null にして呼び出し側で 503 にする
export function readAccessConfig(env: Env): AccessConfig | null {
  if (isUnset(env.ACCESS_TEAM_DOMAIN) || isUnset(env.ACCESS_AUD) || isUnset(env.ALLOWED_EMAIL)) return null;
  // URL に埋め込むので、ホスト名として素直な文字だけを許す
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(env.ACCESS_TEAM_DOMAIN)) return null;
  return { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, email: env.ALLOWED_EMAIL };
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function parsePart(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// getKeys(true) はキャッシュを捨てて取り直す。鍵のローテーション直後に kid が見つからないときだけ使う
export type GetKeys = (refresh: boolean) => Promise<Jwk[]>;

export async function verifyAccessJwt(
  token: string | null,
  cfg: AccessConfig,
  getKeys: GetKeys,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return false;
  const header = parsePart(parts[0]);
  const payload = parsePart(parts[1]);
  if (!header || !payload) return false;
  // alg を固定するのは、ヘッダー側の alg=none や HS256 への差し替えを受け付けないため
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false;

  let key = (await getKeys(false)).find((k) => k.kid === header.kid);
  if (!key) key = (await getKeys(true)).find((k) => k.kid === header.kid);
  if (!key || key.kty !== 'RSA') return false;

  let ok = false;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      { kty: key.kty, n: key.n, e: key.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
  if (!ok) return false;

  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return false;
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > nowSec)) return false;
  if (payload.iss !== `https://${cfg.teamDomain}`) return false;
  const aud = payload.aud;
  if (!(aud === cfg.aud || (Array.isArray(aud) && aud.includes(cfg.aud)))) return false;
  return typeof payload.email === 'string' && payload.email.toLowerCase() === cfg.email.toLowerCase();
}

const JWKS_TTL_MS = 10 * 60_000;
// 未知の kid で毎回取りにいかないための間隔(攻撃者が偽の kid を送り続けても certs への問い合わせは増えない)
const JWKS_MIN_REFRESH_MS = 60_000;
let cache: { team: string; keys: Jwk[]; at: number } | null = null;

export function cachedJwks(teamDomain: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now): GetKeys {
  return async (refresh) => {
    const age = cache && cache.team === teamDomain ? now() - cache.at : Infinity;
    if (cache && cache.team === teamDomain && age < (refresh ? JWKS_MIN_REFRESH_MS : JWKS_TTL_MS)) return cache.keys;
    const res = await fetchFn(`https://${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    cache = { team: teamDomain, keys, at: now() };
    return keys;
  };
}

export function resetJwksCache() {
  cache = null;
}
