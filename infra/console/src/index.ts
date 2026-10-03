import { cachedJwks, readAccessConfig, verifyAccessJwt, type GetKeys } from './auth';
import { loadPageData } from './data';
import { renderPage } from './page';
import { CSS } from './style';

export interface Deps {
  // テストで JWKS の取得を差し替えるため。未指定なら certs エンドポイントを(キャッシュ付きで)読む
  getKeys?: GetKeys;
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

  let ok = false;
  try {
    const getKeys = deps.getKeys ?? cachedJwks(cfg.teamDomain);
    ok = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), cfg, getKeys);
  } catch (e) {
    // certs に届かないときも通さない
    console.error('access jwt verification failed', e);
  }
  if (!ok) return text('forbidden', 403);

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
