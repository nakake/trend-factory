# trend-factory 設計(v3: リポジトリ分割)

トレンドから小さな Web ツールの案を AI が毎日出し、週 2〜3 回は AI が実装して Cloudflare にプレビューまで出す。本人は良いものだけ本番(独自ドメイン)に出す。要件は `docs/requirements.md`。

## 設計の経緯

- **v1 中継方式**: 本人が承認したプレビュー版を本番へ中継する。見たプレビューとレビューしたコードが別物になりうること、`*.tools.nakake.com` の証明書が無料プランで出ないことから差し戻し
- **v2 マージ承認**: 小物をこのリポジトリの `tools/` に置き、本人が PR をマージすると GitHub Actions が本番へ出す。「マージ = 本人の承認」が前提だった
- **v3 分割(この版)**: 2026-10-04 の実測で v2 の前提が誤りと分かった。routine は本人の資格情報で動き、PR のマージまでできる(テスト PR を AI がマージし、本番に出た)。小物を別リポジトリへ移し、本番公開は本人が手元の端末から行う形に変えた

## 設計の柱

1. **本番に出すのは、本人が端末で確認して実行したコミットだけ**。GitHub 上の操作(PR、マージ、push)は承認として扱わない。GitHub 上では AI と本人を区別できないため
2. **AI が書けるリポジトリには、本番に届くものを何も置かない**。本番のトークン、公開スクリプト、手順書の正本は AI が触れない側に置く
3. **AI の Cloudflare トークンはプレビュー専用アカウントに閉じ込める**。AI は外部サイトの文章を読んで動くので、紛れ込んだ指示に乗せられる可能性がある。トークンは「プレビューだけ可」に絞れないので、アカウントを分ける
4. **AI が本体側に書けるのは、決まった形の記録だけ**。AI 用 API は案と実行記録の追加しかできず、本番や承認に関わる操作は持たない

## 実測で分かった事実

### 2026-10-04(v3 の根拠)

- クラウドの routine は紐付けたリポジトリで本人として動く。PR の作成・マージ、`claude/` 以外のブランチへの push ができる。GitHub 上で AI と本人は区別できない
- Claude の GitHub App を `trend-factory-tools` だけに限定すると、routine から `trend-factory` への push は GitHub が拒否する
- routine はリポジトリの `CLAUDE.md` と `.claude/settings.json` の hook を自動で読む。tools リポジトリに仕込まれると、以後の実行すべてに効き続ける
- routine は allowed_tools を絞っても github MCP、claude-code-remote MCP、WebFetch、WebSearch、CronCreate、Artifact などを使える。ツールの制限を防御として当てにできない
- routine はリモートブランチを削除できない(403)。掃除は本人がやる
- API credentials のヘッダー注入は wrangler / cf のアセットアップロードと両立しない。アップロードは別の JWT を Authorization に使うため、注入で上書きされて 401 / 9106 になる。合言葉(`trend-factory-api.nakake.com`)の注入は動く
- 同梱ブラウザは `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` を playwright-core の `executablePath` に指定すると動く。`cdn.playwright.dev` は許可リスト外なので、ブラウザを新しく落とすことはできない
- クラウドから届く情報源: Google Trends RSS、HN の Firebase API と Algolia、Product Hunt のフィード
- `wrangler deployments list --json` のデプロイ側の `workers/message` は、メッセージ無しで公開した `tf-hello-tool` では `Automatic deployment on upload.` だった(wrangler 4.147.0)。`wrangler deploy --message` は help に「バージョンの説明」とある。どちらに付くかは、`--message` を付けた最初の公開のあとで確かめる
- git 2.43 は `git --attr-source=<空ツリー> diff` を受け付ける
- 未確認: wrangler 4.147.0 の静的アセットで `_headers` が効くか(`--dry-run` では読み込みまでしか分からない)。公開スクリプトが公開後に応答ヘッダーで確かめる

### 誤りだった前提(v2 まで)

- 「routine が push できるのは `claude/` で始まるブランチだけ」→ 誤り。どのブランチにも push でき、止まったのは ruleset で保護した main への直接 push だけ
- 「PR のマージが本人の承認」→ 誤り。AI もマージできる
- 「GitHub Actions で本番デプロイすれば、トークンは main からしか使えない」→ AI が workflow を変える PR を出して自分でマージできるので、守りにならない。Actions による本番デプロイは廃止した

### 変わっていない前提(2026-10-03)

- Cloudflare の API トークンは「プレビューは上げてよいが本番は不可」には絞れない(Workers Scripts Edit で両方できる)
- Workers Free: Cron はアカウントで 5 個、Worker は 100 個、1 回の実行で外部呼び出し 50 回、CPU 10ms。静的アセットの配信は無料でリクエスト数に数えない。D1 Free: 1 DB 500MB、書き込み 1 日 10 万行。超えても課金されず止まる
- Access は 50 人まで無料(支払い情報の登録は要る)
- 本番 URL は 1 階層の `tf-<slug>.nakake.com`。2 階層(`x.tools.nakake.com`)は無料の証明書が出ない

## 構成

### リポジトリ 2 つ

| | `nakake/trend-factory`(このリポジトリ、公開) | `nakake/trend-factory-tools`(非公開) |
|---|---|---|
| 中身 | `infra/`(core、console、公開スクリプト)、`routines/`(手順書の正本)、`docs/` | `tools/<slug>/`、`tools/_template/` |
| routine に紐付け | しない | する(これだけ) |
| Claude の GitHub App | 対象外 | 対象 |
| AI ができること | 何もできない(push は GitHub が拒否) | 何でも(push、PR、マージ) |
| 秘密 | 置かない | 置かない |
| Actions / Issues | workflow は無い | どちらも無効 |

```
trend-factory/
├── docs/                 requirements.md、design.md、operations.md
├── infra/
│   ├── core/             trend-factory-api.nakake.com。毎時 Cron で Google Trends RSS(JP)→ D1。/api/agent/* を合言葉で提供
│   ├── console/          trend-factory-console.nakake.com。Access で本人のみ。読み取り専用の一覧
│   └── scripts/          publish-tool.sh、unpublish-tool.sh、lib/(検査、検出、表示、配信)、test/
├── routines/             ideas.md、build.md の正本(routine からは読めない)
└── .github/CODEOWNERS

trend-factory-tools/
└── tools/
    ├── _template/        静的ファイルだけの雛形
    └── <slug>/           AI が作る小物(HTML/CSS/JS など。ビルドなし)
```

このリポジトリの main は ruleset で保護している(PR 必須、承認 0)。v2 で必須にしていた scope 検査は、検査ごと廃止したので外した。

### Cloudflare アカウント 2 つ

| | 本体アカウント(`nakake.com` あり) | プレビュー専用アカウント(工房) |
|---|---|---|
| アカウント ID | `d49004aee2b170cd870967a1a9cdc1d1` | `c6c43d5322dc59cb1f30f1378cb068d9` |
| 置くもの | `core`、`console`、D1、本番の小物 `tf-<slug>` | `preview` Worker 1 個だけ(`trend-factory-preview.workers.dev`) |
| デプロイする人 | 本人が WSL から wrangler で | AI が routine から |
| AI の権限 | AI 用 API の合言葉のみ | 工房トークン(Workers Scripts Edit) |

本人の wrangler ログインは両方のアカウントに属する。本人が打つコマンドでは必ず `CLOUDFLARE_ACCOUNT_ID` に本体の ID を指定する(公開スクリプトは `infra/scripts/config.sh` の値を自分で渡す)。

## 本番公開の流れ

1. AI: tools リポジトリの `claude/tool-<slug>` ブランチに実装して PR を作る。プレビューを工房アカウントに上げ、AI 用 API に builds(slug、preview_url、pr_url)を登録する
2. 本人: 一覧ページでプレビューと PR を見る。一覧ページには公開コマンドが文字で出る
3. 本人: WSL の端末で `pnpm -C infra publish-tool <slug> <PR番号>` を実行する
4. PR のマージは本人でも AI でもよい。マージしても何も公開されない

GitHub には本番のトークンを置かない。公開に使うのは本人の wrangler ログインだけ。

### 公開スクリプト(`infra/scripts/publish-tool.sh`)

AI が書いたものを本人の端末と本人の権限で扱うので、各段に理由がある。

| 段 | やること | 理由 |
|---|---|---|
| 入力 | 標準入力が端末でなければ終了。slug と PR 番号(`[1-9]` で始まる 7 桁まで)の形を検査 | 他のプログラムや AI のセッションから `yes \|` で確認を流し込めないようにする |
| PR | `gh pr view` で SHA、ブランチ名、base、フォークかどうかだけを取る。base が main、フォークでない、ブランチが `claude/tool-<slug>` であること | タイトルと本文は AI が書く文字列で、端末に出すと表示を偽装されうるので取得しない |
| 取得 | キャッシュ(`~/.cache/trend-factory/tools.git`)に、その SHA と default branch を `--depth=1`、`transfer.fsckObjects=true` で fetch。以後は SHA だけを使う | ブランチ名を引き直すと、確認中に push された別のコミットを公開しうる。履歴は要らない。細工されたオブジェクトは受け取る時点で落とす |
| 検査 | `lib/check-tool-tree.sh`。モードは 100644 だけ、各パス要素は `^[a-z0-9][a-z0-9._-]*$`、拡張子は `.html .css .js .svg .png .jpg .webp .ico .json .txt`、`index.html` があること、50 ファイル以下、合計 5MB 以下。テキスト(`.html .css .js .svg .json .txt`)に NUL が無いこと、画像(`.png .jpg .webp .ico`)の先頭バイトが拡張子と合うこと。違反が 20 件で打ち切る | シンボリックリンクは手元のファイルを公開しうる。先頭が `.` と `_` の名前は Cloudflare 側で特別な意味を持つ(`_headers` `_redirects` `.assetsignore` `.well-known`)。NUL があると差分が「Binary files differ」になって中身が隠れる。中身が HTML や JS の「偽の画像」は、読まずに通してしまう |
| 検知 | `lib/find-agent-files.sh`。PR のコミットと default branch のツリー全体から、basename が `CLAUDE.md` `CLAUDE.local.md` `AGENTS.md` `.mcp.json` のもの、パスに `.claude/` `.github/` を含むもの、ルートの `.gitattributes` `.gitmodules` `.lfsconfig` を探し、あれば警告して続けるか聞く。default branch が main でないこと自体も警告する | routine への指示が仕込まれた可能性がある。サブディレクトリの CLAUDE.md も、そこで作業すれば読まれる |
| 展開 | 検査済みの (パス, blob) の一覧から `git cat-file blob` で 1 つずつ書き、`git hash-object` で突き合わせる | `git archive` や checkout はツリー内の `.gitattributes`(export-subst、改行変換)に従うので、検査した中身と違うものが出うる |
| 機械検出 | `lib/scan-tool.py`。外部 URL、通信(`fetch(` など)、文字列の実行(`eval(` など)、難読化(`atob`、長い base64 風の連続)、`<iframe` `<form` `data:` `on...=` などの書き方、500 文字を超える行、非 ASCII を含む .js / .css を、規則ごとにファイル名・件数・最初の行番号で要約する。ページャの前と、slug の入力の前に出す | 読む場所を示す。誤検出は多く、これで止めはしない。要約には中身を出さない |
| ヘッダー | 展開先のルートに `_headers` を生成する(下の「公開物の制約」) | 読み落としがあっても、外部への通信とインラインのスクリプトをブラウザ側で止める |
| 前回 | `wrangler deployments list --json` の最新デプロイから `sha=<sha>` を探す。デプロイ側に無ければ、そのバージョンを `wrangler versions view` で見る。どちらにも無ければ初回と同じ扱い(全文表示)。Worker が無い(10007)なら未公開、それ以外の失敗は中止 | 差分で見せるため。「調べられなかった」を未公開と取り違えると、上書きの警告が抜ける |
| 表示 | ファイル一覧と、前回からの差分(無ければテキスト全文)をページャで。差分は `--text`、属性の読み取り元は空ツリー。全文は各行に `\| ` を前置。通す文字を決め(ASCII、ひらがな、カタカナ、漢字、全角の記号と英数)、それ以外は `<U+XXXX>` に置き換える。ページャは `LESS= LESSSECURE=1 less -FX` | ESC、CR、双方向制御文字、見えない文字で、読んでいる中身を偽装されないようにする。区切り行を中身で偽造できないようにする |
| 試す | `lib/preview-server.py` で 127.0.0.1 の空きポートから配信し、Enter を待つ。本番と同じ CSP を付け、ディレクトリ一覧は出さず、アクセスログを端末に出す。起動に失敗したら中止 | 見たものと本番で挙動が同じになるようにする |
| 確認 | slug を入力させ、一致したときだけ進む。公開済みなら上書きと明示 | y の連打で通らないようにする |
| 公開 | wrangler の設定を一時ディレクトリに生成(`account_id`、名前 `tf-<slug>`、assets のみ、Custom Domain `tf-<slug>.nakake.com`、`workers_dev` と `preview_urls` は false)し、ロックファイルで固定した wrangler で deploy。`--message "sha=<sha> pr=<PR>"` を付ける。wrangler の全コマンドにこの設定を `--config` で渡す | wrangler は cwd から親へ設定を探し、設定の `account_id` は環境変数より強い。上位に置かれた設定で別のアカウントに向かないようにする。npx でその時点の最新版を取ってこない |
| 確かめる | `https://tf-<slug>.nakake.com/` が 200 で、応答に Content-Security-Policy があること。無ければ目立つ警告を出して異常終了 | `_headers` が効いていない公開に気づけるようにする |

小物側の `npm install` やスクリプトは実行しない。取り下げは `pnpm -C infra unpublish-tool <slug>`(端末必須、slug を再入力。wrangler 自身の確認は飛ばさない)。

### 公開物の制約(CSP)

公開スクリプトは、すべての小物に次のヘッダーを付ける。小物の側は `_` で始まるファイルを置けないので、上書きできない。

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

小物は次の前提で作る。手順書(`routines/build.md`)にも書く。

- スクリプトは同じ場所の `.js` ファイルから読む。インラインの `<script>`、`onclick=` などのイベント属性、`eval` は動かない
- スタイルは同じ場所の `.css` ファイルから読む。インラインの `<style>` と `style=` 属性は動かない
- 外部への通信(`fetch`、画像、フォント、CDN のライブラリ)は動かない。画像は同じ場所のファイルか `data:` だけ
- 他のサイトに埋め込めない(`frame-ancestors 'none'`)

### プレビュー(工房アカウント)

- Worker は `preview` 1 個だけ。AI は `wrangler versions upload --preview-alias <slug>` で上げ、URL は `<slug>-preview.trend-factory-preview.workers.dev`。Worker 数の上限(100)に当たらず、後片付けも要らない
- プレビューは URL を知っていれば誰でも開ける。本番の検索結果には出ない

## routine の設定

routine は 2 本で、環境も 2 つに分ける。案出しは外部の文章を大量に読むので、乗せられても届く先が無いようにする。

| | 案出し(毎日 7:00 JST) | 実装(月・水・金 9:00 JST) |
|---|---|---|
| 手順書 | `routines/ideas.md` | `routines/build.md` |
| sources(リポジトリ) | 無し | `nakake/trend-factory-tools` だけ |
| API credentials | `trend-factory-api.nakake.com` の合言葉 | 同じ |
| 環境変数 | 無し(工房トークンを渡さない) | `CLOUDFLARE_API_TOKEN`(工房トークン)、`CLOUDFLARE_ACCOUNT_ID`(工房アカウント) |
| 外に出せるもの | AI 用 API への案と実行記録だけ | tools リポジトリへの push と PR、プレビュー、AI 用 API |

- 合言葉はヘッダー注入なので、セッションからは値が見えない
- 工房トークンは、credentials の注入がアセットアップロードと両立しないので環境変数で渡す。つまり **実装側のセッションからは見える**。届くのはプレビュー専用アカウントだけ
- 手順書はこのリポジトリが正本。routine はこのリポジトリを読めないので、本人側が routine の設定(プロンプト)に流し込む。`routines/README.md` を参照
- モデルは sonnet

流れ:

1. **案出し**: HN(Algolia の API)と Product Hunt のフィード、AI 用 API のトレンドと直近 60 日の案を取得 → 採点 → 新しい案だけ登録(最大 5 件。材料が無ければ登録しない)。取得結果は見出しなどの決まった項目だけを表示し、本文などの自由文を文脈に入れない
2. **実装**: 指示ファイルの検出 → claim → `tools/<slug>/` に実装 → 同梱ブラウザで確認(本番と同じ CSP を付けて配信) → プレビューに上げる → PR → builds 登録。作るべきでない案は release(skip)、技術的な失敗は release(retry)で手放す

## D1(本体アカウント)

- `trends(term, day_jst, traffic, news_json, first_seen, last_seen)`、`UNIQUE(term, day_jst)`。UPSERT で traffic は大きいほうを残す
- `ideas(id, slug UNIQUE, title, summary, sources_json, scores_json, total, status, attempts, claimed_at, created_at)`。status は candidate / building / built / skipped(表示側で 候補 / 実装中 / 実装済み / 見送り)。slug は `^[a-z][a-z0-9-]{1,38}[a-z0-9]$`。attempts は claim ごとに +1
- `builds(slug, preview_url, pr_url UNIQUE, created_at)`
- `runs(id, kind, started_at, finished_at, result, note)`。毎時 1 行増えるので、JST 0 時台の削除で `retention_days` より古い行も消す
- `settings(key, value)`: `retention_days`(保存日数、400)、`min_score`(実装する最低点、60)、`candidate_ttl_days`(候補のまま置く日数、21。`0002_candidate_ttl.sql` で追加)

## AI 用 API(`core`、`Authorization: Bearer <合言葉>`)

合言葉が無い・違うときは 401。本文が JSON でない、形が違うときは 400(本文は `{"error":[...]}`)。

| 呼び出し | 成功 | それ以外 |
|---|---|---|
| `GET /api/agent/trends?hours=24&limit=100` | 200 `{"trends":[{term, day_jst, traffic, news, ...}]}`。news は見出しだけを 3 本まで | |
| `GET /api/agent/ideas?days=60` | 200 `{"ideas":[{slug, title, status, total, created_at}]}`。summary は返さない | |
| `POST /api/agent/ideas`(配列、1〜20 件) | 201 `{"inserted":[...],"skipped":[...]}`。skipped は slug が重複したもの | 409 全件が重複 / 400 検証エラー(1 件でもあれば全体を入れない) / 429 直近 24 時間で 40 件を超える |
| `POST /api/agent/claim`(本文なし) | 200 `{"idea":{id, slug, title, summary, scores, total, status, attempts, claimed_at, created_at}}`。sources は返さない | 204 候補が無い、または実装中の案がある |
| `POST /api/agent/release` `{"slug","outcome":"retry"\|"skip"}` | 200 `{"slug","status":"candidate"\|"skipped"}` | 409 その案が実装中でない / 400 |
| `POST /api/agent/builds` `{"slug","preview_url","pr_url"}` | 201 `{"ok":true}`。案を 実装済み にする | 409 案が実装中でない、または登録済み / 400 URL の形が違う / 429 直近 24 時間で 5 件 / 503 `PREVIEW_SUFFIX` 未設定 |
| `POST /api/agent/runs` 開始 `{"kind","result":"started","note"}` | 201 `{"id"}` | 429 直近 24 時間で 60 件 / 400 |
| `POST /api/agent/runs` 終了 `{"kind","id","result","note"}` | 200 `{"id"}` | 409 その id が無い、または終了済み / 400 |

- **ideas の検証**: slug は `^[a-z][a-z0-9-]{1,38}[a-z0-9]$`。title は 100 字、summary は 2000 字まで。scores のキーは `need` `demand` `fit` `novelty` `longevity` の 5 つちょうどで、上限は 30 / 25 / 25 / 10 / 10、各 0 以上の整数。total は 5 項目の合計と一致。sources は `https://news.ycombinator.com/item?id=<数字>` か `https://www.producthunt.com/` で始まる URL だけ、最大 5 件、空でもよい。文字列は制御文字と見えない文字を弾く(summary と note は改行だけ可。タブと CR は不可)。採点欄と sources を自由にすると、任意の文字列やリンクを一覧ページと実装側へ運ぶ経路になるので、形を決めている
- **claim の動き**: 1 回の呼び出しで順に、(1) 6 時間たっても 実装中 のものを 候補 に戻す(attempts が 3 以上なら 見送り)、(2) 作成から `candidate_ttl_days`(既定 21 日)を超えた 候補 を 見送り にする、(3) 実装中 が 1 件も無ければ、最低点(`min_score`、既定 60)以上の 候補 から 1 件を 実装中 にして返す。並びは `total DESC, created_at DESC, id DESC`(同点は新しい案から)。attempts は claim ごとに +1
- **release**: 実装側が、取った案を自分から手放す。`retry` は 候補 に戻す(attempts が 3 以上なら 見送り)。`skip` はすぐ 見送り。どちらも claimed_at を消す。作れない案や指示が紛れた案が、6 時間の期限切れを 3 回待つあいだパイプラインを塞がないようにする
- **builds**: preview_url は `https://<slug>-preview.<PREVIEW_SUFFIX>`、pr_url は `^https://github\.com/nakake/trend-factory-tools/pull/[1-9]\d{0,6}$` だけ
- **runs**: kind は `ideas` / `build`、result は `started` / `ok` / `failed` / `noop`。note は 1000 字までの自由文(routine が手順書の版を書く)
- 本番・承認に関わる操作は持たない

## 一覧ページ(`console`)

- 案(採点つき)、小物ごとのプレビュー / PR / 本番 URL / 公開コマンド、routine の最後の成功時刻と失敗、D1 の行数
- 公開コマンドは、slug が正しい形で、pr_url が上の正規表現を通った行にだけ出す。PR 番号はその pr_url から取る
- 読み取り専用。外部由来の文章はすべてエスケープ、CSP は `default-src 'none'`(スクリプトなし)、リンクは許可した形の URL だけ。Access の前段に加えて Worker も JWT を検証する

## 秘密情報の置き場

| 秘密 | 置き場 | 見える範囲 |
|---|---|---|
| 本番のデプロイ権限 | 本人の WSL の wrangler ログイン | 本人だけ。GitHub にも routine にも無い |
| AI 用 API の合言葉 | `core` の secret、routine 環境の API credentials | routine のセッションからは値が見えない |
| 工房トークン | routine 環境の環境変数 | routine のセッションから見える |
| Access の設定 3 つ | `console` の secret | 本人だけ |

リポジトリには何も置かない。コミットのメールは noreply。

## CLI

Cloudflare は 2026-09-28 に後継の CLI `cf` をオープンベータで出した。wrangler は cf のベータ終了後 18 か月サポートされる。本体側は wrangler 4.147.0 に固定している。CLI の呼び出しは `infra/scripts/`、`infra/` の README、`routines/build.md` に集め、cf が GA になったら移す(`docs/operations.md`)。

## 残るリスク

- **AI が tools リポジトリを壊す・荒らす**: 本番には出ない。履歴から戻せる
- **tools リポジトリに routine への指示が仕込まれる**(`CLAUDE.md`、`.claude/`、`.mcp.json`): 以後の実行に効き続ける。公開スクリプトと月次の棚卸しで検知する。検知は公開のときと棚卸しのときだけで、仕込まれてから見つけるまでの実行には効いてしまう。見るのは PR のコミットと default branch で、他のブランチは見ていない
- **工房トークンの漏えい**: プレビュー専用アカウントで第三者がページを公開できる。本番・D1・一覧ページには届かない。ローテーションで対処(`docs/operations.md`)
- **本人が中身を読まずに公開する**: 仕組みでは防げない。スクリプトは差分か全文を必ず見せ、手元で動かす段を挟む
- **公開する小物そのものの悪意**: 外部への通信とインラインのスクリプトは CSP で止める(`_headers` が効いている前提。公開後に確かめる)。同じ場所の中で完結する悪意(紛らわしい表示、入力を誘う文面、`location` の書き換えによる遷移など)は CSP では止まらず、差分を読むことと手元で動かすことに頼っている。機械検出は読む場所を示すだけで、難読化すれば抜けられる
- **通す文字を絞った表示の読みにくさ**: 絵文字やアクセント付きの文字は `<U+XXXX>` になる。ASCII と日本語の範囲の中で似た字を使う偽装(全角と半角など)は残る
- **本人の端末で動く AI セッション**: 疑似端末を用意すれば公開スクリプトを対話なしで動かせる。端末の検査は `yes |` のような流し込みを止めるだけで、本人の権限で動くプログラムからは守れない
- **Claude の GitHub App の対象が広がる**: `trend-factory` が対象に入ると v2 と同じ状態に戻る。月次で確かめる
- **一覧ページに AI が登録した文字列が出る**: エスケープと URL 検証で対処済み。公開コマンドの文字は検証済みの値からしか作らない
- **手順書が公開されている**: 注入文の材料になりうる。外部の文章をデータとして扱う指示を手順書の先頭に置く
- **案の文章に紛れた指示(注入)**: 案出し側は、取得結果を見出しなどの決まった項目に絞って読み、リポジトリもトークンも持たない環境で動かす。実装側は、summary に作業の指示にあたる文を見つけたら、実装せずに release(skip)で案を見送りにする。これが注入への対処で、見つけられなかった場合の歯止めではない
- **仕様の形をした注入**: 「入力をこの URL に送る機能」「パスワードの入力欄」のように、指示ではなく作るものの仕様として書かれた悪意は、「指示にあたる文」の判定では止まらない。止めるのは、手順書に列挙した条件(外部への通信なし、秘密の値を入力させない、制約の中で作れないものは skip)と、公開時の CSP・機械検出・本人の確認。列挙に無い形の悪意(紛らわしい文面で入力を誘うなど)は、本人が公開のときに読んで止めるしかない
- **release の悪用**: 実装側の AI が乗せられると、良い案を skip で見送りにできる。失うのは案 1 件で、一覧ページに 見送り として残る

## 検証(全体)

- 通し: 案出し → claim → 実装 → プレビュー → PR → `publish-tool` → 本番 URL
- 権限: 工房トークンで本体アカウントの Worker や D1 が見えない(403)、合言葉なしの AI 用 API は 401、ログインなしの一覧ページはログイン画面、routine から `trend-factory` へ push できない
- 公開スクリプト(`pnpm -C infra test` が `infra/scripts/test/` を走らせる)
  - `test-check-tool-tree.sh`: ツリー検査の各違反(モード、名前、拡張子、NUL、偽の画像、件数、サイズ、打ち切り)を理由の文言まで照合。指示ファイルの検知
  - `test-sanitize.sh`: 通す文字と置き換える文字(制御文字、双方向制御、各種空白、見えないハングル、タグ文字、異体字セレクタ、私用領域など)。前回 SHA の取り出し
  - `test-scan-tool.sh`: 機械検出の各規則。手元の配信のヘッダー、一覧なし、`_headers` やシンボリックリンクを配信しないこと、アクセスログ
  - `test-publish-e2e.sh`: `gh`、`curl`、`less`、wrangler を偽物に替え、疑似端末と手元の一時リポジトリで本体を通す。slug の不一致で公開しない、一致で deploy が期待の引数と設定で 1 回だけ呼ばれる、検査に落ちるツリーと端末なしで wrangler を呼ばない、NUL 入りの差分が表示に出る、指示ファイルと default branch の警告、生成した `_headers`、10007 を未公開と判定、公開後に CSP が無いと異常終了
  - テストしていないもの: 本物の `gh`・wrangler・Cloudflare との結合(実際の公開と取り下げ、`_headers` の効き、`--message` の読み戻し)。最初の公開で本人が確かめる
- 失敗系: 候補が 0 件や最低点未満のときに実装 routine が何もせず終わる、実装中のまま 6 時間たった案が候補に戻る、一覧ページに失敗が出る
