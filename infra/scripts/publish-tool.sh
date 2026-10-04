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
[[ $pr =~ ^[1-9][0-9]{0,6}$ ]] || die "PR 番号は数字だけで指定する"
require_tty
need_cmd gh git python3 curl tar
need_wrangler

sanitize() { bash "$here/lib/sanitize.sh"; }
pager() {
  if command -v less >/dev/null 2>&1; then
    # -R を付けない(色のエスケープを解釈させない)。フィルタに加えた二重の防御
    less -FX
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
empty="$work/empty"
mkdir "$empty"

echo "== 1/6 PR の確認"
# タイトルと本文は取らない。AI が書く文字列なので、端末に出すと表示を偽装されうる
meta=$(gh pr view "$pr" -R "$TOOLS_REPO" \
  --json headRefOid,headRefName,baseRefName,isCrossRepository,state,number \
  --jq '[.headRefOid, .headRefName, .baseRefName, (.isCrossRepository | tostring), .state, (.number | tostring)] | @tsv') \
  || die "PR #$pr を取得できなかった"
IFS=$'\t' read -r sha head_ref base_ref cross state number <<<"$meta"
[[ $sha =~ ^[0-9a-f]{40}$ ]] || die "PR の先頭コミットの SHA が取れなかった"
[ "$number" = "$pr" ] || die "PR 番号が一致しない"
[ "$base_ref" = main ] || die "PR の base が main ではない"
[ "$cross" = false ] || die "フォークからの PR は対象外"
[ "$head_ref" = "claude/tool-$slug" ] || die "PR のブランチが claude/tool-$slug ではない: $(printf '%q' "$head_ref")"
case "$state" in
  OPEN | MERGED | CLOSED) ;;
  *) die "PR の状態が想定外" ;;
esac
echo "PR #$pr  状態 $state  ブランチ claude/tool-$slug"
echo "コミット $sha"

echo "== 2/6 取得と検査"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/trend-factory/tools.git"
if [ ! -d "$cache" ]; then
  mkdir -p "$(dirname "$cache")"
  git init -q --bare "$cache"
fi
g() { git --git-dir="$cache" "$@"; }
# ここから先は SHA だけを使う。ブランチ名や PR を引き直すと、確認中に push された別のコミットを公開しうる
g fetch -q --no-tags --no-recurse-submodules "https://github.com/$TOOLS_REPO.git" \
  "$sha" '+refs/heads/main:refs/remotes/origin/main' \
  || die "コミットを取得できなかった(gh auth setup-git が済んでいるか確認)"
[ "$(g cat-file -t "$sha")" = commit ] || die "取得した SHA がコミットではない"

bash "$here/lib/check-tool-tree.sh" "$cache" "$sha" "$slug" || die "tools/$slug/ が公開できる形ではない"

# routine はリポジトリの CLAUDE.md と .claude/settings.json の hook を毎回読む。
# 一度入ると以後の実行すべてに効くので、公開のたびに見る
AGENT_FILES=(CLAUDE.md CLAUDE.local.md AGENTS.md .claude .mcp.json .github)
warn_agent_files() {
  local rev=$1 label=$2 found name hit=''
  found=$(g ls-tree --name-only "$rev" -- "${AGENT_FILES[@]}")
  # git の出力ではなく手元の一覧の名前を出す(出力をそのまま端末に流さない)
  for name in "${AGENT_FILES[@]}"; do
    if grep -qxF -- "$name" <<<"$found"; then
      hit="$hit $name"
    fi
  done
  [ -n "$hit" ] || return 0
  echo
  echo "警告: $label のルートに次のものがある:$hit"
  echo "      routine への指示が仕込まれた可能性がある。中身を確かめ、心当たりが無ければ公開せずに調べること。"
  confirm "それでも続けるか" || die "中止した"
}
warn_agent_files "$sha" "このコミット"
warn_agent_files refs/remotes/origin/main "tools リポジトリの main"

echo "== 3/6 前回の公開"
load_deployments "$empty" "tf-$slug"
prev=''
if [ "$DEPLOY_STATE" = exists ]; then
  prev=$(python3 "$here/lib/deploy-meta.py" sha <<<"$DEPLOY_JSON")
  if [ -z "$prev" ]; then
    # --message はバージョン側に付く。デプロイ側に無ければバージョンを見る
    vid=$(python3 "$here/lib/deploy-meta.py" version <<<"$DEPLOY_JSON")
    if [ -n "$vid" ]; then
      vjson=$(wrangler_main "$empty" versions view "$vid" --name "tf-$slug" --json 2>/dev/null) || vjson=''
      prev=$(python3 "$here/lib/deploy-meta.py" sha <<<"$vjson")
    fi
  fi
fi
if [ "$DEPLOY_STATE" = none ]; then
  echo "tf-$slug は未公開(初回)"
elif [ -z "$prev" ]; then
  echo "tf-$slug は公開済みだが、前回の SHA が記録に無い。全文を表示する"
elif [ "$prev" = "$sha" ]; then
  echo "tf-$slug は同じコミット $sha で公開済み"
else
  echo "tf-$slug は $prev で公開済み"
  if ! g cat-file -e "$prev^{commit}" 2>/dev/null; then
    g fetch -q --no-tags --no-recurse-submodules "https://github.com/$TOOLS_REPO.git" "$prev" 2>/dev/null || true
  fi
  if ! g cat-file -e "$prev^{commit}" 2>/dev/null; then
    echo "前回のコミットを取得できない(ブランチごと消えた可能性)。全文を表示する"
    prev=''
  fi
fi

echo "== 4/6 中身の確認"
paths=()
oids=()
while IFS= read -r -d '' entry; do
  meta=${entry%%$'\t'*}
  paths+=("${entry#*$'\t'}")
  oids+=("${meta##* }")
done < <(g ls-tree -r -z "$sha" -- "tools/$slug/")

text_re='\.(html|css|js|svg|json|txt)$'
show() {
  local i
  echo "ファイル一覧(バイト数):"
  for i in "${!paths[@]}"; do
    printf '%9d  %s\n' "$(g cat-file -s "${oids[$i]}")" "${paths[$i]}"
  done
  echo
  if [ -n "$prev" ] && [ "$prev" != "$sha" ]; then
    echo "前回 $prev からの差分:"
    # 外部 diff や textconv は、リポジトリ側の設定で任意のコマンドを動かす入口になるので止める
    g diff --no-color --no-ext-diff --no-textconv "$prev" "$sha" -- "tools/$slug/"
  else
    for i in "${!paths[@]}"; do
      if [[ ${paths[$i]} =~ $text_re ]]; then
        echo "===== ${paths[$i]}"
        g cat-file blob "${oids[$i]}"
        echo
      else
        echo "===== ${paths[$i]}(バイナリ。表示しない)"
      fi
    done
  fi
}
# いったんファイルに書く。ページャに直結すると、途中で閉じたときの SIGPIPE と git の失敗を区別できず、
# 一部しか出ていないのに先へ進んでしまう
show | sanitize >"$work/review.txt" || die "表示する内容を作れなかった"
pager <"$work/review.txt" || true

echo "== 5/6 手元で動かす"
site="$work/site"
mkdir "$site"
g archive "$sha" "tools/$slug" | tar -x -C "$site"
root="$site/tools/$slug"
# git archive はツリー内の .gitattributes(export-subst、export-ignore、改行変換)に従う。
# 見せた中身と公開する中身が食い違わないよう、展開したファイルを blob と突き合わせる
extracted=$(find "$root" -type f | wc -l)
[ "$extracted" -eq "${#paths[@]}" ] || die "展開したファイル数が一覧と違う"
[ -z "$(find "$root" ! -type f ! -type d -print -quit)" ] || die "展開した中に通常ファイル以外がある"
for i in "${!paths[@]}"; do
  [ "$(g hash-object --no-filters "$site/${paths[$i]}")" = "${oids[$i]}" ] \
    || die "展開したファイルがコミットの中身と違う: ${paths[$i]}"
done

port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
server_pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && break
  sleep 0.3
done
echo "ブラウザで開いて動作を確かめる: http://127.0.0.1:$port/"
read -r -p "確かめ終わったら Enter: " _
kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
server_pid=''

echo "== 6/6 公開"
url="https://tf-$slug.$TOOL_DOMAIN/"
if [ "$DEPLOY_STATE" = exists ]; then
  echo "注意: tf-$slug は公開済み。続けると $url を上書きする。"
else
  echo "$url として新しく公開する。"
fi
read -r -p "公開するには slug を入力: " typed
[ "$typed" = "$slug" ] || die "入力が slug と一致しない。公開していない"

config="$work/wrangler.jsonc"
write_wrangler_config "$config" "$slug" "$root"
wrangler_main "$empty" deploy --config "$config" --message "sha=$sha pr=$pr"

# 初回は Custom Domain の証明書が出るまで数十秒かかることがある
code=000
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)
  [ "$code" = 200 ] && break
  sleep 5
done
[ "$code" = 200 ] || die "デプロイは終わったが $url が 200 を返さない(最後の応答 $code)。少し待って開き直すこと"
echo "公開した: $url"
