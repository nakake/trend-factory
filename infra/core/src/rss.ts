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

export function toJstDay(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export function jstHour(d: Date): number {
  return new Date(d.getTime() + JST_OFFSET_MS).getUTCHours();
}

function decode(s: string): string {
  return s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
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

// ライブラリを入れず必要な要素だけ正規表現で抜くのは、Workers Free の CPU 10ms 制限のため
export function parseTrendsRss(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const term = tag(body, 'title');
    const pub = tag(body, 'pubDate');
    if (!term || !pub) continue;
    const t = Date.parse(pub);
    if (Number.isNaN(t)) continue;
    const news: NewsItem[] = [];
    for (const n of body.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)) {
      const title = tag(n[1], 'ht:news_item_title');
      const url = tag(n[1], 'ht:news_item_url');
      if (!title || !url) continue;
      news.push({ title, url, source: tag(n[1], 'ht:news_item_source') ?? '' });
    }
    items.push({
      term,
      traffic: parseTraffic(tag(body, 'ht:approx_traffic')),
      dayJst: toJstDay(new Date(t)),
      news,
    });
  }
  return items;
}
