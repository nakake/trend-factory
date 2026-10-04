#!/usr/bin/env bash
# 使い方: pnpm -C infra publish-tool <slug> <PR番号>
# nakake/trend-factory-tools の PR の先頭コミットにある tools/<slug>/ を、本人の確認のうえで
# tf-<slug>.nakake.com に公開する。流れは docs/design.md の「本番公開」を参照。
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=config.sh
. "$here/config.sh"
# shellcheck source=lib/common.sh
. "$here/lib/common.sh"

if [ $# -ne 2 ]; then
  echo "usage: pnpm -C infra publish-tool <slug> <PR番号>" >&2
  exit 2
fi
slug=$1
pr=$2
valid_slug "$slug" || die "slug が不正(^[a-z][a-z0-9-]{1,38}[a-z0-9]\$)"
[[ $pr =~ ^[1-9][0-9]{0,6}$ ]] || die "PR 番号は数字だけで指定する(先頭の 0 は不可、7 桁まで)"
require_tty
need_cmd gh git python3 curl
need_wrangler

# テスト(test/test-publish-e2e.sh)が手元の一時リポジトリに向けるための差し替え口。普段は設定しない
tools_url="https://github.com/$TOOLS_REPO.git"
if [ -n "${TF_TOOLS_GIT_URL:-}" ]; then
  tools_url=$TF_TOOLS_GIT_URL
  echo "注意: TF_TOOLS_GIT_URL が設定されている。取得元が $TOOLS_REPO ではない: $(printf '%s' "$tools_url" | sanitize)"
fi

# 空ツリー。diff の属性の読み取り元に指定して、リポジトリ側の .gitattributes を効かせない
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904

pager() {
  if command -v less >/dev/null 2>&1; then
    # -R を付けない(色のエスケープを解釈させない)。本人の LESS や LESSOPEN の設定で
    # 生の制御文字が通ったり、前処理のコマンドが動いたりしないよう、環境も固定する
    env -u LESSOPEN -u LESSCLOSE LESS='' LESSSECURE=1 less -FX
  else
    cat
  fi
}
confirm() {
  local ans
  read -r -p "$1 [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ]
}

work=$(mktemp -d)
server_pid=''
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "== 1/7 PR の確認"
# タイトルと本文は取らない。AI が書く文字列なので、端末に出すと表示を偽装されうる
meta=$(gh pr view "$pr" -R "$TOOLS_REPO" \
  --json headRefOid,headRefName,baseRefName,isCrossRepository,state,number \
  --jq '[.headRefOid, .headRefName, .baseRefName, (.isCrossRepository | tostring), .state, (.number | tostring)] | @tsv') \
  || die "PR #$pr を取得できなかった"
IFS=$'\t' read -r sha head_ref base_ref cross state number <<<"$meta"
[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "PR の先頭コミットの SHA が取れなかった"
[ "$number" = "$pr" ] || die "PR 番号が一致しない"
[ "$base_ref" = main ] || die "PR の base が main ではない: $(printf '%s' "$base_ref" | sanitize)"
[ "$cross" = false ] || die "フォークからの PR は対象外"
[ "$head_ref" = "claude/tool-$slug" ] \
  || die "PR のブランチが claude/tool-$slug ではない: $(printf '%s' "$head_ref" | sanitize)"
case "$state" in
  OPEN | MERGED | CLOSED) ;;
  *) die "PR の状態が想定外" ;;
esac
echo "PR #$pr  状態 $state  ブランチ claude/tool-$slug"
echo "コミット $sha"

echo "== 2/7 取得と検査"
default_branch=$(gh api "repos/$TOOLS_REPO" --jq .default_branch) || die "tools リポジトリの情報を取得できなかった"
[[ $default_branch =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$ ]] && [[ $default_branch != *..* ]] \
  || die "default branch の名前が想定外"
if [ "$default_branch" != main ]; then
  echo
  echo "警告: tools リポジトリの default branch が main ではない: $default_branch"
  echo "      routine は default branch の CLAUDE.md などを読む。本人が変えた覚えが無ければ、公開せずに調べること。"
  confirm "それでも続けるか" || die "中止した"
fi

cache="${XDG_CACHE_HOME:-$HOME/.cache}/trend-factory/tools.git"
if [ ! -d "$cache" ]; then
  mkdir -p "$(dirname "$cache")"
  git init -q --bare "$cache"
fi
g() { git --git-dir="$cache" "$@"; }
# 履歴は要らないので 1 コミットだけ取る。fsck は、壊れた・細工されたオブジェクトを受け取った時点で落とすため
fetch() {
  g -c transfer.fsckObjects=true fetch -q --depth=1 --no-tags --no-recurse-submodules "$tools_url" "$@"
}
# ここから先は SHA だけを使う。ブランチ名や PR を引き直すと、確認中に push された別のコミットを公開しうる
fetch "$sha" "+refs/heads/$default_branch:refs/remotes/origin/default" \
  || die "コミットを取得できなかった(gh auth setup-git が済んでいるか確認)"
[ "$(g cat-file -t "$sha")" = commit ] || die "取得した SHA がコミットではない"

bash "$here/lib/check-tool-tree.sh" "$cache" "$sha" "$slug" || die "tools/$slug/ が公開できる形ではない"

# routine はリポジトリの CLAUDE.md と .claude/settings.json の hook を毎回読む。
# 一度入ると以後の実行すべてに効くので、公開のたびに見る
warn_agent_files() {
  local rev=$1 label=$2 found
  found=$(bash "$here/lib/find-agent-files.sh" "$cache" "$rev") || die "$label のツリーを調べられなかった"
  [ -n "$found" ] || return 0
  echo
  echo "警告: $label に次のものがある:"
  printf '%s\n' "$found" | sed 's/^/        /'
  echo "      routine への指示が仕込まれた可能性がある。中身を確かめ、心当たりが無ければ公開せずに調べること。"
  confirm "それでも続けるか" || die "中止した"
}
warn_agent_files "$sha" "このコミット"
warn_agent_files refs/remotes/origin/default "tools リポジトリの default branch($default_branch)"

echo "== 3/7 展開と機械検出"
paths=()
oids=()
while IFS= read -r -d '' entry; do
  meta=${entry%%$'\t'*}
  paths+=("${entry#*$'\t'}")
  oids+=("${meta##* }")
done < <(g ls-tree -r -z "$sha" -- "tools/$slug/")
[ "${#paths[@]}" -gt 0 ] || die "tools/$slug/ のファイル一覧を取れなかった"

# git archive や checkout は使わない。どちらもツリー内の .gitattributes(export-subst、改行変換、
# フィルタ)に従うので、検査した blob と違う中身が出うる。検査済みの blob を 1 つずつ書く
root="$work/site"
mkdir "$root"
for i in "${!paths[@]}"; do
  dest="$root/${paths[$i]#"tools/$slug/"}"
  mkdir -p "$(dirname "$dest")"
  g cat-file blob "${oids[$i]}" >"$dest"
  [ "$(g hash-object --no-filters "$dest")" = "${oids[$i]}" ] \
    || die "書き出したファイルがコミットの中身と違う: ${paths[$i]}"
done

python3 -I "$here/lib/scan-tool.py" "$root" >"$work/scan.txt" || die "機械検出に失敗した"
show_scan() {
  if [ -s "$work/scan.txt" ]; then
    echo "機械検出の要約(誤検出を含む。該当箇所を自分の目で確かめること):"
    cat "$work/scan.txt"
  else
    echo "機械検出: 該当なし(外部 URL、通信、文字列の実行、難読化などの書き方は見つからなかった)"
  fi
}

# _headers は Cloudflare の静的アセットがヘッダーを付けるための特別なファイル。
# 小物の側は _ で始まる名前を置けない(検査で落ちる)ので、ここで作るものと衝突しない。
# 機械検出の後に書く(検出の対象に入れない)
cat >"$root/_headers" <<HEADERS
/*
  Content-Security-Policy: $TOOL_CSP
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
HEADERS

config="$work/wrangler.jsonc"
write_wrangler_config "$config" "$slug" "$root"

echo "== 4/7 前回の公開"
sha_of() { python3 -I "$here/lib/deploy-meta.py" "$@"; }
load_deployments "$config" "tf-$slug"
prev=''
if [ "$DEPLOY_STATE" = exists ]; then
  prev=$(sha_of sha <<<"$DEPLOY_JSON")
  if [ -z "$prev" ]; then
    # --message はバージョン側に付く。デプロイ側に無ければバージョンを見る
    vid=$(sha_of version <<<"$DEPLOY_JSON")
    if [ -n "$vid" ]; then
      vjson=$(wrangler_main "$config" versions view "$vid" --name "tf-$slug" --json 2>/dev/null) || vjson=''
      prev=$(sha_of sha <<<"$vjson")
    fi
  fi
fi
if [ "$DEPLOY_STATE" = none ]; then
  echo "tf-$slug は未公開(初回)"
elif [ -z "$prev" ]; then
  echo "tf-$slug は公開済みだが、前回の SHA が記録に無い。全文を表示する"
elif [ "$prev" = "$sha" ]; then
  echo "tf-$slug は同じコミット $sha で公開済み。全文を表示する"
else
  echo "tf-$slug は $prev で公開済み"
  if ! g cat-file -e "$prev^{commit}" 2>/dev/null; then
    fetch "$prev" 2>/dev/null || true
  fi
  if ! g cat-file -e "$prev^{commit}" 2>/dev/null; then
    echo "前回のコミットを取得できない(ブランチごと消えた可能性)。全文を表示する"
    prev=''
  fi
fi

echo "== 5/7 中身の確認"
text_re='\.(html|css|js|svg|json|txt)$'
# パイプの左側で呼ぶので errexit が効かない。失敗は自分で拾って返す
show() {
  local i size
  echo "ファイル一覧(バイト数):"
  for i in "${!paths[@]}"; do
    size=$(g cat-file -s "${oids[$i]}") || return 1
    printf '%9d  %s\n' "$size" "${paths[$i]}"
  done
  echo
  if [ -n "$prev" ] && [ "$prev" != "$sha" ]; then
    echo "前回 $prev からの差分:"
    # --text: NUL が 1 個あるだけで「Binary files differ」になり、中身が隠れるのを防ぐ。
    # 外部 diff や textconv は、設定しだいで任意のコマンドを動かす入口になるので止める
    g --attr-source="$EMPTY_TREE" diff --text --no-color --no-ext-diff --no-textconv \
      "$prev" "$sha" -- "tools/$slug/" || return 1
  else
    echo "各ファイルの全文。中身の行は「| 」で始まる(「=====」で始まる区切りを中身で偽造できないように):"
    for i in "${!paths[@]}"; do
      if [[ ${paths[$i]} =~ $text_re ]]; then
        echo "===== ${paths[$i]}"
        g cat-file blob "${oids[$i]}" | sed 's/^/| /' || return 1
        echo
      else
        echo "===== ${paths[$i]}(画像。表示しない)"
      fi
    done
  fi
}
# いったんファイルに書く。ページャに直結すると、途中で閉じたときの SIGPIPE と git の失敗を区別できず、
# 一部しか出ていないのに先へ進んでしまう
show | sanitize >"$work/review.txt" || die "表示する内容を作れなかった"
show_scan
echo
pager <"$work/review.txt" || die "ページャが異常終了した"

echo "== 6/7 手元で動かす"
python3 -I -B "$here/lib/preview-server.py" "$root" "$TOOL_CSP" >"$work/port" &
server_pid=$!
port=''
for _ in $(seq 1 50); do
  if read -r _ port <"$work/port" && [ -n "$port" ]; then
    break
  fi
  kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.1
done
[[ $port =~ ^[0-9]{1,5}$ ]] || die "手元の配信を起動できなかった"
echo "ブラウザで開いて動作を確かめる: http://127.0.0.1:$port/"
echo "本番と同じ CSP を付けている(インラインの script / style と外部への通信は動かない)。下にアクセスログが出る。"
read -r -p "確かめ終わったら Enter: " _
kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
server_pid=''

echo "== 7/7 公開"
url="https://tf-$slug.$TOOL_DOMAIN/"
if [ -s "$work/scan.txt" ]; then
  show_scan
  echo
fi
if [ "$DEPLOY_STATE" = exists ]; then
  echo "注意: tf-$slug は公開済み。続けると $url を上書きする。"
else
  echo "$url として新しく公開する。"
fi
read -r -p "公開するには slug を入力: " typed
[ "$typed" = "$slug" ] || die "入力が slug と一致しない。公開していない"

wrangler_main "$config" deploy --message "sha=$sha pr=$pr"

# 初回は Custom Domain の証明書が出るまで時間がかかることがある
code=000
headers=''
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  # 応答の行末は CRLF。CR を落とさないとステータスが "200\r" になり一致しない
  headers=$(curl -s -D - -o /dev/null --max-time 10 "$url" | tr -d '\r' || true)
  code=$(awk 'NR == 1 { print $2 }' <<<"$headers")
  [ "$code" = 200 ] && break
  sleep 5
done
[ "$code" = 200 ] || die "デプロイは終わったが $url が 200 を返さない(最後の応答 ${code:-なし})。少し待って開き直すこと"
if ! grep -qi '^content-security-policy:' <<<"$headers"; then
  echo >&2
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
  echo "警告: 公開した $url の応答に Content-Security-Policy が無い。" >&2
  echo "      _headers が効いていない。外部への通信やインラインのスクリプトが止まらない状態で公開されている。" >&2
  echo "      取り下げるなら: pnpm -C infra unpublish-tool $slug" >&2
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
  exit 1
fi
echo "公開した: $url(Content-Security-Policy あり)"
