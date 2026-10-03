import { env } from 'cloudflare:workers';
import { handleAgent } from '../src/agent';

export function call(method: string, path: string, body?: unknown, token: string | null = 'test-token') {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return handleAgent(
    new Request(`https://agent.example${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

export const idea = (slug: string, total = 80, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `title ${slug}`,
  summary: 'summary',
  sources: ['https://example.com'],
  scores: { need: 20, effort: 20 },
  total,
  ...extra,
});
