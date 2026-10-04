# routines

routine の手順書の正本を置く場所。

- `ideas.md`: 案出し routine の手順書
- `build.md`: 実装 routine の手順書

## 置き場と反映のしかた

- 正本はこのリポジトリ。routine はこのリポジトリを紐付けないので、**routine はこのディレクトリを読めない**
- 手順書を変えたら、本人側が routine の設定(プロンプト)に本文を流し込む。ここを直しただけでは routine の動きは変わらない
- tools リポジトリに手順書を置かない。AI が書き換えられる場所に置くと、AI が自分の手順を変えられる。同じ理由で、tools リポジトリの `CLAUDE.md` や `.claude/` も使わない(実装 routine は最初にこれらを探し、あれば何もせず終わる。公開スクリプトも検知して警告する)
- 版は各ファイルの 1 行目(`<!-- version: ... -->`)にだけ書く。本文では「1 行目の version」と参照する。routine は AI 用 API の runs の note の 1 行目に、その版を書く。内容を変えたら版を上げる

## 環境は 2 つに分ける

| | 案出し用 | 実装用 |
|---|---|---|
| 手順書 | `ideas.md` | `build.md` |
| 紐付けるリポジトリ | 無し | `nakake/trend-factory-tools` だけ |
| API credentials | `trend-factory-api.nakake.com` の合言葉 | 同じ |
| 環境変数 | 無し | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`(どちらも工房アカウント) |
| 許可する通信先 | AI 用 API、`hn.algolia.com`、`www.producthunt.com` | AI 用 API、npm、Cloudflare、GitHub |

案出しは外部の文章を毎日読むので、指示が紛れる入口になる。トークンもリポジトリも渡さず、乗せられても「案を登録する」以上のことができないようにする。登録される案の形は API 側で絞ってある(採点は 5 項目の整数、sources は Hacker News と Product Hunt の URL だけ)。

## 手順書の決まり

どちらの手順書にも共通する書き方。直すときも守る。

- API の呼び出しごとに、直後に「この応答ならこうする」を 1 行ずつ書く。書いていない応答で routine が自分で判断しないようにする
- curl は `-w '\n%{http_code}'` で本文とステータスを同時に取る。同じ POST を送り直さない(開始の記録と claim は 1 回の実行で 1 度だけ)。送り直してよい場合は「1 回だけ」と明記する
- 開始の記録が 201 でなければ、何もせず終わる
- 送る JSON は python3 で組み立て、標準入力で `curl --data-binary @-` に渡す
- note は 1000 字以内。タブ、CR、エスケープ文字を入れない。コマンドの出力を貼らない
- 最後に、note と同じ内容を 1 回だけ出力して終わる
- 注入文の実例(具体的な言い回し)を手順書に書かない。「作業の指示にあたる文」のように性質で書く。実例を書くと、それ自体が材料になる
- 外部の文章は、決まった項目(見出し、点数、ID)だけを表示するコマンドで読む。本文などの自由文を文脈に入れない

## API との対応

手順書に書いた呼び出しと、`infra/core/src/agent.ts` の実装の対応。API を変えたら、ここと手順書を一緒に直す。

| 手順書 | 呼び出し | 手順書に書いた応答 | 実装とテスト |
|---|---|---|---|
| ideas 1、build 1 | `POST /api/agent/runs` `{kind, result:"started", note}` | 201 `id` / それ以外は終わる | `postRuns`、`runs.test.ts` |
| ideas 2 | `GET /api/agent/ideas?days=60` | 200 `ideas[].slug, title, status, total` | `getIdeas`、`ideas.test.ts` |
| ideas 2 | `GET /api/agent/trends?hours=24&limit=100` | 200 `trends[].term, traffic, news[]` | `getTrends`、`runs.test.ts` |
| ideas 5 | `POST /api/agent/ideas` `[{slug, title, summary, sources, scores, total}]` | 201 `inserted, skipped` / 409 / 400 `error` / 429 | `postIdeas`、`ideas.test.ts` |
| build 3 | `POST /api/agent/claim` | 200 `idea.slug, title, summary, scores, total, attempts` / 204 | `postClaim`、`claim.test.ts` |
| build「途中でやめるとき」 | `POST /api/agent/release` `{slug, outcome}` | 200 `status` / 409 | `postRelease`、`release.test.ts` |
| build 8 | `POST /api/agent/builds` `{slug, preview_url, pr_url}` | 201 / 400、409、429、503 | `postBuilds`、`builds.test.ts` |
| ideas 6、build 9 | `POST /api/agent/runs` `{kind, id, result, note}` | 200 / 400(note の文字) | `postRuns`、`runs.test.ts` |

## 小物の制約

公開スクリプトは、すべての小物に Content-Security-Policy を付けて公開し、その前に機械検出(`infra/scripts/lib/scan-tool.py`)と検査(`check-tool-tree.sh`)にかける。`build.md` の「使えないもの」は、この 3 つと揃えてある。どれかを変えたら `build.md` と、tools リポジトリの `tools/_template/` も直す。

- スクリプトは同じ場所の `.js` ファイルに書く。インラインの `<script>`、`onclick=` などのイベント属性、`eval` は使えない
- スタイルは同じ場所の `.css` ファイルに書く。インラインの `<style>` と `style=` 属性は使えない
- 外部への通信はできない(`fetch`、外部の画像、フォント、CDN のライブラリ)
- ファイル名は小文字の英数字と `.` `_` `-` で、先頭は英数字。拡張子は `.html .css .js .svg .png .jpg .webp .ico .json .txt`。テキストに NUL を入れない。画像は拡張子どおりの形式にする
- `.js` と `.css` は ASCII だけ。JS が出す日本語の文言は HTML の `<template>` などに置く。機械検出に挙がる書き方(`data` というキー名、`on` で始まる名前など)も避け、雛形が警告 0 で通る状態を保つ
- `build.md` に直書きしている値: CSP(`infra/scripts/lib/common.sh` の `TOOL_CSP` と同じ)、wrangler の版(`infra/` のロックファイルと同じ 4.147.0)、playwright-core の版(1.63.0。routine の同梱ブラウザ `/opt/pw-browsers/chromium-*` を `executablePath` で使う)

設計は [../docs/design.md](../docs/design.md) の「routine の設定」「AI 用 API」「公開物の制約(CSP)」を参照。
