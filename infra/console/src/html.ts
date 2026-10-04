export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// 空白・制御文字・引用符・山括弧・双方向制御文字・ゼロ幅文字を含む URL はリンクにしない(エスケープに加えた二重の防御)
const SAFE_URL = /^https:\/\/[^\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff"'<>`\\]+$/;
const PR_URL = /^https:\/\/github\.com\/nakake\/trend-factory-tools\/pull\/(\d{1,7})$/;
const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export const isSafeUrl = (u: string) => SAFE_URL.test(u) && u.length <= 1000;
export const isPrUrl = (u: string) => PR_URL.test(u);
export const isSlug = (s: string) => SLUG.test(s);

// 検証を通った pr_url からだけ番号を取る。通らない値から作ったコマンドを本人に打たせないため
export const prNumber = (u: string): string | null => PR_URL.exec(u)?.[1] ?? null;

// core は末尾の `/` 1 個を許して保存するので、比較前に落とす
export const stripSlash = (u: string) => u.replace(/\/$/, '');

export function isPreviewUrl(u: string, slug: string, suffix: string | undefined): boolean {
  if (!suffix || suffix.includes('REPLACE-ME') || !SLUG.test(slug)) return false;
  return stripSlash(u) === `https://${slug}-preview.${suffix}`;
}

export const link = (url: string, ok: boolean, label?: string): string =>
  ok ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(label ?? url)}</a>` : esc(url);

// 外部由来のリンクはリンク先のホスト名を併記する。見出しと行き先の食い違いに気づけるように
export function externalLink(url: string, label?: string): string {
  if (!isSafeUrl(url)) return esc(label ?? url);
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return esc(label ?? url);
  }
  return `${link(url, true, label)} <span class="muted">(${esc(host)})</span>`;
}

const pad = (n: number) => String(n).padStart(2, '0');

// 戻り値は生の文字列。エスケープは呼び出し側で行う
// D1 の時刻は UTC の ISO 文字列。Intl に頼らず +9 時間して UTC のゲッターで読む
export function jst(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 9 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
