import { cachedJwks, readAccessConfig, verifyAccessJwt, type GetKeys } from './auth';
import { loadPageData } from './data';
import { renderPage } from './page';
import { CSS } from './style';

export interface Deps {
  // テストで JWKS の取得を差し替えるため。未指定なら certs エンドポイントを(キャッシュ付きで)読む
  getKeys?: GetKeys;
  // getKeys を渡さない本番の配線(cachedJwks 経由)をテストするため
  fetchFn?: typeof fetch;
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy':
    "default-src 'none'; style-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

const respond = (body: string, status: number, type: string, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': type, ...SECURITY_HEADERS, ...extra } });
const text = (body: string, status: number, extra?: Record<string, string>) =>
  respond(body, status, 'text/plain; charset=utf-8', extra);

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return text('method not allowed', 405, { allow: 'GET, HEAD' });

  const cfg = readAccessConfig(env);
  if (!cfg) return text('console is not configured', 503);

  let reason: string | null;
  try {
    const getKeys = deps.getKeys ?? cachedJwks(cfg.teamDomain, deps.fetchFn);
    const r = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), cfg, getKeys);
    reason = r.ok ? null : r.reason;
  } catch (e) {
    // certs に届かないときも通さない
    reason = 'jwks-unavailable';
    console.error('jwks error', e instanceof Error ? e.message : 'unknown');
  }
  if (reason) {
    console.warn(`access denied: ${reason}`);
    return text('forbidden', 403);
  }

  const path = new URL(request.url).pathname;
  try {
    if (path === '/style.css') return respond(CSS, 200, 'text/css; charset=utf-8');
    if (path === '/') return respond(renderPage(await loadPageData(env), env.PREVIEW_SUFFIX), 200, 'text/html; charset=utf-8');
  } catch (e) {
    console.error('render failed', e);
    return text('internal error', 500);
  }
  return text('not found', 404);
}

export default {
  fetch: (request, env) => handle(request, env),
} satisfies ExportedHandler<Env>;
