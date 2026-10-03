const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const PR_URL_RE = /^https:\/\/github\.com\/nakake\/trend-factory\/pull\/\d+$/;
const MAX_BODY_BYTES = 256 * 1024;
const BUILDING_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bad = (error: string | string[], status = 400) =>
  json({ error: Array.isArray(error) ? error : [error] }, status);

// 長さ非依存・定数時間で比較するため、ダイジェストにしてから timingSafeEqual を使う
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.AGENT_TOKEN) return false;
  const m = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  if (!m) return false;
  return tokenMatches(m[1], env.AGENT_TOKEN);
}

function intParam(url: URL, name: string, def: number, max: number): number {
  const n = Number.parseInt(url.searchParams.get(name) ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { ok: false, res: bad('body too large', 413) };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: bad('invalid JSON') };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

interface IdeaInput {
  slug: string;
  title: string;
  summary: string;
  sources: string[];
  scores: Record<string, number>;
  total: number;
}

function validateIdea(v: unknown, i: number): { idea?: IdeaInput; errors: string[] } {
  const errors: string[] = [];
  const p = `[${i}]`;
  if (!isObj(v)) return { errors: [`${p} must be an object`] };
  if (typeof v.slug !== 'string' || !SLUG_RE.test(v.slug)) errors.push(`${p}.slug invalid`);
  if (!isStr(v.title, 100)) errors.push(`${p}.title must be 1-100 chars`);
  if (!isStr(v.summary, 2000)) errors.push(`${p}.summary must be 1-2000 chars`);
  const sources = v.sources ?? [];
  if (!Array.isArray(sources) || sources.length > 20 || !sources.every((s) => isStr(s, 500)))
    errors.push(`${p}.sources must be an array of up to 20 strings (<=500 chars)`);
  const scores = v.scores ?? {};
  if (
    !isObj(scores) ||
    Object.keys(scores).length > 20 ||
    !Object.values(scores).every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    errors.push(`${p}.scores must be an object of numbers`);
  if (typeof v.total !== 'number' || !Number.isFinite(v.total) || v.total < 0 || v.total > 100)
    errors.push(`${p}.total must be a number 0-100`);
  if (errors.length) return { errors };
  return {
    errors,
    idea: {
      slug: v.slug as string,
      title: v.title as string,
      summary: v.summary as string,
      sources: sources as string[],
      scores: scores as Record<string, number>,
      total: v.total as number,
    },
  };
}

function parseIdeaRow(r: Record<string, unknown>) {
  const { sources_json, scores_json, ...rest } = r;
  return {
    ...rest,
    sources: JSON.parse(String(sources_json)),
    scores: JSON.parse(String(scores_json)),
  };
}

async function getTrends(url: URL, env: Env) {
  const hours = intParam(url, 'hours', 24, 168);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT term, day_jst, traffic, news_json, first_seen, last_seen FROM trends
     WHERE last_seen >= ? ORDER BY traffic DESC, last_seen DESC LIMIT 1000`,
  )
    .bind(since)
    .all<Record<string, unknown>>();
  return json({
    trends: results.map(({ news_json, ...r }) => ({ ...r, news: JSON.parse(String(news_json)) })),
  });
}

async function getIdeas(url: URL, env: Env) {
  const days = intParam(url, 'days', 60, 400);
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT slug, title, status, total, created_at FROM ideas WHERE created_at >= ? ORDER BY created_at DESC LIMIT 2000`,
  )
    .bind(since)
    .all();
  return json({ ideas: results });
}

async function postIdeas(request: Request, env: Env) {
  const body = await readJson(request);
  if (!body.ok) return body.res;
  if (!Array.isArray(body.value) || body.value.length < 1 || body.value.length > 20)
    return bad('body must be an array of 1-20 ideas');
  const ideas: IdeaInput[] = [];
  const errors: string[] = [];
  body.value.forEach((v, i) => {
    const r = validateIdea(v, i);
    errors.push(...r.errors);
    if (r.idea) ideas.push(r.idea);
  });
  if (errors.length) return bad(errors);

  const now = new Date().toISOString();
  const results = await env.DB.batch(
    ideas.map((it) =>
      env.DB.prepare(
        `INSERT INTO ideas (slug, title, summary, sources_json, scores_json, total, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'candidate', ?) ON CONFLICT (slug) DO NOTHING`,
      ).bind(it.slug, it.title, it.summary, JSON.stringify(it.sources), JSON.stringify(it.scores), it.total, now),
    ),
  );
  const inserted: string[] = [];
  const skipped: string[] = [];
  results.forEach((r, i) => (r.meta.changes > 0 ? inserted : skipped).push(ideas[i].slug));
  return json({ inserted, skipped }, inserted.length ? 201 : 409);
}

async function postClaim(env: Env) {
  const cutoff = new Date(Date.now() - BUILDING_TIMEOUT_MS).toISOString();
  const now = new Date().toISOString();
  // 戻しと取得を 1 batch にして、間に別のリクエストが割り込まないようにする
  const [, claimed] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ideas SET status = 'candidate', claimed_at = NULL WHERE status = 'building' AND claimed_at < ?`,
    ).bind(cutoff),
    env.DB.prepare(
      `UPDATE ideas SET status = 'building', claimed_at = ?1
       WHERE id = (
         SELECT id FROM ideas
         WHERE status = 'candidate'
           AND total >= COALESCE((SELECT CAST(value AS REAL) FROM settings WHERE key = 'min_score'), 60)
         ORDER BY total DESC, created_at ASC, id ASC LIMIT 1
       ) AND status = 'candidate'
       RETURNING *`,
    ).bind(now),
  ]);
  const row = claimed.results[0] as Record<string, unknown> | undefined;
  if (!row) return new Response(null, { status: 204 });
  return json({ idea: parseIdeaRow(row) });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function postBuilds(request: Request, env: Env) {
  const body = await readJson(request);
  if (!body.ok) return body.res;
  const v = body.value;
  if (!isObj(v)) return bad('body must be an object');
  const { slug, preview_url, pr_url } = v;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return bad('slug invalid');
  const previewRe = new RegExp(`^https://${escapeRe(slug)}-preview\\.${escapeRe(env.PREVIEW_SUFFIX)}/?$`);
  if (typeof preview_url !== 'string' || !previewRe.test(preview_url)) return bad('preview_url invalid');
  if (typeof pr_url !== 'string' || !PR_URL_RE.test(pr_url)) return bad('pr_url invalid');

  const now = new Date().toISOString();
  // builds への挿入を先にして building の案があるときだけ入れ、同じ batch で built にする
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO builds (slug, preview_url, pr_url, created_at)
       SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM ideas WHERE slug = ?1 AND status = 'building')`,
    ).bind(slug, preview_url, pr_url, now),
    env.DB.prepare(`UPDATE ideas SET status = 'built' WHERE slug = ? AND status = 'building'`).bind(slug),
  ]);
  if (ins.meta.changes < 1) return bad('idea is not in building state', 409);
  return json({ ok: true }, 201);
}

const RUN_KINDS = ['ideas', 'build'];
const RUN_RESULTS = ['started', 'ok', 'failed', 'noop'];

async function postRuns(request: Request, env: Env) {
  const body = await readJson(request);
  if (!body.ok) return body.res;
  const v = body.value;
  if (!isObj(v)) return bad('body must be an object');
  const { kind, result, id } = v;
  const note = v.note ?? null;
  if (typeof kind !== 'string' || !RUN_KINDS.includes(kind)) return bad('kind invalid');
  if (typeof result !== 'string' || !RUN_RESULTS.includes(result)) return bad('result invalid');
  if (note !== null && (typeof note !== 'string' || note.length > 1000)) return bad('note must be <=1000 chars');
  const now = new Date().toISOString();

  if (id === undefined) {
    const finished = result === 'started' ? null : now;
    const r = await env.DB.prepare(
      `INSERT INTO runs (kind, started_at, finished_at, result, note) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(kind, now, finished, result, note)
      .first<{ id: number }>();
    return json({ id: r!.id }, 201);
  }
  if (!Number.isInteger(id) || result === 'started') return bad('id invalid or result must not be started');
  // started のままの行だけ更新対象にして、終了済みの記録を書き換えられないようにする
  const r = await env.DB.prepare(
    `UPDATE runs SET result = ?, note = ?, finished_at = ? WHERE id = ? AND kind = ? AND result = 'started'`,
  )
    .bind(result, note, now, id, kind)
    .run();
  if (r.meta.changes < 1) return bad('run not found or already finished', 409);
  return json({ id });
}

export async function handleAgent(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/agent/')) return new Response('Not Found', { status: 404 });
  if (!(await isAuthorized(request, env))) {
    return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  }
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  switch (route) {
    case 'GET /api/agent/trends':
      return getTrends(url, env);
    case 'GET /api/agent/ideas':
      return getIdeas(url, env);
    case 'POST /api/agent/ideas':
      return postIdeas(request, env);
    case 'POST /api/agent/claim':
      return postClaim(env);
    case 'POST /api/agent/builds':
      return postBuilds(request, env);
    case 'POST /api/agent/runs':
      return postRuns(request, env);
    default:
      return new Response('Not Found', { status: 404 });
  }
}
