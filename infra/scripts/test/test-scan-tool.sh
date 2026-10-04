#!/usr/bin/env bash
# scan-tool.py(機械検出)と preview-server.py(手元の配信)のテスト。
set -euo pipefail

lib="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib"
tmp=$(mktemp -d)
server_pid=''
cleanup() {
  [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
failed=0
total=0
ok() { total=$((total + 1)); echo "ok   $1"; }
ng() { total=$((total + 1)); failed=1; echo "FAIL $1${2:+ ($2)}"; }

scan() { python3 -I "$lib/scan-tool.py" "$1"; }
# hit <名前> <ファイル名> <中身(printf 書式)> <出力に含まれるはずの文字列>
hit() {
  local name=$1 file=$2 body=$3 want=$4 d out
  d=$(mktemp -d -p "$tmp")
  # shellcheck disable=SC2059
  printf "$body" >"$d/$file"
  out=$(scan "$d")
  if grep -qF -- "$want" <<<"$out"; then ok "scan: $name"; else ng "scan: $name" "got: $out"; fi
}
clean() {
  local name=$1 file=$2 body=$3 d out
  d=$(mktemp -d -p "$tmp")
  # shellcheck disable=SC2059
  printf "$body" >"$d/$file"
  out=$(scan "$d")
  if [ -z "$out" ]; then ok "scan: $name"; else ng "scan: $name" "got: $out"; fi
}

clean 'plain page has no hits' index.html '<!doctype html>\n<title>t</title>\n<script src="app.js"></script>\n<link rel="stylesheet" href="style.css">\n'
clean 'plain script has no hits' app.js 'const position = 1;\ndocument.getElementById("run").addEventListener("click", () => {});\n'
clean 'Japanese in html and json is fine' index.html '<p>こんにちは</p>\n'
clean 'images are not scanned' a.png 'fetch("https://evil.example")\n'

hit 'https URL' app.js 'x\ny = "https://evil.example/a";\n' '[外部 URL (http:// https://)] app.js: 1 件(最初は 2 行目)'
hit 'http URL, uppercase' a.html '<a href="HTTP://x">' '外部 URL (http:// https://)'
hit 'protocol-relative src' a.html '<script src="//evil.example/x.js"></script>\n' '外部 URL (// で始まる src/href)'
hit 'protocol-relative href, unquoted' a.html '<link href=//evil.example/x.css>\n' '外部 URL (// で始まる src/href)'
hit 'fetch' app.js 'fetch("/x")\n' '通信: fetch('
hit 'fetch with a space' app.js 'fetch ("/x")\n' '通信: fetch('
hit 'XMLHttpRequest' app.js 'new XMLHttpRequest()\n' '通信: XMLHttpRequest'
hit 'WebSocket' app.js 'new WebSocket(u)\n' '通信: WebSocket'
hit 'EventSource' app.js 'new EventSource(u)\n' '通信: EventSource'
hit 'sendBeacon' app.js 'navigator.sendBeacon(u)\n' '通信: sendBeacon'
hit 'dynamic import' app.js 'await import("./x.js")\n' '読み込み: import('
hit 'importScripts' app.js 'importScripts("x.js")\n' '読み込み: importScripts'
hit 'serviceWorker' app.js 'navigator.serviceWorker.register("sw.js")\n' 'serviceWorker'
hit 'eval' app.js 'eval(s)\n' '文字列の実行: eval('
hit 'Function constructor' app.js 'new Function("return 1")\n' '文字列の実行: Function('
hit 'atob' app.js 'atob(s)\n' '難読化: atob'
hit 'fromCharCode' app.js 'String.fromCharCode(1)\n' '難読化: fromCharCode'
hit 'base64 run of 200' app.js "var s = \"$(printf 'A%.0s' $(seq 1 200))\";\\n" 'base64 風の 200 文字以上の連続'
clean 'base64 run of 199' app.js "var s = \"$(printf 'A%.0s' $(seq 1 199))\";\\n"
hit 'iframe' a.html '<IFRAME src=x>\n' '<iframe'
hit 'form' a.html '<form action=x>\n' '<form'
hit 'base' a.html '<base href="/x/">\n' '<base'
hit 'http-equiv' a.html '<meta http-equiv="refresh" content="0">\n' 'http-equiv'
hit 'srcdoc' a.html '<x srcdoc="y">\n' 'srcdoc'
hit 'javascript: URL' a.html '<a href="JavaScript:void(0)">\n' 'javascript:'
hit 'data: URL' style.css 'a{background:URL(data:image/png;base64,AA)}\n' 'data:'
clean 'empty data URL for the favicon is not counted' index.html '<link rel="icon" href="data:,">\n'
hit 'data URL with a payload after the comma' a.html '<link rel="icon" href="data:,x">\n' 'data:'
hit 'data URL with a media type' a.html '<img src="data:image/png;base64,AA">\n' 'data:'
hit 'event attribute' a.html '<img src="a.png" onerror="x()">\n' 'on...= (イベント属性)'
hit 'event attribute with spaces' a.html '<body onload = "x()">\n' 'on...= (イベント属性)'
hit '@import' style.css '@import "x.css";\n' '@import'
hit 'css url()' style.css 'a{background:url(a.png)}\n' 'url('
hit 'svg is scanned as text' a.svg '<svg onload="x()"></svg>\n' 'a.svg'
hit 'json is scanned' data.json '{"u":"https://x"}\n' 'data.json'
hit 'line of 501 characters' a.txt "$(printf 'a %.0s' $(seq 1 250))x\\n" '500 文字を超える行'
clean 'line of 500 characters' a.txt "$(printf 'a %.0s' $(seq 1 250))\\n"
hit 'non-ASCII in js' app.js 'var a = 1;\nvar b = "あ";\n' '[非 ASCII を含む .js / .css] app.js: 1 件(最初は 2 行目)'
hit 'non-ASCII in css' style.css 'a::before{content:"あ"}\n' '非 ASCII を含む .js / .css'
hit 'counts every occurrence and reports the first line' app.js 'a\nfetch(1); fetch(2)\nfetch(3)\n' 'app.js: 3 件(最初は 2 行目)'

d=$(mktemp -d -p "$tmp")
mkdir "$d/sub"
printf 'eval(x)\n' >"$d/sub/deep.js"
printf 'eval(\033[2Kx)\n<script>\n' >"$d/b.js"
out=$(scan "$d")
if grep -qF 'sub/deep.js' <<<"$out"; then ok 'scan: subdirectories are scanned'; else ng 'scan: subdirectories are scanned' "$out"; fi
if LC_ALL=C grep -qP '[\x00-\x08\x0b-\x1f]|<script' <<<"$out"; then
  ng 'scan: output never contains file content'
else
  ok 'scan: output never contains file content'
fi

# preview-server.py
CSP="default-src 'self'; script-src 'self'"
site="$tmp/site"
mkdir -p "$site/img" "$site/sub" "$site/nodir"
printf '<p>index</p>\n' >"$site/index.html"
printf 'x=1\n' >"$site/app.js"
printf '<p>sub</p>\n' >"$site/sub/index.html"
printf 'png' >"$site/img/a.png"
printf '/*\n  X: y\n' >"$site/_headers"
printf 'secret\n' >"$tmp/outside.txt"
ln -s "$tmp/outside.txt" "$site/link.txt"

python3 -I -B "$lib/preview-server.py" "$site" "$CSP" >"$tmp/port" 2>"$tmp/log" &
server_pid=$!
port=''
for _ in $(seq 1 50); do
  if read -r _ port <"$tmp/port" && [ -n "$port" ]; then break; fi
  sleep 0.1
done
base="http://127.0.0.1:$port"
get() { curl -s --path-as-is -D "$tmp/h" -o "$tmp/b" -w '%{http_code}' "$base$1" || true; }
status() {
  local name=$1 path=$2 want=$3 got
  got=$(get "$path")
  if [ "$got" = "$want" ]; then ok "preview: $name"; else ng "preview: $name" "status $got"; fi
}

if [[ $port =~ ^[0-9]+$ ]]; then ok 'preview: prints its port'; else ng 'preview: prints its port'; fi
status 'serves index.html at /' / 200
if grep -q '<p>index</p>' "$tmp/b"; then ok 'preview: body of index.html'; else ng 'preview: body of index.html'; fi
hdr() {
  if grep -qiF -- "$2" "$tmp/h"; then ok "preview: $1"; else ng "preview: $1" "$(tr -d '\r' <"$tmp/h" | tr '\n' '|')"; fi
}
hdr 'CSP header' "Content-Security-Policy: $CSP"
hdr 'nosniff header' 'X-Content-Type-Options: nosniff'
hdr 'referrer policy header' 'Referrer-Policy: no-referrer'
hdr 'html content type' 'Content-Type: text/html'
status 'serves a script' /app.js 200
hdr 'javascript content type' 'Content-Type: text/javascript'
status 'serves a file in a subdirectory' /img/a.png 200
status 'serves index.html of a subdirectory' /sub/ 200
status 'query string is ignored' '/app.js?x=1' 200
status 'no directory listing' /nodir/ 404
hdr 'CSP header on 404' "Content-Security-Policy: $CSP"
if grep -q 'a.png\|Directory listing' "$tmp/b"; then ng 'preview: 404 body has no listing'; else ok 'preview: 404 body has no listing'; fi
status 'no listing for a directory without index' /img/ 404
status 'does not serve _headers' /_headers 404
status 'does not follow symlinks' /link.txt 404
status 'path traversal' /../outside.txt 404
status 'encoded path traversal' /%2e%2e/outside.txt 404
status 'encoded slash traversal' '/..%2foutside.txt' 404
status 'missing file' /nope.js 404
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/" || true)
if [ "$code" = 501 ]; then ok 'preview: POST is not implemented'; else ng 'preview: POST is not implemented' "$code"; fi
curl -s -o /dev/null --path-as-is "$base/a%1b%5b2Kb%e2%80%ae.js" || true
sleep 0.2
if grep -qF '[preview] GET /app.js 200' "$tmp/log"; then ok 'preview: access log has method, path, status'; else ng 'preview: access log' "$(head -3 "$tmp/log")"; fi
if grep -qF '[preview] GET /nope.js 404' "$tmp/log"; then ok 'preview: access log records 404'; else ng 'preview: access log records 404'; fi
if LC_ALL=C grep -qP '\x1b' "$tmp/log"; then ng 'preview: log has no raw escape'; else ok 'preview: log has no raw escape'; fi
if ss -ltnH "sport = :$port" | grep -q '127.0.0.1:'; then ok 'preview: listens on 127.0.0.1 only'; else ng 'preview: listens on 127.0.0.1 only' "$(ss -ltnH "sport = :$port")"; fi

if python3 -I "$lib/preview-server.py" "$tmp/no-such-dir" "$CSP" >/dev/null 2>&1; then
  ng 'preview: fails to start on a missing directory'
else
  ok 'preview: fails to start on a missing directory'
fi

echo "scan-tool / preview-server: $total 件、失敗 $failed"
exit "$failed"
