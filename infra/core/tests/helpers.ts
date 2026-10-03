import { env } from 'cloudflare:workers';
import { handleAgent } from '../src/agent';

export function callWith(
  e: Env,
  method: string,
  path: string,
  body?: unknown,
  token: string | null = 'test-token',
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return handleAgent(
    new Request(`https://agent.example${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    e,
  );
}

export const call = (method: string, path: string, body?: unknown, token: string | null = 'test-token') =>
  callWith(env, method, path, body, token);

// env を直接書き換えず、一部の値だけ差し替えた env を作る
export const envWith = (over: Partial<Env>): Env => ({ ...env, ...over }) as Env;

export const idea = (slug: string, total = 80, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `title ${slug}`,
  summary: 'summary',
  sources: ['https://example.com'],
  scores: { need: 20, effort: 20 },
  total,
  ...extra,
});
