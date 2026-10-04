# infra

- `core/`: トレンド収集 Cron と AI 用 API(`agent.nakake.com`)。手順は `core/README.md`
- `console/`: 一覧ページ(`console.nakake.com`、Cloudflare Access で本人のみ)。手順は `console/README.md`

`pnpm -C infra install` のあと `pnpm -C infra test` / `pnpm -C infra typecheck`。D1 のスキーマの正本は `core/migrations/`。
