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

const SCORE_MAX = { need: 30, demand: 25, fit: 25, novelty: 10, longevity: 10 };

// 合計が total になる内訳を、上限の範囲で前から詰めて作る
export function scoresFor(total: number): Record<string, number> {
  let rest = total;
  const out: Record<string, number> = {};
  for (const [k, max] of Object.entries(SCORE_MAX)) {
    out[k] = Math.max(0, Math.min(max, rest));
    rest -= out[k];
  }
  return out;
}

export const HN = 'https://news.ycombinator.com/item?id=1';

export const idea = (slug: string, total = 80, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `title ${slug}`,
  summary: 'summary',
  sources: [HN],
  scores: scoresFor(total),
  total,
  ...extra,
});
