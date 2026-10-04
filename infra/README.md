# infra

- `core/`: トレンド収集 Cron と AI 用 API(`trend-factory-api.nakake.com`)。手順は `core/README.md`
- `console/`: 一覧ページ(`trend-factory-console.nakake.com`、Cloudflare Access で本人のみ)。手順は `console/README.md`
- `scripts/`: 小物の公開と取り下げ。本人が端末から実行する。手順は `../docs/operations.md`
  - `pnpm -C infra publish-tool <slug> <PR番号>`、`pnpm -C infra unpublish-tool <slug>`
  - `config.sh`: 本体アカウント ID、ドメイン、tools リポジトリ名、互換日付
  - `lib/check-tool-tree.sh <git-dir> <sha> <slug>`: 公開してよいツリーかの検査。単体で動く
  - `lib/find-agent-files.sh <git-dir> <rev>`: routine が自動で読む指示ファイルなどをツリー全体から探す
  - `lib/scan-tool.py <dir>`: 外部 URL、通信、文字列の実行などの書き方を要約する機械検出
  - `lib/sanitize.sh`(中身は `sanitize.py`): 端末に出す前に、ASCII と日本語以外の文字を `<U+XXXX>` へ置き換えるフィルタ
  - `lib/preview-server.py <dir> <CSP>`: 本番と同じヘッダーを付ける手元の配信
  - `lib/deploy-meta.py`: wrangler の JSON 出力から、前回公開した SHA を取り出す

`pnpm -C infra install` のあと `pnpm -C infra test` / `pnpm -C infra typecheck`。test は core、console に続けて `scripts/test/` の bash テストを走らせる(通しテストは `script` コマンドで疑似端末を作る。gh と wrangler は偽物に替えるので、外部へは出ない)。D1 のスキーマの正本は `core/migrations/`。

本人の wrangler ログインは 2 つのアカウントに属する。`core` と `console` で wrangler を直接打つときは `CLOUDFLARE_ACCOUNT_ID=d49004aee2b170cd870967a1a9cdc1d1`(本体)を付ける。
