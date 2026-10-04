import { getMinScore } from './settings';

const SLUG_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const SCORE_KEY_RE = /^[a-z_]{1,30}$/;
const SOURCE_RE = /^https:\/\/\S+$/;
// 小物は別リポジトリ(routine に紐付ける唯一のリポジトリ)にある。このリポジトリの PR は AI が作れないので受け付けない
const PR_URL_RE = /^https:\/\/github\.com\/nakake\/trend-factory-tools\/pull\/\d{1,7}$/;
const MAX_BODY_BYTES = 256 * 1024;
const BUILDING_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const LIMIT_IDEAS_PER_DAY = 40;
const LIMIT_RUNS_PER_DAY = 60;
const LIMIT_BUILDS_PER_DAY = 5;

// 双方向制御文字とゼロ幅文字は、一覧ページで見た目と中身を食い違わせられるので制御文字と同じ扱いで弾く
const INVISIBLE = '\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff';
const CTL = new RegExp(`[\\u0000-\\u001f\\u007f${INVISIBLE}]`);
const CTL_EXCEPT_NL = new RegExp(`[\\u0000-\\u0009\\u000b-\\u001f\\u007f${INVISIBLE}]`);
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

const json = (data: unknown, status = 200) => Response.json(data, { status });
const bad = (error: string | string[], status = 400) =>
  json({ error: Array.isArray(error) ? error : [error] }, status);

// 長さ非依存・定数時間で比較するため、ダイジェストにしてから timingSafeEqual を使う
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
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
  const tooLarge = { ok: false as const, res: bad('body too large', 413) };
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) return tooLarge;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES || bytes(text) > MAX_BODY_BYTES) return tooLarge;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: bad('invalid JSON') };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface StrRule {
  maxChars: number;
  maxBytes: number;
  allowNewline?: boolean;
}

function strError(v: unknown, name: string, r: StrRule): string | null {
  if (typeof v !== 'string' || v.length === 0) return `${name} must be a non-empty string`;
  if (v.length > r.maxChars || bytes(v) > r.maxBytes) return `${name} is too long (max ${r.maxChars} chars / ${r.maxBytes} bytes)`;
  if ((r.allowNewline ? CTL_EXCEPT_NL : CTL).test(v)) return `${name} contains control characters`;
  return null;
}

const TITLE: StrRule = { maxChars: 100, maxBytes: 300 };
const SUMMARY: StrRule = { maxChars: 2000, maxBytes: 6000, allowNewline: true };
const SOURCE: StrRule = { maxChars: 1500, maxBytes: 1500 };
const NOTE: StrRule = { maxChars: 1000, maxBytes: 3000, allowNewline: true };

interface IdeaInput {
  slug: string;
  title: string;
  summary: string;
  sources: string[];
  scores: Record<string, number>;
  total: number;
}

function validateIdea(v: unknown, i: number): { idea?: IdeaInput; errors: string[] } {
  const p = `[${i}]`;
  if (!isObj(v)) return { errors: [`${p} must be an object`] };
  const errors: string[] = [];
  const push = (e: string | null) => e && errors.push(e);
  if (typeof v.slug !== 'string' || !SLUG_RE.test(v.slug)) errors.push(`${p}.slug invalid`);
  push(strError(v.title, `${p}.title`, TITLE));
  push(strError(v.summary, `${p}.summary`, SUMMARY));

  const sources = v.sources ?? [];
  if (!Array.isArray(sources) || sources.length > 20) {
    errors.push(`${p}.sources must be an array of up to 20 strings`);
  } else {
    sources.forEach((s, j) => {
      push(strError(s, `${p}.sources[${j}]`, SOURCE));
      if (typeof s === 'string' && !SOURCE_RE.test(s)) errors.push(`${p}.sources[${j}] must be an https URL without whitespace`);
    });
  }

  const scores = v.scores ?? {};
  if (!isObj(scores) || Object.keys(scores).length > 10) {
    errors.push(`${p}.scores must be an object with up to 10 keys`);
  } else {
    for (const [k, n] of Object.entries(scores)) {
      if (!SCORE_KEY_RE.test(k)) errors.push(`${p}.scores key invalid: ${k.slice(0, 40)}`);
      if (typeof n !== 'number' || !Number.isFinite(n)) errors.push(`${p}.scores.${k.slice(0, 40)} must be a finite number`);
    }
  }
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

function safeParse(s: unknown, fallback: unknown): unknown {
  try {
    return JSON.parse(String(s));
  } catch {
    return fallback;
  }
}

function parseIdeaRow(r: Record<string, unknown>) {
  const { sources_json, scores_json, ...rest } = r;
  return { ...rest, sources: safeParse(sources_json, []), scores: safeParse(scores_json, {}) };
}

async function countSince(env: Env, table: 'ideas' | 'builds' | 'runs', col: string, since: string, where = '1'): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} >= ? AND ${where}`)
    .bind(since)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

async function getTrends(url: URL, env: Env) {
  const hours = intParam(url, 'hours', 24, 168);
  const limit = intParam(url, 'limit', 300, 500);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT term, day_jst, traffic, news_json, first_seen, last_seen FROM trends
     WHERE last_seen >= ? ORDER BY traffic DESC, last_seen DESC LIMIT ?`,
  )
    .bind(since, limit)
    .all<Record<string, unknown>>();
  return json({
    trends: results.map(({ news_json, ...r }) => {
      const news = safeParse(news_json, []);
      // routine の文脈を食わないよう、見出しだけを 3 本まで返す
      const titles = Array.isArray(news) ? news.slice(0, 3).map((n) => (isObj(n) ? n.title : null)) : [];
      return { ...r, news: titles.filter((t) => typeof t === 'string') };
    }),
  });
}

async function getIdeas(url: URL, env: Env) {
  const days = intParam(url, 'days', 60, 400);
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
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

  // 暴走したクライアントが D1 の書き込み上限(1 日 10 万行)を食い潰さないための歯止め
  const recent = await countSince(env, 'ideas', 'created_at', new Date(Date.now() - DAY_MS).toISOString());
  if (recent + ideas.length > LIMIT_IDEAS_PER_DAY) return bad('daily limit for ideas exceeded', 429);

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
  const nowMs = Date.now();
  const cutoff = new Date(nowMs - BUILDING_TIMEOUT_MS).toISOString();
  const now = new Date(nowMs).toISOString();
  const minScore = await getMinScore(env);
  // 戻しと取得を 1 batch にして、間に別のリクエストが割り込まないようにする。
  // building が 1 件でもあれば取らない(同時に走る実装を 1 本に絞る)
  const [, , claimed] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE ideas SET status = 'skipped', claimed_at = NULL
       WHERE status = 'building' AND claimed_at < ?1 AND attempts >= ?2`,
    ).bind(cutoff, MAX_ATTEMPTS),
    env.DB.prepare(
      `UPDATE ideas SET status = 'candidate', claimed_at = NULL WHERE status = 'building' AND claimed_at < ?`,
    ).bind(cutoff),
    env.DB.prepare(
      `UPDATE ideas SET status = 'building', claimed_at = ?1, attempts = attempts + 1
       WHERE id = (
         SELECT id FROM ideas WHERE status = 'candidate' AND total >= ?2
         ORDER BY total DESC, created_at ASC, id ASC LIMIT 1
       ) AND status = 'candidate'
         AND NOT EXISTS (SELECT 1 FROM ideas WHERE status = 'building')
       RETURNING *`,
    ).bind(now, minScore),
  ]);
  const row = claimed.results[0] as Record<string, unknown> | undefined;
  if (!row) return new Response(null, { status: 204 });
  return json({ idea: parseIdeaRow(row) });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isUniqueViolation = (e: unknown) => String(e instanceof Error ? e.message : e).includes('UNIQUE constraint failed');

async function postBuilds(request: Request, env: Env) {
  // 未設定のまま通すと、誰でも取れる workers.dev の名前を許す正規表現になりうる
  if (!env.PREVIEW_SUFFIX || env.PREVIEW_SUFFIX.includes('REPLACE-ME')) return bad('PREVIEW_SUFFIX is not configured', 503);
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
  if ((await countSince(env, 'builds', 'created_at', new Date(Date.now() - DAY_MS).toISOString())) >= LIMIT_BUILDS_PER_DAY)
    return bad('daily limit for builds exceeded', 429);

  try {
    // builds への挿入を先にして building の案があるときだけ入れ、同じ batch で built にする
    const [ins] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO builds (slug, preview_url, pr_url, created_at)
         SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM ideas WHERE slug = ?1 AND status = 'building')`,
      ).bind(slug, preview_url, pr_url, now),
      env.DB.prepare(`UPDATE ideas SET status = 'built' WHERE slug = ? AND status = 'building'`).bind(slug),
    ]);
    if (ins.meta.changes < 1) return bad('idea is not in building state', 409);
  } catch (e) {
    if (isUniqueViolation(e)) return bad('build already registered (slug or pr_url)', 409);
    throw e;
  }
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
  if (note !== null) {
    const e = strError(note, 'note', NOTE);
    if (e) return bad(e);
  }
  const now = new Date().toISOString();

  if (id === undefined) {
    // collect の毎時記録は数えない
    const recent = await countSince(env, 'runs', 'started_at', new Date(Date.now() - DAY_MS).toISOString(), `kind IN ('ideas', 'build')`);
    if (recent >= LIMIT_RUNS_PER_DAY) return bad('daily limit for runs exceeded', 429);
    const finished = result === 'started' ? null : now;
    const r = await env.DB.prepare(
      `INSERT INTO runs (kind, started_at, finished_at, result, note) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
      .bind(kind, now, finished, result, note)
      .first<{ id: number }>();
    return json({ id: r!.id }, 201);
  }
  if (typeof id !== 'number' || !Number.isInteger(id) || result === 'started')
    return bad('id must be an integer and result must not be started');
  // started のままの行だけ更新対象にして、終了済みの記録を書き換えられないようにする
  const r = await env.DB.prepare(
    `UPDATE runs SET result = ?, note = ?, finished_at = ? WHERE id = ? AND kind = ? AND result = 'started'`,
  )
    .bind(result, note, now, id, kind)
    .run();
  if (r.meta.changes < 1) return bad('run not found or already finished', 409);
  return json({ id });
}

const notFound = () => new Response('Not Found', { status: 404 });

export async function handleAgent(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/agent/') || url.pathname.includes('//')) return notFound();
    if (!(await isAuthorized(request, env))) {
      return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer' } });
    }
    const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    switch (`${request.method} ${path}`) {
      case 'GET /api/agent/trends':
        return await getTrends(url, env);
      case 'GET /api/agent/ideas':
        return await getIdeas(url, env);
      case 'POST /api/agent/ideas':
        return await postIdeas(request, env);
      case 'POST /api/agent/claim':
        return await postClaim(env);
      case 'POST /api/agent/builds':
        return await postBuilds(request, env);
      case 'POST /api/agent/runs':
        return await postRuns(request, env);
      default:
        return notFound();
    }
  } catch (e) {
    console.error('agent API error', e);
    return bad('internal error', 500);
  }
}
