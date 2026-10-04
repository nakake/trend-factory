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
- `wrangler deploy --message` の文字列はバージョン側に付く。`wrangler deployments list --json` のデプロイ側の `workers/message` は、メッセージ無しで公開した `tf-hello-tool` では `Automatic deployment on upload.` だった(wrangler 4.147.0)

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
│   └── scripts/          publish-tool.sh、unpublish-tool.sh、lib/、test/
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
| 入力 | 標準入力が端末でなければ終了。slug と PR 番号の形を検査 | 他のプログラムや AI のセッションから `yes \|` で確認を流し込めないようにする |
| PR | `gh pr view` で SHA、ブランチ名、base、フォークかどうかだけを取る。base が main、フォークでない、ブランチが `claude/tool-<slug>` であること | タイトルと本文は AI が書く文字列で、端末に出すと表示を偽装されうるので取得しない |
| 取得 | キャッシュ(`~/.cache/trend-factory/tools.git`)にその SHA を fetch。以後は SHA だけを使う | ブランチ名を引き直すと、確認中に push された別のコミットを公開しうる |
| 検査 | `lib/check-tool-tree.sh`。モードは 100644 だけ、各パス要素は `^[a-z0-9][a-z0-9._-]*$`、拡張子は `.html .css .js .svg .png .jpg .webp .ico .json .txt`、`index.html` があること、50 ファイル以下、合計 5MB 以下 | シンボリックリンクは手元のファイルを公開しうる。`_headers` `_redirects` `.assetsignore` `.well-known` などは Cloudflare 側で特別な意味を持つので、先頭が `.` と `_` の名前を一律に落とす |
| 検知 | コミットのルートと tools の main のルートに `CLAUDE.md` `CLAUDE.local.md` `AGENTS.md` `.claude` `.mcp.json` `.github` があれば警告し、続けるか聞く | routine への指示が仕込まれた可能性がある |
| 前回 | `wrangler deployments list --name tf-<slug> --json` の最新デプロイから `sha=<sha>` を探す。デプロイ側に無ければ、そのバージョンを `wrangler versions view` で見る。どちらにも無ければ初回と同じ扱い(全文表示) | 差分で見せるため |
| 表示 | ファイル一覧と、前回からの差分(無ければテキスト全文)をページャで。制御文字は可視の文字に置き換える | ESC、CR、双方向制御文字で、読んでいる中身を偽装されないようにする |
| 試す | その SHA の `tools/<slug>/` を一時ディレクトリに展開し、127.0.0.1 の空きポートで配信して Enter を待つ。展開したファイルは blob のハッシュと突き合わせる | `git archive` はツリー内の `.gitattributes` に従うので、見せた中身と違うものが出ないようにする |
| 確認 | slug を入力させ、一致したときだけ進む。公開済みなら上書きと明示 | y の連打で通らないようにする |
| 公開 | wrangler の設定を一時ディレクトリに生成(名前 `tf-<slug>`、assets のみ、Custom Domain `tf-<slug>.nakake.com`、`workers_dev` と `preview_urls` は false)し、ロックファイルで固定した wrangler で deploy。`--message "sha=<sha> pr=<PR>"` を付ける | 小物側の設定で他のホストを乗っ取れないようにする。npx でその時点の最新版を取ってこない |
| 確かめる | `https://tf-<slug>.nakake.com/` が 200 を返すこと | |

小物側の `npm install` やスクリプトは実行しない。取り下げは `pnpm -C infra unpublish-tool <slug>`(端末必須、slug を再入力)。

### プレビュー(工房アカウント)

- Worker は `preview` 1 個だけ。AI は `wrangler versions upload --preview-alias <slug>` で上げ、URL は `<slug>-preview.trend-factory-preview.workers.dev`。Worker 数の上限(100)に当たらず、後片付けも要らない
- プレビューは URL を知っていれば誰でも開ける。本番の検索結果には出ない

## routine の設定

- **sources**: `nakake/trend-factory-tools` だけ。このリポジトリは紐付けない
- **API credentials**: `trend-factory-api.nakake.com` の合言葉だけ(ヘッダー注入。セッションからは値が見えない)
- **環境変数**: `CLOUDFLARE_API_TOKEN`(工房トークン)と `CLOUDFLARE_ACCOUNT_ID`(工房アカウント)。credentials の注入がアセットアップロードと両立しないので環境変数で渡す。つまり **工房トークンはセッションから見える**。届くのはプレビュー専用アカウントだけ
- **手順書**: `routines/ideas.md`、`routines/build.md` はこのリポジトリが正本。routine はこのリポジトリを読めないので、本人側が routine の設定(プロンプト)に流し込む。`routines/README.md` を参照
- モデルは sonnet

1. **案出し(毎日 7:00 JST)**: HN と Product Hunt のフィードを取得、AI 用 API からトレンドと直近 60 日の案を取得 → 採点 → 新しい案だけ登録
2. **実装(月・水・金 9:00 JST)**: claim → tools リポジトリの `tools/<slug>/` に実装 → 同梱ブラウザで確認 → プレビューに上げる → PR → builds 登録。失敗したら runs に記録

## D1(本体アカウント)

- `trends(term, day_jst, traffic, news_json, first_seen, last_seen)`、`UNIQUE(term, day_jst)`。UPSERT で traffic は大きいほうを残す
- `ideas(id, slug UNIQUE, title, summary, sources_json, scores_json, total, status, attempts, claimed_at, created_at)`。status は candidate / building / built / skipped(表示側で 候補 / 実装中 / 実装済み / 見送り)。slug は `^[a-z][a-z0-9-]{1,38}[a-z0-9]$`。attempts は claim ごとに +1
- `builds(slug, preview_url, pr_url UNIQUE, created_at)`
- `runs(id, kind, started_at, finished_at, result, note)`。毎時 1 行増えるので、JST 0 時台の削除で `retention_days` より古い行も消す
- `settings(key, value)`: 保存日数 400、実装する最低点

## AI 用 API(`core`、`Authorization: Bearer <合言葉>`)

- `GET /api/agent/trends?hours=24`、`GET /api/agent/ideas?days=60`(重複を避ける材料)
- `POST /api/agent/ideas`: 追加のみ。1 回 20 件まで、直近 24 時間で 40 件を超えたら 429。一部の slug が重複したら 201 で、重複分を `skipped` に返す。全件が重複なら 409。scores はキー `^[a-z_]{1,30}$` で最大 10 個、sources は https の URL。文字列は制御文字を弾く(summary と note は改行だけ可)
- `POST /api/agent/claim`: 最低点以上で最高点の 候補 を 1 件、実装中 にして返す。6 時間たっても 実装中 のものは 候補 に戻す(attempts が 3 以上なら 見送り)。building が 1 件でもあれば取らずに 204
- `POST /api/agent/builds`: preview_url は `https://<slug>-preview.<PREVIEW_SUFFIX>`、pr_url は `^https://github\.com/nakake/trend-factory-tools/pull/\d{1,7}$` だけ受け付ける。直近 24 時間で 5 件を超えたら 429、pr_url が重複したら 409
- `POST /api/agent/runs`: 開始・終了・失敗の記録。note は自由文(routine が手順書の版を書いてよい)。直近 24 時間で 60 件を超えたら 429
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
- **tools リポジトリに routine への指示が仕込まれる**(`CLAUDE.md`、`.claude/`、`.mcp.json`): 以後の実行に効き続ける。公開スクリプトと月次の棚卸しで検知する。検知するのはルートだけで、`tools/` 以下に置かれたものは見ていない
- **工房トークンの漏えい**: プレビュー専用アカウントで第三者がページを公開できる。本番・D1・一覧ページには届かない。ローテーションで対処(`docs/operations.md`)
- **本人が中身を読まずに公開する**: 仕組みでは防げない。スクリプトは差分か全文を必ず見せ、手元で動かす段を挟む
- **公開する小物そのものの悪意**(外部への通信、解析タグなど): 許可拡張子の中で書ける。差分を読むことと手元で動かすことに頼っている
- **本人の端末で動く AI セッション**: 疑似端末を用意すれば公開スクリプトを対話なしで動かせる。端末の検査は `yes |` のような流し込みを止めるだけで、本人の権限で動くプログラムからは守れない
- **Claude の GitHub App の対象が広がる**: `trend-factory` が対象に入ると v2 と同じ状態に戻る。月次で確かめる
- **一覧ページに AI が登録した文字列が出る**: エスケープと URL 検証で対処済み。公開コマンドの文字は検証済みの値からしか作らない
- **手順書が公開されている**: 注入文の材料になりうる。外部の文章をデータとして扱う指示を手順書の先頭に置く

## 検証(全体)

- 通し: 案出し → claim → 実装 → プレビュー → PR → `publish-tool` → 本番 URL
- 権限: 工房トークンで本体アカウントの Worker や D1 が見えない(403)、合言葉なしの AI 用 API は 401、ログインなしの一覧ページはログイン画面、routine から `trend-factory` へ push できない
- 公開スクリプト: 端末なし・不正な slug・検査に落ちるツリーで、何も公開せずに終わる(`pnpm -C infra test` が検査とフィルタを確かめる)
- 失敗系: 候補が 0 件や最低点未満のときに実装 routine が何もせず終わる、実装中のまま 6 時間たった案が候補に戻る、一覧ページに失敗が出る
