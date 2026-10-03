# trend-factory-console

`console.nakake.com` の一覧ページ。D1 を読み取りでしか使わない(GET/HEAD 以外は 405)。Cloudflare Access の前段に加えて、Worker 自身も `Cf-Access-Jwt-Assertion` の JWT を検証する(RS256 署名、`aud`、`iss`、`exp`、`email`)。どれかが欠けると 403、下の vars が未設定のままだと全リクエスト 503。

## 本人がやる手順

1. core の手順(`../core/README.md`)が済んでいること。D1 `trend-factory` が存在し、マイグレーションが適用されている。
2. `wrangler.jsonc` の `d1_databases[0].database_id` を、`core/wrangler.jsonc` と同じ値にする。`vars.PREVIEW_SUFFIX` も core と同じ値にする(`REPLACE-ME` のままだと、プレビューはリンクにならず文字で出る)。
3. Cloudflare Zero Trust を有効にする(ダッシュボードの Zero Trust。無料プランは 50 人まで。支払い情報の登録が要る)。このとき決める team domain(`<名前>.cloudflareaccess.com`)を控える。
4. Access の Application を作る。Zero Trust > Access > Applications > Add an application > Self-hosted。
   - Application domain: `console.nakake.com`(パスは空で、ホスト全体を守る)
   - Policy: Action は Allow、Include は Emails で本人のメールアドレスだけ
   - 作成後、Application の概要にある Application Audience (AUD) Tag を控える
5. `wrangler.jsonc` の `vars` を埋める。
   - `ACCESS_TEAM_DOMAIN`: 手順 3 の team domain(`https://` なし)
   - `ACCESS_AUD`: 手順 4 の AUD タグ
   - `ALLOWED_EMAIL`: 手順 4 のポリシーと同じメールアドレス
6. デプロイする。`routes` の Custom Domain(DNS と証明書)はこのときに作られる。`workers.dev` と preview URL は無効にしてあり、Access が掛かるのは `console.nakake.com` だけ。

   ```bash
   cd ~/project/trend-factory/infra/console
   pnpm install
   pnpm exec wrangler deploy
   ```

7. 確認する。
   - ログインなしでブラウザから `https://console.nakake.com/` を開くと、Access のログイン画面になる
   - ログイン後(許可したメールアドレス)に一覧ページが出る
   - `curl -i https://console.nakake.com/` が Access のログイン画面へのリダイレクト(302、`Location` が `cloudflareaccess.com`)になる。Worker の 403/503 が直接返るなら、Access の Application が `console.nakake.com` に掛かっていない
   - 一覧ページが 503 のときは vars が未設定、403 のときは AUD・team domain・メールアドレスの不一致を疑う(`pnpm exec wrangler tail` に出る)

## ローカル

`pnpm -C infra test`、`pnpm -C infra typecheck`(core と console の両方を走らせる)。テストの Access 設定と RSA 鍵はテスト専用の値。
