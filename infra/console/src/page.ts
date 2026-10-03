import type { BuildRow, IdeaRow, PageData, RunRow, TrendRow } from './data';
import { esc, isPrUrl, isPreviewUrl, isSafeUrl, jst, link } from './html';

export const COLLECT_STALE_MS = 2 * 3600_000;

const STATUS: Record<string, string> = {
  candidate: '候補',
  building: '実装中',
  built: '実装済み',
  skipped: '見送り',
};

const RESULT: Record<string, string> = { started: '開始のみ(終了の記録なし)', ok: '成功', failed: '失敗', noop: '対象なし' };

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function runCell(r: RunRow | null): string {
  if (!r) return '<span class="muted">記録なし</span>';
  const cls = r.result === 'failed' ? ' class="bad"' : '';
  const note = r.note ? ` <span class="muted">${esc(r.note)}</span>` : '';
  return `${esc(jst(r.started_at))} <span${cls}>${esc(RESULT[r.result] ?? r.result)}</span>${note}`;
}

function summary(d: PageData): string {
  const last = d.lastCollectOk;
  const age = last ? d.now.getTime() - Date.parse(last) : NaN;
  const stale = !last || Number.isNaN(age) || age >= COLLECT_STALE_MS;
  const warn = stale
    ? `<p class="warn">収集(collect)が 2 時間以上成功していません。${last ? '' : '成功した記録がありません。'}</p>`
    : '';
  const failed = d.failedRuns.length
    ? `<div class="table-wrap"><table><thead><tr><th>開始(JST)</th><th>種別</th><th>内容</th></tr></thead><tbody>${d.failedRuns
        .map((r) => `<tr><td class="nowrap">${esc(jst(r.started_at))}</td><td>${esc(r.kind)}</td><td>${esc(r.note ?? '')}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="muted">直近 7 日の失敗はありません。</p>';
  const c = d.counts;
  return `<h2>状態</h2>${warn}
<table class="kv"><tbody>
<tr><th>最後に成功した収集</th><td>${last ? esc(jst(last)) : '<span class="muted">なし</span>'}</td></tr>
<tr><th>案出し(ideas)の最後の実行</th><td>${runCell(d.lastIdeas)}</td></tr>
<tr><th>実装(build)の最後の実行</th><td>${runCell(d.lastBuild)}</td></tr>
<tr><th>D1 の行数</th><td>trends ${c.trends} / ideas ${c.ideas} / builds ${c.builds} / runs ${c.runs}</td></tr>
</tbody></table>
<h3>直近 7 日の失敗</h3>${failed}`;
}

function builds(rows: BuildRow[], suffix: string): string {
  if (!rows.length) return '<h2>小物</h2><p class="muted">まだありません。</p>';
  const body = rows
    .map((b) => {
      const prod = `https://tool-${b.slug}.nakake.com`;
      const prodOk = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(b.slug);
      return `<tr><td>${esc(b.slug)}</td><td class="nowrap">${esc(jst(b.created_at))}</td>
<td>${link(b.preview_url, isPreviewUrl(b.preview_url, b.slug, suffix))}</td>
<td>${link(b.pr_url, isPrUrl(b.pr_url))}</td>
<td>${prodOk ? link(prod, true) : '-'} <span class="muted">(マージ後に有効)</span></td></tr>`;
    })
    .join('');
  return `<h2>小物</h2><div class="table-wrap"><table><thead><tr><th>slug</th><th>作成(JST)</th><th>プレビュー</th><th>PR</th><th>本番 URL(マージ後に有効)</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function ideaRow(i: IdeaRow): string {
  const sc = parseJson(i.scores_json);
  const scores =
    sc && typeof sc === 'object' && !Array.isArray(sc)
      ? Object.entries(sc as Record<string, unknown>)
          .map(([k, v]) => `${esc(k)} ${esc(v)}`)
          .join('<br>')
      : '';
  const src = parseJson(i.sources_json);
  const sources = Array.isArray(src)
    ? src.filter((s): s is string => typeof s === 'string').slice(0, 10)
    : [];
  const srcHtml = sources.length
    ? `<ul>${sources.map((s) => `<li>${link(s, isSafeUrl(s))}</li>`).join('')}</ul>`
    : '';
  return `<tr><td><strong>${esc(i.title)}</strong><br><span class="muted">${esc(i.slug)}</span><br>${esc(i.summary)}</td>
<td class="num">${esc(i.total)}</td><td class="scores">${scores}</td>
<td class="nowrap">${esc(STATUS[i.status] ?? i.status)}</td><td class="num">${esc(i.attempts)}</td>
<td>${srcHtml}</td><td class="nowrap">${esc(jst(i.created_at))}</td></tr>`;
}

function ideas(rows: IdeaRow[]): string {
  if (!rows.length) return '<h2>案</h2><p class="muted">まだありません。</p>';
  return `<h2>案(新しい順、最大 100 件)</h2><div class="table-wrap"><table><thead><tr><th>案</th><th>合計</th><th>採点</th><th>状態</th><th>試行</th><th>情報源</th><th>作成(JST)</th></tr></thead><tbody>${rows
    .map(ideaRow)
    .join('')}</tbody></table></div>`;
}

function trendRow(t: TrendRow): string {
  const raw = parseJson(t.news_json);
  const news = Array.isArray(raw) ? raw.slice(0, 3) : [];
  const items = news
    .map((n) => {
      const o = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
      const title = typeof o.title === 'string' ? o.title : '';
      const url = typeof o.url === 'string' ? o.url : '';
      return title ? `<li>${isSafeUrl(url) ? link(url, true, title) : esc(title)}</li>` : '';
    })
    .join('');
  return `<tr><td>${esc(t.term)}</td><td class="num">${esc(t.traffic)}</td><td>${items ? `<ul>${items}</ul>` : ''}</td></tr>`;
}

function trends(rows: TrendRow[]): string {
  if (!rows.length) return '<h2>今日のトレンド</h2><p class="muted">直近 24 時間のデータがありません。</p>';
  return `<h2>今日のトレンド(直近 24 時間、検索数の多い順に 30 件)</h2><div class="table-wrap"><table><thead><tr><th>語</th><th>検索数</th><th>ニュース</th></tr></thead><tbody>${rows
    .map(trendRow)
    .join('')}</tbody></table></div>`;
}

export function renderPage(d: PageData, previewSuffix: string): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>trend-factory コンソール</title><link rel="stylesheet" href="/style.css"></head>
<body><main><h1>trend-factory</h1><p class="muted">表示時刻 ${esc(jst(d.now.toISOString()))} JST。読み取り専用。</p>
${summary(d)}${builds(d.builds, previewSuffix)}${ideas(d.ideas)}${trends(d.trends)}
</main></body></html>`;
}
