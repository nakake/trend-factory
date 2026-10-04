#!/usr/bin/env bash
# check-tool-tree.sh を、一時リポジトリに作ったコミットで検証する。
# 作業ツリーを使わずインデックスへ直接エントリを入れる(シンボリックリンクやサブモジュールの
# モードを、ファイルシステムに関係なく作るため)。
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/check-tool-tree.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

export GIT_DIR="$tmp/repo.git"
export GIT_INDEX_FILE="$tmp/index"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
git init -q --bare "$GIT_DIR"

S=tools/foo-bar
empty_blob=$(git hash-object -w --stdin </dev/null)
fake_commit=0123456789abcdef0123456789abcdef01234567

reset() { rm -f "$GIT_INDEX_FILE"; }
add() {
  local mode=$1 path=$2 oid=${3:-$empty_blob}
  git update-index --add --cacheinfo "$mode,$oid,$path"
}
commit() { git commit-tree -m t "$(git write-tree)"; }
# 最小の正常な小物
base() {
  reset
  add 100644 "$S/index.html"
  add 100644 "$S/app.js"
}

failed=0
total=0
expect() {
  local want=$1 name=$2 sha=$3 slug=${4:-foo-bar} got=0
  total=$((total + 1))
  bash "$script" "$GIT_DIR" "$sha" "$slug" >/dev/null 2>&1 || got=$?
  if { [ "$want" = pass ] && [ "$got" -eq 0 ]; } || { [ "$want" = fail ] && [ "$got" -eq 1 ]; } \
    || { [ "$want" = usage ] && [ "$got" -eq 2 ]; }; then
    echo "ok   $name"
  else
    echo "FAIL $name (want $want, exit $got)"
    failed=1
  fi
}

base
add 100644 "$S/style.css"
add 100644 "$S/img/logo-1.png"
add 100644 "$S/data/list.v2.json"
expect pass 'normal tree with subdirectories' "$(commit)"

base
add 120000 "$S/link.html"
expect fail 'symlink' "$(commit)"

reset
add 120000 "$S/index.html"
expect fail 'index.html is a symlink' "$(commit)"

base
add 100755 "$S/run.js"
expect fail 'executable bit' "$(commit)"

base
add 160000 "$S/vendor" "$fake_commit"
expect fail 'submodule entry' "$(commit)"

reset
add 160000 "$S" "$fake_commit"
expect fail 'slug directory itself is a submodule' "$(commit)"

base
add 100644 "$S/.assetsignore"
expect fail 'dot file' "$(commit)"

base
add 100644 "$S/.well-known/security.txt"
expect fail 'dot directory' "$(commit)"

base
add 100644 "$S/_headers"
expect fail '_headers' "$(commit)"

base
add 100644 "$S/_redirects"
expect fail '_redirects' "$(commit)"

base
add 100644 "$S/_private.js"
expect fail 'underscore file with allowed extension' "$(commit)"

base
add 100644 "$S/run.sh"
expect fail 'disallowed extension' "$(commit)"

base
add 100644 "$S/README.md"
expect fail 'markdown' "$(commit)"

base
add 100644 "$S/noext"
expect fail 'no extension' "$(commit)"

base
add 100644 "$S/package.json"
expect pass 'json is allowed whatever the name' "$(commit)"

reset
add 100644 "$S/app.js"
expect fail 'no index.html' "$(commit)"

reset
add 100644 "$S/sub/index.html"
expect fail 'index.html only in a subdirectory' "$(commit)"

base
add 100644 "$S/App.js"
expect fail 'uppercase file name' "$(commit)"

base
add 100644 "$S/Img/a.png"
expect fail 'uppercase directory name' "$(commit)"

base
add 100644 "$S/a.JS"
expect fail 'uppercase extension' "$(commit)"

base
add 100644 "$S/a b.js"
expect fail 'space in name' "$(commit)"

base
add 100644 "$S/a"$'\n'"b.js"
expect fail 'newline in name' "$(commit)"

base
add 100644 "$S/a"$'\033'"[2Kb.js"
expect fail 'escape character in name' "$(commit)"

base
add 100644 "$S/日本語.js"
expect fail 'non-ASCII name' "$(commit)"

base
for i in $(seq 1 48); do add 100644 "$S/f$i.txt"; done
expect pass 'exactly 50 files' "$(commit)"
add 100644 "$S/f49.txt"
expect fail '51 files' "$(commit)"

exact=$(head -c $((5 * 1024 * 1024)) /dev/zero | git hash-object -w --stdin)
over=$(head -c $((5 * 1024 * 1024 + 1)) /dev/zero | git hash-object -w --stdin)
reset
add 100644 "$S/index.html"
add 100644 "$S/big.png" "$exact"
expect pass 'exactly 5MB' "$(commit)"
reset
add 100644 "$S/index.html"
add 100644 "$S/big.png" "$over"
expect fail 'over 5MB in one file' "$(commit)"
half=$(head -c $((3 * 1024 * 1024)) /dev/zero | git hash-object -w --stdin)
reset
add 100644 "$S/index.html"
add 100644 "$S/a.png" "$half"
add 100644 "$S/b.png" "$half"
expect fail 'over 5MB in total (same blob counted per path)' "$(commit)"

base
add 120000 tools/other-tool/link
add 100755 tools/other-tool/run.sh
add 100644 tools/_template/README.md
add 100644 CLAUDE.md
add 100644 tools/foo-bar-2/_headers
other=$(commit)
expect pass 'other slugs and root files are out of scope' "$other"
expect fail 'the other slug itself is rejected' "$other" other-tool
expect fail 'slug sharing a prefix is checked separately' "$other" foo-bar-2

base
ok=$(commit)
expect fail 'slug directory missing' "$ok" not-there
expect usage 'invalid slug' "$ok" 'Foo'
expect usage 'slug with path traversal' "$ok" '../x'
expect usage 'short sha' "${ok:0:12}"
expect usage 'ref name instead of sha' main

reset
add 100644 tools/foo-bar
expect fail 'slug path is a file' "$(commit)"

echo "check-tool-tree: $total 件、失敗 $failed"
exit "$failed"
