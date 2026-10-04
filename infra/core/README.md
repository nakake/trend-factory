# trend-factory-core

毎時 Cron で Google Trends RSS(JP)を D1 に集め、AI 用 API(`/api/agent/*`)を `trend-factory-api.nakake.com` で提供する Worker。スキーマの正本は `migrations/`(`0001_init.sql` と、設定の初期値を足す `0002_candidate_ttl.sql`)。

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

2. `wrangler.jsonc` の `vars.PREVIEW_SUFFIX` を、工房アカウントの workers.dev サブドメイン(例 `xxx.workers.dev`)に置き換える。未設定・空・`REPLACE-ME` を含むままだと `POST /api/agent/builds` は 503 を返す(他の API は動く)。工房アカウントができる段 5 までは builds だけ使えない。
3. マイグレーションを本番の D1 に適用する。

   ```bash
   pnpm exec wrangler d1 migrations apply trend-factory --remote
   ```

4. 合言葉を作って secret に登録する。値はどこにも保存せず、routine 環境の API credentials(`trend-factory-api.nakake.com`)にも同じ値を入れる。

   ```bash
   openssl rand -hex 32
   pnpm exec wrangler secret put AGENT_TOKEN
   ```

5. デプロイする。`wrangler.jsonc` の `routes` に `{ "pattern": "trend-factory-api.nakake.com", "custom_domain": true }` を入れてあるので、デプロイ時に Custom Domain(DNS レコードと証明書)が作られる。`nakake.com` のゾーンが同じアカウントにあることが必要。

   ```bash
   pnpm exec wrangler deploy
   ```

6. 確認する。

   ```bash
   export AGENT_TOKEN=...   # 手順 4 の値
   H="authorization: Bearer $AGENT_TOKEN"

   curl -i https://trend-factory-api.nakake.com/api/agent/ideas                 # 401
   curl -i https://trend-factory-api.nakake.com/                                # 404
   curl -s -H "$H" 'https://trend-factory-api.nakake.com/api/agent/trends?hours=24'   # 毎時 5 分の収集のあと、件数が増える
   curl -s -H "$H" -H 'content-type: application/json' -X POST https://trend-factory-api.nakake.com/api/agent/ideas \
     -d '[{"slug":"zz-smoke-test","title":"smoke test","summary":"s","sources":[],"scores":{"need":30,"demand":20,"fit":20,"novelty":3,"longevity":2},"total":75}]'
   curl -i -H "$H" -X POST https://trend-factory-api.nakake.com/api/agent/claim  # 200(1 回目)
   curl -i -H "$H" -X POST https://trend-factory-api.nakake.com/api/agent/claim  # 204(building が残っているので 2 回目は取れない)
   curl -i -H "$H" -H 'content-type: application/json' -X POST https://trend-factory-api.nakake.com/api/agent/release \
     -d '{"slug":"zz-smoke-test","outcome":"skip"}'                              # 200 {"slug":"zz-smoke-test","status":"skipped"}
   ```

7. 確認用の案を必ず消す(release で見送りにしてあっても、一覧に残るので消す)。building のまま残すと実装 routine を 6 時間止める。

   ```bash
   pnpm exec wrangler d1 execute trend-factory --remote --command "DELETE FROM ideas WHERE slug='zz-smoke-test'"
   pnpm exec wrangler d1 execute trend-factory --remote --command "SELECT kind, result, note FROM runs ORDER BY id DESC LIMIT 5"
   ```

## 変更を反映する

コードやマイグレーションを変えたら、本人が本体アカウントに反映する。マイグレーションを先に、デプロイを後にする(`0002_candidate_ttl.sql` を当てる前でも、`candidate_ttl_days` が無ければ既定の 21 日で動く)。

```bash
cd ~/project/trend-factory/infra/core
CLOUDFLARE_ACCOUNT_ID=d49004aee2b170cd870967a1a9cdc1d1 pnpm exec wrangler d1 migrations apply trend-factory --remote
CLOUDFLARE_ACCOUNT_ID=d49004aee2b170cd870967a1a9cdc1d1 pnpm exec wrangler deploy
```

## 設定の変更

`min_score`(既定 60)、`retention_days`(既定 400)、`candidate_ttl_days`(既定 21)は `settings` テーブルにある。数値として読めない値は既定値になり(ログにエラー)、`retention_days` は 30 未満なら 30 日、`candidate_ttl_days` は 1 未満なら 1 日として扱う。

`candidate_ttl_days` は、候補のまま claim されずに置かれる日数の上限。超えた案は次の claim のときに見送りになる。

```bash
pnpm exec wrangler d1 execute trend-factory --remote --command "UPDATE settings SET value='70' WHERE key='min_score'"
```

## ローカル

`pnpm -C infra test`(ローカルの D1 で動く。外部へは出ない)、`pnpm -C infra typecheck`。テスト用の合言葉は `vitest.config.ts` にあるテスト専用の値で、本物ではない。
