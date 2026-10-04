export interface AccessConfig {
  teamDomain: string;
  aud: string;
  email: string;
}

export type Jwk = JsonWebKey & { kid?: string };

const isUnset = (v: unknown): v is undefined | '' =>
  typeof v !== 'string' || v.trim() === '' || v.includes('REPLACE-ME');

// 未設定のまま動くと「検証する相手がいない」状態になるので、読めない設定は null にして呼び出し側で 503 にする。
// team domain を cloudflareaccess.com 配下に絞るのは、設定ミスや差し替えで任意のホストの鍵を信用しないため
export function readAccessConfig(env: Env): AccessConfig | null {
  if (isUnset(env.ACCESS_TEAM_DOMAIN) || isUnset(env.ACCESS_AUD) || isUnset(env.ALLOWED_EMAIL)) return null;
  const teamDomain = env.ACCESS_TEAM_DOMAIN.trim().toLowerCase();
  const email = env.ALLOWED_EMAIL.trim().toLowerCase();
  const aud = env.ACCESS_AUD.trim();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain) || !email || !aud) return null;
  return { teamDomain, aud, email };
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

// 理由はログ用の種類だけ。トークンや claim の値は含めない
export type VerifyResult = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): VerifyResult => ({ ok: false, reason });

// nbf だけ許容する。Access 側と時計が数秒ずれても締め出さないため(exp は厳密)
const NBF_SKEW_SEC = 60;

const isRsaKey = (k: unknown): k is Jwk =>
  !!k && typeof k === 'object' && (k as Jwk).kty === 'RSA' && typeof (k as Jwk).n === 'string' && typeof (k as Jwk).e === 'string';

export async function verifyAccessJwt(
  token: string | null,
  cfg: AccessConfig,
  getKeys: GetKeys,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!token) return fail('no-token');
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return fail('malformed');
  const header = parsePart(parts[0]);
  const payload = parsePart(parts[1]);
  if (!header || !payload) return fail('malformed');
  // alg を固定するのは、ヘッダー側の alg=none や HS256 への差し替えを受け付けないため
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return fail('bad-alg-or-kid');

  const find = async (refresh: boolean) =>
    (await getKeys(refresh)).find((k) => !!k && typeof k === 'object' && k.kid === header.kid);
  const key = (await find(false)) ?? (await find(true));
  if (!key) return fail('unknown-kid');
  if (!isRsaKey(key)) return fail('bad-key');

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
    return fail('bad-key');
  }
  if (!ok) return fail('bad-signature');

  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return fail('expired');
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > nowSec + NBF_SKEW_SEC)) return fail('not-yet-valid');
  if (payload.iss !== `https://${cfg.teamDomain}`) return fail('iss-mismatch');
  const aud = payload.aud;
  if (!(aud === cfg.aud || (Array.isArray(aud) && aud.includes(cfg.aud)))) return fail('aud-mismatch');
  if (typeof payload.email !== 'string' || payload.email.trim().toLowerCase() !== cfg.email) return fail('email-mismatch');
  return { ok: true };
}

const JWKS_TTL_MS = 10 * 60_000;
// certs への試行(成功・失敗とも)の最小間隔。未知の kid を送り続けられても、certs が落ちていても、問い合わせは 1 分に 1 回
const JWKS_MIN_RETRY_MS = 60_000;

interface JwksState {
  team: string;
  keys: Jwk[] | null;
  at: number;
  lastAttempt: number;
}
let state: JwksState | null = null;
let inflight: { team: string; p: Promise<Jwk[]> } | null = null;

async function loadJwks(team: string, fetchFn: typeof fetch, now: () => number): Promise<Jwk[]> {
  const t = now();
  const prev = state && state.team === team ? state : null;
  try {
    const res = await fetchFn(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: unknown };
    const keys = Array.isArray(body?.keys) ? (body.keys as unknown[]).filter((k): k is Jwk => !!k && typeof k === 'object') : [];
    // 空の応答で有効な鍵を捨てると、Access 側の一時的な不具合で全員が締め出される
    if (keys.length === 0) throw new Error('certs has no keys');
    state = { team, keys, at: t, lastAttempt: t };
    return keys;
  } catch (e) {
    state = { team, keys: prev?.keys ?? null, at: prev?.at ?? 0, lastAttempt: t };
    if (prev?.keys) return prev.keys;
    throw e;
  }
}

export function cachedJwks(teamDomain: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now): GetKeys {
  return async (refresh) => {
    const c = state && state.team === teamDomain ? state : null;
    if (c) {
      if (now() - c.lastAttempt < JWKS_MIN_RETRY_MS) {
        if (c.keys) return c.keys;
        throw new Error('certs unavailable (retry later)');
      }
      if (c.keys && !refresh && now() - c.at < JWKS_TTL_MS) return c.keys;
    }
    if (!inflight || inflight.team !== teamDomain) {
      const p = loadJwks(teamDomain, fetchFn, now).finally(() => {
        if (inflight?.p === p) inflight = null;
      });
      inflight = { team: teamDomain, p };
    }
    return inflight.p;
  };
}

export function resetJwksCache() {
  state = null;
  inflight = null;
}
