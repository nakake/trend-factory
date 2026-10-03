import { jstHour, parseTrendsRss, toJstDay } from './rss';

export const RSS_URL = 'https://trends.google.com/trending/rss?geo=JP';

const UPSERT = `INSERT INTO trends (term, day_jst, traffic, news_json, first_seen, last_seen)
VALUES (?1, ?2, ?3, ?4, ?5, ?5)
ON CONFLICT (term, day_jst) DO UPDATE SET
  traffic = MAX(traffic, excluded.traffic),
  news_json = excluded.news_json,
  last_seen = excluded.last_seen`;

// retention_days を別クエリで読むと往復が増えるので、削除文の中で settings を引く
const PURGE = `DELETE FROM trends
WHERE day_jst < date(?1, '-' || COALESCE((SELECT value FROM settings WHERE key = 'retention_days'), '400') || ' days')`;

export async function collect(
  env: Env,
  now: Date = new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<{ count: number }> {
  const startedAt = now.toISOString();
  const logRun = (result: string, note: string) =>
    env.DB.prepare(
      `INSERT INTO runs (kind, started_at, finished_at, result, note) VALUES ('collect', ?1, ?2, ?3, ?4)`,
    ).bind(startedAt, new Date().toISOString(), result, note);

  try {
    const res = await fetchFn(RSS_URL, {
      headers: { 'user-agent': 'trend-factory-core' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
    const items = parseTrendsRss(await res.text());

    const stmts = items.map((it) =>
      env.DB.prepare(UPSERT).bind(it.term, it.dayJst, it.traffic, JSON.stringify(it.news), startedAt),
    );
    if (jstHour(now) === 0) stmts.push(env.DB.prepare(PURGE).bind(toJstDay(now)));
    stmts.push(logRun('ok', `items=${items.length}`));
    // 書き込み行数の上限(1 日 10 万行)と往復回数を抑えるため 1 回の batch にまとめる
    await env.DB.batch(stmts);
    return { count: items.length };
  } catch (e) {
    await logRun('failed', String(e instanceof Error ? e.message : e).slice(0, 1000)).run();
    throw e;
  }
}
