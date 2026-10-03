export interface NewsItem {
  title: string;
  url: string;
  source: string;
}

export interface TrendItem {
  term: string;
  traffic: number;
  dayJst: string;
  news: NewsItem[];
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
// D1 の 1 文の長さ上限(100KB)に json_each の引数が収まるよう、件数と長さを抑える
const MAX_ITEMS = 100;
const MAX_NEWS_PER_ITEM = 5;

export function toJstDay(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function jstHour(d: Date): number {
  return new Date(d.getTime() + JST_OFFSET_MS).getUTCHours();
}

// 範囲外・サロゲート・0 の参照は fromCodePoint が例外を投げるか壊れた文字列になるので U+FFFD にする
function fromRef(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
  return String.fromCodePoint(n);
}

function decode(s: string): string {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&#(\d+);/g, (_, n) => fromRef(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => fromRef(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]) : undefined;
}

// "5000+" / "1,000+" / "2万+" のいずれも整数にする
export function parseTraffic(raw: string | undefined): number {
  if (!raw) return 0;
  const m = /([\d,.]+)\s*(万|億|[KkMm])?/.exec(raw);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const mult: Record<string, number> = { 万: 1e4, 億: 1e8, K: 1e3, k: 1e3, M: 1e6, m: 1e6 };
  return Math.round(n * (m[2] ? mult[m[2]] : 1));
}

function parseItem(body: string): TrendItem | null {
  const term = tag(body, 'title');
  const pub = tag(body, 'pubDate');
  if (!term || !pub) return null;
  const t = Date.parse(pub);
  if (Number.isNaN(t)) return null;
  const news: NewsItem[] = [];
  for (const n of body.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)) {
    if (news.length >= MAX_NEWS_PER_ITEM) break;
    const title = tag(n[1], 'ht:news_item_title');
    if (!title) continue;
    const url = tag(n[1], 'ht:news_item_url') ?? '';
    news.push({
      title: title.slice(0, 200),
      // 一覧ページがリンクにするので、javascript: などを保存しない
      url: /^https:\/\/\S+$/.test(url) && url.length <= 1000 ? url : '',
      source: (tag(n[1], 'ht:news_item_source') ?? '').slice(0, 100),
    });
  }
  return {
    term: term.slice(0, 200),
    traffic: parseTraffic(tag(body, 'ht:approx_traffic')),
    dayJst: toJstDay(new Date(t)),
    news,
  };
}

// ライブラリを入れず必要な要素だけ正規表現で抜くのは、Workers Free の CPU 10ms 制限のため
export function parseTrendsRss(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    if (items.length >= MAX_ITEMS) break;
    try {
      const it = parseItem(m[1]);
      if (it) items.push(it);
    } catch (e) {
      console.error('skip broken RSS item', e);
    }
  }
  return items;
}
