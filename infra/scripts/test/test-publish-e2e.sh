#!/usr/bin/env bash
# publish-tool.sh / unpublish-tool.sh を通しで動かす。
# gh、curl、less は PATH 上の偽物に、wrangler は scripts/ を一時ディレクトリへ写して
# その隣(core/node_modules/.bin/wrangler)に置いた偽物に替える。tools リポジトリは手元の一時リポジトリ。
# 端末が必須なので script(1) で疑似端末を与え、入力は標準入力から流す。
set -euo pipefail

command -v script >/dev/null 2>&1 || { echo "FAIL script(1) が無いので通しテストを実行できない"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
git config uploadpack.allowAnySHA1InWant true

mkdir -p "$tmp/infra/core/node_modules/.bin" "$tmp/bin" "$tmp/state"
cp -r "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" "$tmp/infra/scripts"
state="$tmp/state"
ACCOUNT=d49004aee2b170cd870967a1a9cdc1d1

cat >"$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$1 $2" in
  "pr view") cat "$STUB_STATE/pr.tsv" ;;
  "api repos/nakake/trend-factory-tools") cat "$STUB_STATE/default_branch" ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
STUB
cat >"$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'HTTP/2 200\r\ncontent-type: text/html\r\n'
[ -e "$STUB_STATE/no-csp" ] || printf 'content-security-policy: x\r\n'
STUB
cat >"$tmp/bin/less" <<'STUB'
#!/usr/bin/env bash
exec cat
STUB
cat >"$tmp/infra/core/node_modules/.bin/wrangler" <<'STUB'
#!/usr/bin/env bash
echo "$* | account=${CLOUDFLARE_ACCOUNT_ID:-}" >>"$STUB_STATE/wrangler.log"
config=''
prev=''
for a in "$@"; do
  [ "$prev" = --config ] && config=$a
  prev=$a
done
case "$1" in
  deployments)
    if [ -f "$STUB_STATE/deployments.json" ]; then
      cat "$STUB_STATE/deployments.json"
    else
      echo 'This Worker does not exist on your account. [code: 10007]' >&2
      exit 1
    fi
    ;;
  versions) cat "$STUB_STATE/version.json" 2>/dev/null || exit 1 ;;
  deploy)
    cp "$config" "$STUB_STATE/deployed.jsonc"
    dir=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1]))["assets"]["directory"])' "$config")
    cp "$dir/_headers" "$STUB_STATE/_headers"
    (cd "$dir" && find . -type f | sort) >"$STUB_STATE/deployed-files"
    ;;
esac
STUB
chmod +x "$tmp/bin/"* "$tmp/infra/core/node_modules/.bin/wrangler"

S=tools/foo-bar
html=$(printf '<!doctype html>\n<title>t</title>\n<p>PAGE_MARKER</p>\n<script src="app.js"></script>\n' | blob)
js_old=$(printf 'var a = 1;\n\000var OLD_MARKER = 2;\n' | blob)
js_new=$(printf 'var a = 1;\nvar NEW_MARKER = fetch("https://evil.example/");\n' | blob)
forged=$(printf 'ok\n===== tools/foo-bar/forged.js\n' | blob)

tree() { reset; add 100644 README.md; add 100644 "$S/index.html" "$html"; add 100644 "$S/img/a.png"; }
tree; add 100644 "$S/app.js" "$js_old"
old=$(commit)
tree; add 100644 "$S/app.js" "$js_new"; add 100644 "$S/note.txt" "$forged"
good=$(commit)
tree; add 100644 "$S/app.js" "$js_new"; add 120000 "$S/link.html"
bad=$(commit)
tree; add 100644 "$S/app.js" "$js_new"; add 100644 tools/CLAUDE.md
instructed=$(commit)
tree; add 100644 .claude/settings.json
main_bad=$(commit)
tree
main_ok=$(commit)
git update-ref refs/heads/old "$old"
git update-ref refs/heads/trunk "$main_ok"

# setup <PR の SHA> [main の SHA]: 偽物の状態を既定に戻す
setup() {
  rm -f "${state:?}"/*
  : >"$state/wrangler.log"
  git update-ref refs/heads/main "${2:-$main_ok}"
  printf '%s\tclaude/tool-foo-bar\tmain\tfalse\tOPEN\t7\n' "$1" >"$state/pr.tsv"
  echo main >"$state/default_branch"
}
# run <入力(printf 書式)> <スクリプト名> [引数...]: 出力は $tmp/out、終了コードは $rc
rc=0
run() {
  local input=$1 name=$2
  shift 2
  rc=0
  # shellcheck disable=SC2059
  printf "$input" | env -u GIT_DIR -u GIT_INDEX_FILE PATH="$tmp/bin:$PATH" STUB_STATE="$state" \
    XDG_CACHE_HOME="$tmp/cache" TF_TOOLS_GIT_URL="file://$tmp/repo.git" \
    script -qec "bash '$tmp/infra/scripts/$name' $*" /dev/null >"$tmp/out" 2>&1 || rc=$?
}
has() { if grep -qF -- "$2" "$tmp/out"; then ok "$1"; else ng "$1" "not in output: $2 / $(tail -5 "$tmp/out" | tr -d '\r' | tr '\n' '|')"; fi; }
hasnt() { if grep -qF -- "$2" "$tmp/out"; then ng "$1" "in output: $2"; else ok "$1"; fi; }
calls() { grep -c "^$1 " "$state/wrangler.log" || true; }
check() { if eval "$2"; then ok "$1"; else ng "$1" "$2"; fi; }

setup "$good"
run '\nwrong-slug\n' publish-tool.sh foo-bar 7
has 'wrong slug: says it did not publish' '公開していない'
check 'wrong slug: exit 1' '[ "$rc" -eq 1 ]'
check 'wrong slug: wrangler deploy is not called' '[ "$(calls deploy)" -eq 0 ]'
has '10007 is treated as not yet published' 'tf-foo-bar は未公開(初回)'
has 'first publish is announced as new' 'として新しく公開する'
has 'full text is shown with a prefix' '| <p>PAGE_MARKER</p>'
has 'content cannot forge a separator line' '| ===== tools/foo-bar/forged.js'
check 'only real files have separator lines' '[ "$(tr -d "\r" <"$tmp/out" | grep -c "^===== ")" -eq 4 ]'
has 'images are listed but not shown' '===== tools/foo-bar/img/a.png(画像。表示しない)'
has 'scan summary: external URL' '[外部 URL (http:// https://)] app.js: 1 件(最初は 2 行目)'
has 'scan summary: fetch' '[通信: fetch(] app.js'
check 'scan summary is shown twice (before the pager and before the prompt)' '[ "$(grep -c "機械検出の要約" "$tmp/out")" -eq 2 ]'
has 'preview URL is shown' 'http://127.0.0.1:'
has 'URL override is announced' 'TF_TOOLS_GIT_URL が設定されている'
check 'deployments list gets the generated config' 'grep -q "^deployments list --name tf-foo-bar --json --config .*/wrangler.jsonc | account=$ACCOUNT" "$state/wrangler.log"'

setup "$good"
run '\nfoo-bar\n' publish-tool.sh foo-bar 7
check 'publish: exit 0' '[ "$rc" -eq 0 ]'
has 'publish: reports the URL' '公開した: https://tf-foo-bar.nakake.com/'
check 'publish: wrangler deploy is called exactly once' '[ "$(calls deploy)" -eq 1 ]'
check 'publish: deploy arguments' 'grep -q "^deploy --message sha=$good pr=7 --config .*/wrangler.jsonc | account=$ACCOUNT\$" "$state/wrangler.log"'
check 'publish: every wrangler call has --config' '! grep -v -- "--config .*/wrangler.jsonc" "$state/wrangler.log" | grep -q .'
cfg() { python3 -I -c 'import json, sys; c = json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$state/deployed.jsonc" "$1"; }
check 'publish: config name' '[ "$(cfg "c[\"name\"]")" = tf-foo-bar ]'
check 'publish: config account_id' '[ "$(cfg "c[\"account_id\"]")" = "$ACCOUNT" ]'
check 'publish: config route pattern' '[ "$(cfg "c[\"routes\"][0][\"pattern\"]")" = tf-foo-bar.nakake.com ]'
check 'publish: config has one route, a custom domain' '[ "$(cfg "(len(c[\"routes\"]), c[\"routes\"][0][\"custom_domain\"])")" = "(1, True)" ]'
check 'publish: workers_dev and preview_urls are off' '[ "$(cfg "(c[\"workers_dev\"], c[\"preview_urls\"])")" = "(False, False)" ]'
want_headers="/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer"
check 'publish: generated _headers' '[ "$(cat "$state/_headers")" = "$want_headers" ]'
want_files="./_headers
./app.js
./img/a.png
./index.html
./note.txt"
check 'publish: deployed files are exactly the tree plus _headers' '[ "$(cat "$state/deployed-files")" = "$want_files" ]'

setup "$good"
touch "$state/no-csp"
run '\nfoo-bar\n' publish-tool.sh foo-bar 7
has 'missing CSP after deploy: loud warning' 'Content-Security-Policy が無い'
check 'missing CSP after deploy: exit 1' '[ "$rc" -eq 1 ]'

setup "$bad"
run '\nfoo-bar\n' publish-tool.sh foo-bar 7
has 'rejected tree: reason is shown' '通常ファイル(100644)以外: mode=120000'
check 'rejected tree: exit 1' '[ "$rc" -eq 1 ]'
check 'rejected tree: wrangler is never called' '[ ! -s "$state/wrangler.log" ]'

setup "$good"
echo '[{"annotations":{"workers/message":"sha='"$old"' pr=3"},"versions":[],"created_on":"2026-10-04T00:00:00Z"}]' >"$state/deployments.json"
run '\nwrong\n' publish-tool.sh foo-bar 7
has 'diff: previous sha is found' "tf-foo-bar は $old で公開済み"
has 'diff: a NUL does not hide the removed line' '-<U+0000>var OLD_MARKER = 2;'
has 'diff: added line is shown' '+var NEW_MARKER'
hasnt 'diff: no "Binary files differ"' 'Binary files'
has 'diff: overwrite is announced' 'を上書きする'
has 'diff: scan summary covers all files' '[外部 URL (http:// https://)] app.js'
check 'diff: no deploy on wrong slug' '[ "$(calls deploy)" -eq 0 ]'

setup "$good"
echo '[{"annotations":{"workers/message":"Automatic deployment on upload."},"versions":[{"version_id":"5a18da52-cf2d-4ab6-9fbf-89d5e58b991e","percentage":100}],"created_on":"2026-10-04T00:00:00Z"}]' >"$state/deployments.json"
echo '{"annotations":{"workers/message":"sha='"$old"' pr=3"}}' >"$state/version.json"
run '\nwrong\n' publish-tool.sh foo-bar 7
has 'previous sha is read from the version when the deployment has none' "tf-foo-bar は $old で公開済み"
check 'versions view gets the generated config' 'grep -q "^versions view 5a18da52-cf2d-4ab6-9fbf-89d5e58b991e --name tf-foo-bar --json --config" "$state/wrangler.log"'

setup "$good"
echo '[{"annotations":{"workers/message":"Automatic deployment on upload."},"versions":[],"created_on":"x"}]' >"$state/deployments.json"
run '\nwrong\n' publish-tool.sh foo-bar 7
has 'published without a recorded sha: full text' '前回の SHA が記録に無い'

setup "$instructed"
run 'n\n' publish-tool.sh foo-bar 7
has 'instruction file in the commit: warning' 'routine への指示が仕込まれた可能性がある'
has 'instruction file in the commit: path is listed' 'tools/CLAUDE.md'
has 'instruction file in the commit: N stops' '中止した'
check 'instruction file in the commit: wrangler is never called' '[ ! -s "$state/wrangler.log" ]'
setup "$instructed"
run 'y\n\nfoo-bar\n' publish-tool.sh foo-bar 7
check 'instruction file in the commit: y continues to deploy' '[ "$(calls deploy)" -eq 1 ]'

setup "$good" "$main_bad"
run 'n\n' publish-tool.sh foo-bar 7
has 'instruction file on the default branch: warning names the branch' 'tools リポジトリの default branch(main) に次のものがある'
has 'instruction file on the default branch: path is listed' '.claude/settings.json'
check 'instruction file on the default branch: no deploy' '[ "$(calls deploy)" -eq 0 ]'

setup "$good"
echo trunk >"$state/default_branch"
run 'n\n' publish-tool.sh foo-bar 7
has 'default branch is not main: warning' 'default branch が main ではない: trunk'
has 'default branch is not main: N stops' '中止した'

setup "$good"
printf '%s\tclaude/tool-other\tmain\tfalse\tOPEN\t7\n' "$good" >"$state/pr.tsv"
run '\nfoo-bar\n' publish-tool.sh foo-bar 7
has 'branch of another slug is refused' 'PR のブランチが claude/tool-foo-bar ではない: claude/tool-other'
check 'branch of another slug: wrangler is never called' '[ ! -s "$state/wrangler.log" ]'
setup "$good"
printf '%s\tclaude/tool-foo-bar\tmain\ttrue\tOPEN\t7\n' "$good" >"$state/pr.tsv"
run '\nfoo-bar\n' publish-tool.sh foo-bar 7
has 'fork PR is refused' 'フォークからの PR は対象外'
setup "$good"
printf '%s\tclaude/tool-foo-bar\tdev\tfalse\tOPEN\t7\n' "$good" >"$state/pr.tsv"
run '\nfoo-bar\n' publish-tool.sh foo-bar 7
has 'base other than main is refused' 'PR の base が main ではない'

setup "$good"
rc=0
out=$(printf '\nfoo-bar\n' | env -u GIT_DIR -u GIT_INDEX_FILE PATH="$tmp/bin:$PATH" STUB_STATE="$state" \
  XDG_CACHE_HOME="$tmp/cache" TF_TOOLS_GIT_URL="file://$tmp/repo.git" \
  bash "$tmp/infra/scripts/publish-tool.sh" foo-bar 7 2>&1) || rc=$?
check 'no terminal: stops' '[ "$rc" -eq 1 ] && grep -qF "標準入力が端末ではない" <<<"$out"'
check 'no terminal: nothing is called' '[ ! -s "$state/wrangler.log" ]'

setup "$good"
run 'foo-bar\n' unpublish-tool.sh foo-bar
has 'unpublish: stops when the Worker does not exist' 'tf-foo-bar は公開されていない'
check 'unpublish: no delete when the Worker does not exist' '[ "$(calls delete)" -eq 0 ]'
setup "$good"
echo '[]' >"$state/deployments.json"
run 'wrong\n' unpublish-tool.sh foo-bar
has 'unpublish: wrong slug stops' '削除していない'
check 'unpublish: no delete on wrong slug' '[ "$(calls delete)" -eq 0 ]'
setup "$good"
echo '[]' >"$state/deployments.json"
run 'foo-bar\n' unpublish-tool.sh foo-bar
check 'unpublish: delete is called once with the config and without --force' \
  '[ "$(calls delete)" -eq 1 ] && grep -q "^delete tf-foo-bar --config .*/wrangler.jsonc | account=$ACCOUNT\$" "$state/wrangler.log"'

finish 'publish-tool / unpublish-tool (通し)'
