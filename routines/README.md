# routines

routine の手順書の正本を置く場所。

- `ideas.md`: 案出し routine の手順書(未作成)
- `build.md`: 実装 routine の手順書(未作成)

## 置き場と反映のしかた

- 正本はこのリポジトリ。routine に紐付けるのは `nakake/trend-factory-tools` だけなので、**routine はこのディレクトリを読めない**
- 手順書を変えたら、本人側が routine の設定(プロンプト)に本文を流し込む。ここを直しただけでは routine の動きは変わらない
- tools リポジトリに手順書を置かない。AI が書き換えられる場所に置くと、AI が自分の手順を変えられる。同じ理由で、tools リポジトリの `CLAUDE.md` や `.claude/` も使わない(公開スクリプトが検知して警告する)
- どの版で動いたかを追えるよう、routine は AI 用 API の runs の note に手順書の版を書ける(note は自由文)

## 手順書に書くこと(小物の制約)

公開スクリプトは、すべての小物に Content-Security-Policy を付けて公開する。`build.md` には次を書く。守らない小物は、公開しても動かない。

- スクリプトは同じ場所の `.js` ファイルに書く。インラインの `<script>`、`onclick=` などのイベント属性、`eval` は使えない
- スタイルは同じ場所の `.css` ファイルに書く。インラインの `<style>` と `style=` 属性は使えない
- 外部への通信はできない(`fetch`、外部の画像、フォント、CDN のライブラリ)。画像は同じ場所のファイルか `data:` だけ
- ファイル名は小文字の英数字と `.` `_` `-` で、先頭は英数字。拡張子は `.html .css .js .svg .png .jpg .webp .ico .json .txt`。テキストに NUL を入れない。画像は拡張子どおりの形式にする
- `.js` と `.css` は ASCII で書くと、公開のときの確認が早い(非 ASCII は機械検出に挙がり、絵文字などは `<U+XXXX>` と表示される)。日本語の文言は `.html` か `.json` に置く

設計は [../docs/design.md](../docs/design.md) の「routine の設定」と「公開物の制約(CSP)」を参照。
