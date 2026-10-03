# 運用メモ

骨組み段階。値がわからないものは TODO。

## トークンの期限と更新

- 工房アカウントのトークン(routine 環境の credentials): 期限 TODO。更新手順 TODO(段 5 で確認)
- デプロイ用トークン(GitHub の environment `production`、Workers Scripts Edit + 対象ゾーンの Workers Routes / DNS): 期限 TODO。権限の正確な組み合わせは段 4 で確認する
- AI 用 API の合言葉(`core` の secret と routine 環境の credentials): ローテーション手順 TODO

## 月次の棚卸し

- 閉じた PR と `claude/` ブランチを掃除する(routine が push できるのは `claude/` ブランチだけで、放っておくと残る)
- 見送った案(`ideas` の status が 見送り)を見直し、採点基準に反映するか決める
- 工房アカウントと本番の小物の数を確認する(Worker は無料枠で 100 個まで)

## cf CLI への移行

Cloudflare は 2026-09-28 に後継の CLI `cf` をオープンベータで出した。wrangler は cf のベータ終了後 18 か月サポートされる。

- CLI の呼び出しは `infra/` の package.json scripts、`.github/workflows/deploy-tool.yml`、`routines/build.md` の 3 か所に集めてある
- cf が GA になったら `cf migrate` で移す。手順 TODO(2026-10-03 時点で cf には `secret put` とログ取得が無く、設定ファイルは `cloudflare.config.ts`)

## 無料枠の確認

2026-10-03 時点で確認した値。変わっていないか定期的に見る。

- Workers Free: Cron はアカウントで 5 個、Worker は 100 個、1 回の実行で外部呼び出し 50 回、CPU 10ms。静的アセットの配信は無料でリクエスト数に数えない
- D1 Free: 1 DB 500MB、書き込み 1 日 10 万行。超えても課金されず止まる
- Access: 50 人まで無料
- 確認する場所と頻度 TODO
