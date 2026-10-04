# routines

routine の手順書の正本を置く場所。

- `ideas.md`: 案出し routine の手順書(未作成)
- `build.md`: 実装 routine の手順書(未作成)

## 置き場と反映のしかた

- 正本はこのリポジトリ。routine に紐付けるのは `nakake/trend-factory-tools` だけなので、**routine はこのディレクトリを読めない**
- 手順書を変えたら、本人側が routine の設定(プロンプト)に本文を流し込む。ここを直しただけでは routine の動きは変わらない
- tools リポジトリに手順書を置かない。AI が書き換えられる場所に置くと、AI が自分の手順を変えられる。同じ理由で、tools リポジトリの `CLAUDE.md` や `.claude/` も使わない(公開スクリプトが検知して警告する)
- どの版で動いたかを追えるよう、routine は AI 用 API の runs の note に手順書の版を書ける(note は自由文)

設計は [../docs/design.md](../docs/design.md) の「routine の設定」を参照。
