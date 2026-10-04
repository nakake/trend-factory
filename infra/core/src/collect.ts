import { jstHour, parseTrendsRss, toJstDay } from './rss';
import { getRetentionDays } from './settings';

export const RSS_URL = 'https://trends.google.com/trending/rss?geo=JP';
const MAX_BODY_BYTES = 1_000_000;

// 1 文にまとめるのは、D1 Free の「1 回の実行で 50 クエリ」に batch 内の文が数えられうるため。
// 再取得で news が取れなかったときは、既存の news_json を残す
const UPSERT = `INSERT INTO trends (term, day_jst, traffic, news_json, first_seen, last_seen)
SELECT json_extract(value, '$.term'), json_extract(value, '$.day'), json_extract(value, '$.traffic'),
       json_extract(value, '$.news'), ?2, ?2
FROM json_each(?1) WHERE true
ON CONFLICT (term, day_jst) DO UPDATE SET
  traffic = MAX(traffic, excluded.traffic),
  news_json = CASE WHEN excluded.news_json = '[]' THEN news_json ELSE excluded.news_json END,
  last_seen = excluded.last_seen`;

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
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_BODY_BYTES) throw new Error(`RSS body too large (content-length ${declared})`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) throw new Error(`RSS body too large (${buf.byteLength} bytes)`);
    const text = new TextDecoder().decode(buf);

    const items = parseTrendsRss(text);
    if (items.length === 0) {
      // 形式変更やエラーページを「成功」として記録し続けないため
      throw new Error(
        `no items parsed; content-type=${res.headers.get('content-type')}; body=${text.slice(0, 100)}`,
      );
    }

    const payload = JSON.stringify(
      items.map((it) => ({ term: it.term, day: it.dayJst, traffic: it.traffic, news: it.news })),
    );
    const stmts = [env.DB.prepare(UPSERT).bind(payload, startedAt)];
    if (jstHour(now) === 0) {
      const days = await getRetentionDays(env);
      const cutoff = toJstDay(new Date(now.getTime() - days * 86400_000));
      stmts.push(env.DB.prepare(`DELETE FROM trends WHERE day_jst < ?`).bind(cutoff));
      // runs は毎時 1 行ずつ増えるので trends と同じ期限で消す
      stmts.push(
        env.DB.prepare(`DELETE FROM runs WHERE started_at < ?`).bind(new Date(now.getTime() - days * 86400_000).toISOString()),
      );
    }
    stmts.push(logRun('ok', `items=${items.length}`));
    await env.DB.batch(stmts);
    return { count: items.length };
  } catch (e) {
    try {
      await logRun('failed', String(e instanceof Error ? e.message : e).slice(0, 1000)).run();
    } catch (logErr) {
      // 記録の失敗で元の例外を隠さない
      console.error('failed to record collect failure', logErr);
    }
    throw e;
  }
}
