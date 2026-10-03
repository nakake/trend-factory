// このファイルの SQL は SELECT だけ。console は D1 を読み取りでしか使わない
export interface RunRow {
  id: number;
  kind: string;
  started_at: string;
  finished_at: string | null;
  result: string;
  note: string | null;
}
export interface IdeaRow {
  slug: string;
  title: string;
  summary: string;
  sources_json: string;
  scores_json: string;
  total: number;
  status: string;
  attempts: number;
  created_at: string;
}
export interface BuildRow {
  slug: string;
  preview_url: string;
  pr_url: string;
  created_at: string;
}
export interface TrendRow {
  term: string;
  traffic: number;
  news_json: string;
}

export interface PageData {
  now: Date;
  lastCollectOk: string | null;
  lastIdeas: RunRow | null;
  lastBuild: RunRow | null;
  failedRuns: RunRow[];
  counts: { trends: number; ideas: number; builds: number; runs: number };
  builds: BuildRow[];
  ideas: IdeaRow[];
  trends: TrendRow[];
}

export async function loadPageData(env: Env, now: Date = new Date()): Promise<PageData> {
  const db = env.DB;
  const day = new Date(now.getTime() - 86400_000).toISOString();
  const week = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const lastRun = (kind: string) =>
    db.prepare('SELECT * FROM runs WHERE kind = ? ORDER BY started_at DESC, id DESC LIMIT 1').bind(kind);

  // 1 回の batch にまとめるのは、D1 Free の「1 回の実行で 50 クエリ」に収めるのと往復を減らすため
  const r = await db.batch([
    db.prepare(`SELECT MAX(started_at) AS t FROM runs WHERE kind = 'collect' AND result = 'ok'`),
    lastRun('ideas'),
    lastRun('build'),
    db.prepare(`SELECT * FROM runs WHERE result = 'failed' AND started_at >= ? ORDER BY started_at DESC, id DESC LIMIT 50`).bind(week),
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM trends) AS trends, (SELECT COUNT(*) FROM ideas) AS ideas,
              (SELECT COUNT(*) FROM builds) AS builds, (SELECT COUNT(*) FROM runs) AS runs`,
    ),
    db.prepare('SELECT slug, preview_url, pr_url, created_at FROM builds ORDER BY created_at DESC LIMIT 100'),
    db.prepare(
      `SELECT slug, title, summary, sources_json, scores_json, total, status, attempts, created_at
       FROM ideas ORDER BY created_at DESC, id DESC LIMIT 100`,
    ),
    db.prepare('SELECT term, traffic, news_json FROM trends WHERE last_seen >= ? ORDER BY traffic DESC, term LIMIT 30').bind(day),
  ]);
  const rows = <T>(i: number) => r[i].results as T[];
  return {
    now,
    lastCollectOk: rows<{ t: string | null }>(0)[0]?.t ?? null,
    lastIdeas: rows<RunRow>(1)[0] ?? null,
    lastBuild: rows<RunRow>(2)[0] ?? null,
    failedRuns: rows<RunRow>(3),
    counts: rows<PageData['counts']>(4)[0],
    builds: rows<BuildRow>(5),
    ideas: rows<IdeaRow>(6),
    trends: rows<TrendRow>(7),
  };
}
