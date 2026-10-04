#!/usr/bin/env bash
# check-tool-tree.sh と find-agent-files.sh を、一時リポジトリに作ったコミットで検証する。
set -euo pipefail

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

S=tools/foo-bar
# 最小の正常な小物
base() {
  reset
  add 100644 "$S/index.html"
  add 100644 "$S/app.js"
}

# expect <pass|fail|usage> <名前> <sha> [slug] [stderr に含まれるはずの文字列]
# 理由も照合する。別の理由で落ちているのに通ってしまうテストを防ぐため
expect() {
  local want=$1 name=$2 sha=$3 slug=${4:-foo-bar} reason=${5:-} got=0 err
  err=$(bash "$LIB_DIR/check-tool-tree.sh" "$GIT_DIR" "$sha" "$slug" 2>&1 >/dev/null) || got=$?
  case "$want" in
    pass) [ "$got" -eq 0 ] || { ng "$name" "exit $got: $err"; return; } ;;
    fail) [ "$got" -eq 1 ] || { ng "$name" "exit $got"; return; } ;;
    usage) [ "$got" -eq 2 ] || { ng "$name" "exit $got"; return; } ;;
  esac
  if [ -n "$reason" ] && ! grep -qF -- "$reason" <<<"$err"; then
    ng "$name" "reason not found: $reason / got: $err"
    return
  fi
  ok "$name"
}
fail() { expect fail "$1" "$(commit)" foo-bar "$2"; }

MODE='通常ファイル(100644)以外'
NAME='使えない名前を含むパス'
EXT='許可されていない拡張子'

base
add 100644 "$S/style.css"
add 100644 "$S/img/logo-1.png"
add 100644 "$S/data/list.v2.json"
expect pass 'normal tree with subdirectories' "$(commit)"

base; add 120000 "$S/link.html"
fail 'symlink' "$MODE: mode=120000"
reset; add 120000 "$S/index.html"
fail 'index.html is a symlink' "$MODE: mode=120000"
base; add 100755 "$S/run.js"
fail 'executable bit' "$MODE: mode=100755"
base; add 160000 "$S/vendor" "$fake_commit"
fail 'submodule entry' "$MODE: mode=160000"
reset; add 160000 "$S" "$fake_commit"
fail 'slug directory itself is a submodule' "mode=160000"

base; add 100644 "$S/.assetsignore"
fail 'dot file' "$NAME"
base; add 100644 "$S/.well-known/security.txt"
fail 'dot directory' "$NAME"
base; add 100644 "$S/_headers"
fail '_headers' "$NAME"
base; add 100644 "$S/_redirects"
fail '_redirects' "$NAME"
base; add 100644 "$S/_private.js"
fail 'underscore file with allowed extension' "$NAME"
base; add 100644 "$S/-rf.js"
fail 'name starting with a hyphen' "$NAME"
base; add 100644 "$S/-dir/a.js"
fail 'directory starting with a hyphen' "$NAME"

base; add 100644 "$S/run.sh"
fail 'disallowed extension' "$EXT"
base; add 100644 "$S/readme.md"
fail 'markdown' "$EXT"
base; add 100644 "$S/noext"
fail 'no extension' "$EXT"
base; add 100644 "$S/a.html.sh"
fail 'allowed extension in the middle' "$EXT"
base; add 100644 "$S/package.json"
expect pass 'json is allowed whatever the name' "$(commit)"

reset; add 100644 "$S/app.js"
fail 'no index.html' "index.html が無い"
reset; add 100644 "$S/sub/index.html"
fail 'index.html only in a subdirectory' "index.html が無い"

base; add 100644 "$S/App.js"
fail 'uppercase file name' "$NAME"
base; add 100644 "$S/Img/a.png"
fail 'uppercase directory name' "$NAME"
base; add 100644 "$S/a.JS"
fail 'uppercase extension' "$NAME"
base; add 100644 "$S/a.Html"
fail 'mixed-case extension' "$NAME"
base; add 100644 "$S/a b.js"
fail 'space in name' "$NAME"
base; add 100644 "$S/a"$'\n'"b.js"
fail 'newline in name' "$NAME"
base; add 100644 "$S/a"$'\033'"[2Kb.js"
fail 'escape character in name' "$NAME"
base; add 100644 "$S/日本語.js"
fail 'non-ASCII name' "$NAME"

NUL='NUL がある'
nul_text=$(printf 'var a = 1;\n\000var hidden = 2;\n' | blob)
for ext in html css js svg json txt; do
  base; add 100644 "$S/x.$ext" "$nul_text"
  fail "NUL in .$ext" "$NUL"
done
reset; add 100644 "$S/index.html" "$nul_text"
fail 'NUL in index.html' "$NUL"

MAGIC='拡張子と中身(先頭バイト)が合わない画像'
html_blob=$(printf '<script>alert(1)</script>\n' | blob)
jpg_blob=$(printf '\xff\xd8\xff\xe0\x00\x10JFIF' | blob)
webp_blob=$(printf 'RIFF\x24\x00\x00\x00WEBPVP8 ' | blob)
ico_blob=$(printf '\x00\x00\x01\x00\x01\x00' | blob)
riff_wav=$(printf 'RIFF\x24\x00\x00\x00WAVEfmt ' | blob)
base
add 100644 "$S/a.png"
add 100644 "$S/a.jpg" "$jpg_blob"
add 100644 "$S/a.webp" "$webp_blob"
add 100644 "$S/a.ico" "$ico_blob"
expect pass 'real image headers' "$(commit)"
for ext in png jpg webp ico; do
  base; add 100644 "$S/fake.$ext" "$html_blob"
  fail "HTML disguised as .$ext" "$MAGIC"
  base; add 100644 "$S/empty.$ext" "$empty_blob"
  fail "empty .$ext" "$MAGIC"
done
base; add 100644 "$S/a.jpg" "$png_blob"
fail 'png content with .jpg name' "$MAGIC"
base; add 100644 "$S/a.webp" "$riff_wav"
fail 'RIFF that is not WEBP' "$MAGIC"

base
for i in $(seq 1 48); do add 100644 "$S/f$i.txt"; done
expect pass 'exactly 50 files' "$(commit)"
add 100644 "$S/f49.txt"
fail '51 files' 'ファイル数が 50 を超えている: 51'

big() { { printf '\x89PNG\r\n\x1a\n'; head -c "$(($1 - 8))" /dev/zero; } | blob; }
exact=$(big $((5 * 1024 * 1024)))
over=$(big $((5 * 1024 * 1024 + 1)))
half=$(big $((3 * 1024 * 1024)))
reset; add 100644 "$S/index.html"; add 100644 "$S/big.png" "$exact"
expect pass 'exactly 5MB' "$(commit)"
reset; add 100644 "$S/index.html"; add 100644 "$S/big.png" "$over"
fail 'over 5MB in one file' '合計サイズが 5MB を超えている: 5242881'
reset; add 100644 "$S/index.html"; add 100644 "$S/a.png" "$half"; add 100644 "$S/b.png" "$half"
fail 'over 5MB in total (same blob counted per path)' '合計サイズが 5MB を超えている: 6291456'

reset
for i in $(seq 1 30); do add 100755 "$S/x$i.js"; done
sha=$(commit)
fail 'stops after 20 violations' '20 件に達したので検査を打ち切った'
n=$(bash "$LIB_DIR/check-tool-tree.sh" "$GIT_DIR" "$sha" foo-bar 2>&1 | grep -c "$MODE" || true)
if [ "$n" -eq 20 ]; then ok 'reports exactly 20 violations'; else ng 'reports exactly 20 violations' "got $n"; fi

base
add 120000 tools/other-tool/link
add 100755 tools/other-tool/run.sh
add 100644 tools/_template/README.md
add 100644 CLAUDE.md
add 100644 tools/foo-bar-2/_headers
other=$(commit)
expect pass 'other slugs and root files are out of scope' "$other"
expect fail 'the other slug itself is rejected' "$other" other-tool "$MODE"
expect fail 'slug sharing a prefix is checked separately' "$other" foo-bar-2 "$NAME"

base
good=$(commit)
expect fail 'slug directory missing' "$good" not-there 'がこのコミットに無い'
expect usage 'invalid slug' "$good" 'Foo' 'slug が不正'
expect usage 'slug with path traversal' "$good" '../x' 'slug が不正'
expect usage 'short sha' "${good:0:12}" foo-bar 'sha は 40 桁'
expect usage 'ref name instead of sha' main foo-bar 'sha は 40 桁'
reset; add 100644 tools/foo-bar
fail 'slug path is a file' 'がこのコミットに無い'

# find-agent-files.sh
agent() {
  local name=$1 want=$2 got
  got=$(bash "$LIB_DIR/find-agent-files.sh" "$GIT_DIR" "$(commit)" | tr '\n' ' ')
  if [ "$got" = "$want" ]; then ok "agent files: $name"; else ng "agent files: $name" "got: $got"; fi
}
base; add 100644 README.md; add 100644 tools/_template/README.md; add 100644 "$S/claude.md.txt"
agent 'clean tree' ''
base; add 100644 CLAUDE.md
agent 'root CLAUDE.md' 'CLAUDE.md '
base; add 100644 tools/CLAUDE.md; add 100644 "$S/AGENTS.md"; add 100644 docs/deep/CLAUDE.local.md
agent 'nested instruction files' 'docs/deep/CLAUDE.local.md tools/CLAUDE.md tools/foo-bar/AGENTS.md '
base; add 100644 .claude/settings.json; add 100644 tools/.claude/hooks/x.sh; add 100644 .mcp.json; add 100644 tools/x/.mcp.json
agent '.claude and .mcp.json at any depth' '.claude/settings.json .mcp.json tools/.claude/hooks/x.sh tools/x/.mcp.json '
base; add 100644 .github/workflows/x.yml; add 100644 sub/.github/CODEOWNERS
agent '.github at any depth' '.github/workflows/x.yml sub/.github/CODEOWNERS '
base; add 160000 .claude "$fake_commit"; add 120000 tools/.github
agent '.claude as a submodule, .github as a symlink' '.claude tools/.github '
base; add 100644 .gitattributes; add 100644 .gitmodules; add 100644 .lfsconfig; add 100644 tools/.gitattributes
agent 'root git config files only' '.gitattributes .gitmodules .lfsconfig '
base; add 100644 "x"$'\033'"[2K/CLAUDE.md"
agent 'control characters in the path are replaced' 'x<U+001B>[2K/CLAUDE.md '
base; add 100644 my.claude/x.txt; add 100644 CLAUDE.md.bak; add 100644 claude.md
agent 'similar names are not matched' ''
base; for i in $(seq 10 35); do add 100644 "d$i/CLAUDE.md"; done
n=$(bash "$LIB_DIR/find-agent-files.sh" "$GIT_DIR" "$(commit)" | wc -l)
if [ "$n" -eq 21 ]; then ok 'agent files: capped at 20 plus a notice'; else ng 'agent files: capped' "got $n lines"; fi

finish 'check-tool-tree / find-agent-files'
