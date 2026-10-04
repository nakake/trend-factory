# trend-factory

トレンドから小さな Web ツールの案を AI が毎日出し、週 2〜3 回は AI が実装して Cloudflare にプレビューまで出す仕組み。

- 案出しと実装は Claude Code の routine が行う。AI が書けるのは別リポジトリ `nakake/trend-factory-tools`(非公開)だけで、このリポジトリには push できない
- 本番に出るのは、本人が WSL の端末で `pnpm -C infra publish-tool <slug> <PR番号>` を実行し、中身を確かめたコミットだけ。PR のマージでは何も公開されず、GitHub に本番のトークンは置かない
- AI の Cloudflare トークンはプレビュー専用アカウントに閉じ込めてある
- このリポジトリにあるのは、トレンド収集と AI 用 API(`infra/core`)、一覧ページ(`infra/console`)、公開スクリプト(`infra/scripts`)、routine の手順書の正本(`routines/`)

要件は [docs/requirements.md](docs/requirements.md)、設計は [docs/design.md](docs/design.md)、運用手順は [docs/operations.md](docs/operations.md) を参照。
