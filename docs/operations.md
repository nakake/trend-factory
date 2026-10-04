# 運用メモ

コマンドは WSL の端末で、`~/project/trend-factory` から実行する。本人の wrangler ログインは本体とプレビュー専用の 2 アカウントに属するので、wrangler を直接打つときは必ず `CLOUDFLARE_ACCOUNT_ID` を指定する。

- 本体アカウント: `d49004aee2b170cd870967a1a9cdc1d1`
- プレビュー専用アカウント(工房): `c6c43d5322dc59cb1f30f1378cb068d9`

## 小物を公開する

前提: `pnpm -C infra install` 済み、`gh auth setup-git` 済み(非公開の tools リポジトリを https で取るため)。環境変数 `TF_TOOLS_GIT_URL` はテスト用の差し替え口なので、設定しない(設定されていると、スクリプトが最初に注意を出す)。

1. 一覧ページ(`trend-factory-console.nakake.com`)でプレビューを開き、公開コマンドを写す
2. 実行する。AI のセッションや他のプログラムからは動かさない(標準入力が端末でないと止まる)

   ```bash
   pnpm -C infra publish-tool <slug> <PR番号>
   ```

3. スクリプトの表示を順に確かめる
   - 検査で落ちたら、理由が出て終わる。公開はされない
   - 「routine への指示が仕込まれた可能性がある」という警告が出たら、心当たりが無い限り N で止め、tools リポジトリの該当ファイルを調べる
   - 「機械検出の要約」が出る。外部 URL、`fetch(`、`eval(`、長い base64 風の文字列などの書き方を、ファイル名と行番号で挙げたもの。誤検出も多いので、挙がった行をページャで読んで判断する
   - ファイル一覧と、前回公開からの差分(初回や前回が分からないときは全文)がページャで出る。全文のときは中身の行が `| ` で始まる。`<U+001B>` や `<U+202E>` のような記号は、ASCII と日本語以外の文字を置き換えたもの。制御文字や見えない文字のほか、絵文字やアクセント付きの文字もこうなる
   - `http://127.0.0.1:<ポート>/` をブラウザで開いて動かす。本番と同じ CSP が付くので、ここで動かないものは本番でも動かない。端末にアクセスログが出る。開発者ツールのコンソールに CSP の違反が出ていないかも見る
4. slug を入力すると公開される。「上書き」と出たときは、公開済みのものを置き換える
5. 最後に `https://tf-<slug>.nakake.com/` が 200 で、応答に Content-Security-Policy があるかを確かめて URL が出る。「Content-Security-Policy が無い」という警告が出たら、外部への通信が止まらない状態で公開されている。取り下げてから原因(wrangler の `_headers` の扱い)を調べる。初回は証明書が出るまで時間がかかることがあり、スクリプトは 1 分ほど待つ。それでも 200 にならなければ、少し置いてブラウザで開き直す

PR のマージは公開と関係ない。残すなら公開後にマージし、不要なら閉じる。

## 小物を取り下げる

```bash
pnpm -C infra unpublish-tool <slug>
```

slug を再入力し、続けて wrangler 自身の確認に答えると、Worker `tf-<slug>` と Custom Domain が消える。tools リポジトリのコードは残る。

## 工房トークンのローテーション

工房トークンは routine のセッションから見える。漏れた疑いがあるときと、期限が切れる前に替える。

1. Cloudflare のダッシュボードでプレビュー専用アカウントに切り替え、Account API Tokens で新しいトークンを作る。権限は Workers Scripts Edit と Account Settings Read だけ。期限を付ける
2. routine の環境 `trend-factory` の環境変数 `CLOUDFLARE_API_TOKEN` を新しい値にする。`CLOUDFLARE_ACCOUNT_ID` は工房の ID のまま
3. 実装 routine を手動で 1 回動かし、プレビューが上がることを確かめる
4. 古いトークンを Cloudflare 側で削除する
5. 漏えいが疑われるときは、工房アカウントの `preview` Worker のバージョン一覧に見覚えのないものが無いかも見る

   ```bash
   CLOUDFLARE_ACCOUNT_ID=c6c43d5322dc59cb1f30f1378cb068d9 pnpm -C infra/core exec wrangler versions list --name preview
   ```

AI 用 API の合言葉を替えるときは、`openssl rand -hex 32` で作り、`infra/core` で `CLOUDFLARE_ACCOUNT_ID=<本体> pnpm exec wrangler secret put AGENT_TOKEN`、続けて routine 環境の API credentials(`trend-factory-api.nakake.com`)を同じ値にする。

## 月次の棚卸し

- **tools リポジトリの不要ブランチを消す**。routine はリモートブランチを削除できない(403)ので、放っておくと残り続ける

  ```bash
  gh api repos/nakake/trend-factory-tools/branches --paginate --jq '.[].name'
  git -C ~/project/trend-factory-tools push origin --delete <ブランチ名>
  ```

- **tools の main に `CLAUDE.md` / `.claude` / `.mcp.json` / `.github` が無いか**。routine はこれらを自動で読むので、仕込まれると以後の実行に効き続ける。サブディレクトリも含めて探す。何も出なければよい。default branch が main のままかも見る

  ```bash
  git -C ~/project/trend-factory-tools fetch origin
  bash infra/scripts/lib/find-agent-files.sh ~/project/trend-factory-tools/.git origin/main
  gh api repos/nakake/trend-factory-tools --jq .default_branch
  ```

- **routine の一覧に見覚えのないものが無いか**。routine は CronCreate などを使えるので、自分で増やしていないかを見る
- **Claude の GitHub App の対象が `trend-factory-tools` だけのままか**。GitHub の Settings > Applications > Installed GitHub Apps > Claude > Repository access。`trend-factory` が入っていたら外す
- 見送った案(`ideas` の status が 見送り)を見直し、採点基準に反映するか決める
- 本番の小物の数を確認する(Worker は無料枠で 100 個まで)。不要なものは取り下げる

## cf CLI への移行

Cloudflare は 2026-09-28 に後継の CLI `cf` をオープンベータで出した。wrangler は cf のベータ終了後 18 か月サポートされる。

- CLI の呼び出しは `infra/scripts/`(公開と取り下げ)、`infra/core` と `infra/console` の README(本人が打つコマンド)、`routines/build.md`(AI のプレビュー上げ)に集めてある
- cf が GA になったら `cf migrate` で移す。手順 TODO(2026-10-03 時点で cf には `secret put` とログ取得が無く、設定ファイルは `cloudflare.config.ts`)
- 公開スクリプトは wrangler の JSON 出力(`deployments list --json`、`versions view --json`)の形、存在しない Worker のエラーコード(10007)、静的アセットの `_headers` の扱いに依存している。移行や wrangler の更新のときは `infra/scripts/lib/` と合わせて確かめる

## 無料枠の確認

2026-10-03 時点で確認した値。変わっていないか定期的に見る。

- Workers Free: Cron はアカウントで 5 個、Worker は 100 個、1 回の実行で外部呼び出し 50 回、CPU 10ms。静的アセットの配信は無料でリクエスト数に数えない
- D1 Free: 1 DB 500MB、書き込み 1 日 10 万行。超えても課金されず止まる
- Access: 50 人まで無料
- 確認する場所と頻度 TODO
