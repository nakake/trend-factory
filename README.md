# trend-factory

トレンドから小さな Web ツールの案を AI が毎日出し、週 2〜3 回は AI が実装して Cloudflare にプレビューまで出す仕組み。

- 案出しと実装は Claude Code の routine が行い、AI が書き込めるのは `tools/<slug>/` の静的ファイルだけ
- 本番に出るのは、本人が PR の差分を読んでマージした main のコードだけ(GitHub Actions がデプロイする)
- AI の Cloudflare トークンはプレビュー専用アカウントに閉じ込めてある
- トレンド収集と一覧ページは `infra/`(段 2 以降で作る)

要件は [docs/requirements.md](docs/requirements.md)、設計は [docs/design.md](docs/design.md)、運用手順は [docs/operations.md](docs/operations.md) を参照。
