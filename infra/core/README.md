# trend-factory-core

毎時 Cron で Google Trends RSS(JP)を D1 に集め、AI 用 API(`/api/agent/*`)を `agent.nakake.com` で提供する Worker。スキーマの正本は `migrations/0001_init.sql`。

## 本人がやる手順(本体アカウント、WSL から)

```bash
cd ~/project/trend-factory/infra
pnpm install
cd core
```

1. D1 を作る。出力の `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に入れる。

   ```bash
   pnpm exec wrangler d1 create trend-factory
   ```

2. `wrangler.jsonc` の `vars.PREVIEW_SUFFIX` を、工房アカウントの workers.dev サブドメイン(例 `xxx.workers.dev`)に置き換える。工房アカウントができる段 5 まではプレースホルダのままでよい(builds の登録だけが通らない)。
3. マイグレーションを本番の D1 に適用する。

   ```bash
   pnpm exec wrangler d1 migrations apply trend-factory --remote
   ```

4. 合言葉を作って secret に登録する。値はどこにも保存せず、routine 環境の API credentials(`agent.nakake.com`)にも同じ値を入れる。

   ```bash
   openssl rand -hex 32
   pnpm exec wrangler secret put AGENT_TOKEN
   ```

5. デプロイする。`wrangler.jsonc` の `routes` に `{ "pattern": "agent.nakake.com", "custom_domain": true }` を入れてあるので、デプロイ時に Custom Domain(DNS レコードと証明書)が作られる。`nakake.com` のゾーンが同じアカウントにあることが必要。

   ```bash
   pnpm exec wrangler deploy
   ```

6. 確認する。

   ```bash
   export AGENT_TOKEN=...   # 手順 4 の値
   H="authorization: Bearer $AGENT_TOKEN"

   curl -i https://agent.nakake.com/api/agent/ideas                 # 401
   curl -i https://agent.nakake.com/                                # 404
   curl -s -H "$H" 'https://agent.nakake.com/api/agent/trends?hours=24'   # 毎時 5 分の収集のあと、件数が増える
   curl -s -H "$H" -H 'content-type: application/json' -X POST https://agent.nakake.com/api/agent/ideas \
     -d '[{"slug":"sample-tool","title":"sample","summary":"s","sources":[],"scores":{"need":30},"total":75}]'
   curl -i -H "$H" -X POST https://agent.nakake.com/api/agent/claim  # 200(1 回目)
   curl -i -H "$H" -X POST https://agent.nakake.com/api/agent/claim  # 204(2 回目)
   ```

   確認用の案は D1 に残る。消すなら `pnpm exec wrangler d1 execute trend-factory --remote --command "DELETE FROM ideas WHERE slug='sample-tool'"`。収集の記録は `SELECT * FROM runs ORDER BY id DESC LIMIT 5`。

## 設定の変更

`min_score`(既定 60)と `retention_days`(既定 400)は `settings` テーブルにある。

```bash
pnpm exec wrangler d1 execute trend-factory --remote --command "UPDATE settings SET value='70' WHERE key='min_score'"
```

## ローカル

`pnpm -C infra test`(ローカルの D1 で動く。外部へは出ない)、`pnpm -C infra typecheck`。テスト用の合言葉は `vitest.config.ts` にあるテスト専用の値で、本物ではない。
