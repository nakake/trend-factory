#!/usr/bin/env bash
# 使い方: find-agent-files.sh <git-dir> <rev>
# routine(Claude Code)が自動で読む指示ファイルと、git の挙動を変えるファイルを、ツリー全体から探す。
# 見つけたパスを 1 行ずつ出す(最大 20 件。表示用に置換済み)。見つからなければ何も出さない。
#
# routine はリポジトリの CLAUDE.md と .claude/settings.json の hook を実行のたびに読む。
# サブディレクトリの CLAUDE.md も、そこで作業すれば読まれるので、ルートだけでなく全体を見る。
set -euo pipefail
export LC_ALL=C

if [ $# -ne 2 ]; then
  echo "usage: find-agent-files.sh <git-dir> <rev>" >&2
  exit 2
fi
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MAX=20

n=0
while IFS= read -r -d '' path; do
  hit=0
  case "${path##*/}" in
    CLAUDE.md | CLAUDE.local.md | AGENTS.md | .mcp.json) hit=1 ;;
  esac
  case "/$path/" in
    */.claude/* | */.github/*) hit=1 ;;
  esac
  # 属性やサブモジュールの設定は、取得や展開のときの git の動きを変える
  case "$path" in
    .gitattributes | .gitmodules | .lfsconfig) hit=1 ;;
  esac
  [ "$hit" -eq 1 ] || continue
  n=$((n + 1))
  if [ "$n" -gt "$MAX" ]; then
    echo "(ほかにもある。$MAX 件で打ち切り)"
    break
  fi
  printf '%s\n' "${path//$'\n'/<U+000A>}" | bash "$here/sanitize.sh"
done < <(git --git-dir="$1" ls-tree -r -z --name-only "$2")
