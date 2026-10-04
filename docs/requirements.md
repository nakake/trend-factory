# 要件

2026-10-03 にヒアリングで決めた内容。設計はこの文書を前提にする。

## 目的

トレンドから小さな Web ツールの案を出し、AI が実装まで行う。作ったものを公開して反応を見て、伸びそうなものだけ育てる。副収入づくりの 1 段階目(実績作り)を兼ねる。

## 要件

| 項目 | 内容 |
|---|---|
| 情報源 | Google Trends(RSS)、Hacker News、Product Hunt(新着フィード) |
| トレンドの蓄積 | Google Trends RSS を Cloudflare Workers Cron で 1 時間ごとに取得し D1 に保存。400 日より古いものを日次で削除。日数は設定値で、無料枠を超えそうなら短くする |
| 案出し | 毎日。AI が採点し上位を選ぶ |
| 実装 | AI が選んだ案をそのまま実装する。最初は週 2〜3 回、頻度は設定で変更可 |
| 小物の形 | ブラウザだけで動く静的 Web ツール(あとで広げる可能性あり) |
| リポジトリ | 小物は `nakake/trend-factory-tools`(非公開)の `tools/<名前>/` に作る。基盤(収集、API、一覧ページ、公開スクリプト)は `nakake/trend-factory`(公開)に置き、AI には触らせない。伸びそうなものだけ後から専用リポジトリに切り出す(2026-10-04 に 1 つから 2 つへ変更。理由は `docs/design.md`) |
| AI の実行場所 | Claude Code の定期実行(routine、クラウド)、環境 `trend-factory` |
| 公開 | 実装ごとに Cloudflare のプレビュー URL まで自動。本番に上げるかは本人が判断し、本人が手元の端末から公開する |
| 一覧ページ | Cloudflare に置き、本人だけが見られる(Cloudflare Access でログイン必須)。案、採点、作ったもの、公開状態を見られる |

## 検証で分かった制約

2026-10-03 にクラウドセッションで実測した。

- 既定の環境は許可リスト外への通信をプロキシで止める。Custom 環境 `trend-factory` を作り、各情報源と Cloudflare のドメインを許可した。npm などの既定リストも有効
- 届くもの: Google Trends RSS(JP / US、5 秒間隔の連続取得も可)、HN Firebase API、HN Algolia API、Product Hunt フィード、Cloudflare API、npm
- 相手側に拒否されるもの: Google Trends の explore API(429)、Reddit(403、またはログインへリダイレクト)。Product Hunt GraphQL はトークンが必要(401)
- Google Trends RSS は 1 回 10 件、直近約 1.5 時間分。1 日 1 回の取得では偏るため蓄積する
- routine の GitHub 操作は、routine に紐付けたリポジトリに限られる。新規リポジトリは作れない
- 秘密情報は環境の API credentials に置くと、セッションから値が見えない形で通信に付与される(ドキュメント記載、未実測)
