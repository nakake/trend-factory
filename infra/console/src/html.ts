export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// 空白・制御文字・引用符・山括弧を含む URL はリンクにしない(エスケープに加えた二重の防御)
const SAFE_URL = /^https:\/\/[^\s\u0000-\u001f\u007f-\u009f"'<>`\\]+$/;
const PR_URL = /^https:\/\/github\.com\/nakake\/trend-factory\/pull\/\d+$/;
const SLUG = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export const isSafeUrl = (u: string) => SAFE_URL.test(u) && u.length <= 1000;
export const isPrUrl = (u: string) => PR_URL.test(u);

export function isPreviewUrl(u: string, slug: string, suffix: string | undefined): boolean {
  if (!suffix || suffix.includes('REPLACE-ME') || !SLUG.test(slug)) return false;
  return u === `https://${slug}-preview.${suffix}`;
}

export const link = (url: string, ok: boolean, label?: string): string =>
  ok ? `<a href="${esc(url)}" rel="noopener noreferrer">${esc(label ?? url)}</a>` : esc(url);

const pad = (n: number) => String(n).padStart(2, '0');

// D1 の時刻は UTC の ISO 文字列。Intl に頼らず +9 時間して UTC のゲッターで読む
export function jst(iso: string | null | undefined): string {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return esc(iso);
  const d = new Date(t + 9 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
