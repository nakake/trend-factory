# infra

- `core/`: トレンド収集 Cron と AI 用 API(`trend-factory-api.nakake.com`)。手順は `core/README.md`
- `console/`: 一覧ページ(`trend-factory-console.nakake.com`、Cloudflare Access で本人のみ)。手順は `console/README.md`
- `scripts/`: 小物の公開と取り下げ。本人が端末から実行する。手順は `../docs/operations.md`
  - `pnpm -C infra publish-tool <slug> <PR番号>`、`pnpm -C infra unpublish-tool <slug>`
  - `config.sh`: 本体アカウント ID、ドメイン、tools リポジトリ名、互換日付
  - `lib/check-tool-tree.sh <git-dir> <sha> <slug>`: 公開してよいツリーかの検査。単体で動く
  - `lib/sanitize.sh`: 端末に出す前に制御文字を可視の文字へ置き換えるフィルタ
  - `lib/deploy-meta.py`: wrangler の JSON 出力から、前回公開した SHA を取り出す

`pnpm -C infra install` のあと `pnpm -C infra test` / `pnpm -C infra typecheck`。test は core、console に続けて `scripts/test/` の bash テストを走らせる。D1 のスキーマの正本は `core/migrations/`。

本人の wrangler ログインは 2 つのアカウントに属する。`core` と `console` で wrangler を直接打つときは `CLOUDFLARE_ACCOUNT_ID=d49004aee2b170cd870967a1a9cdc1d1`(本体)を付ける。
