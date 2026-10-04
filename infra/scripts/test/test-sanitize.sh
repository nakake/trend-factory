#!/usr/bin/env bash
set -euo pipefail

lib="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib"
failed=0
total=0

# 入力は printf の書式(\033 など)で渡し、出力は期待する文字列とそのまま比べる
expect() {
  local name=$1 input=$2 want=$3 got
  total=$((total + 1))
  # shellcheck disable=SC2059
  got=$(printf "$input" | bash "$lib/sanitize.sh"; echo x)
  got=${got%x}
  if [ "$got" = "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    printf '  want: %q\n  got:  %q\n' "$want" "$got"
    failed=1
  fi
}

expect 'plain text, tab and newline pass through' 'a\tb\nc\n' $'a\tb\nc\n'
expect 'Japanese passes through' '日本語 ✓\n' $'日本語 ✓\n'
expect 'ESC' 'x\033[2Ky\n' $'x␛[2Ky\n'
expect 'CR' 'safe\rEVIL\n' $'safe␍EVIL\n'
expect 'CRLF' 'a\r\n' $'a␍\n'
expect 'NUL, BEL, BS' 'a\000b\007c\010d\n' $'a␀b␇c␈d\n'
expect 'DEL' 'a\177b\n' $'a␡b\n'
expect 'C1 CSI as UTF-8' 'a\302\233b\n' $'a<U+009B>b\n'
expect 'raw 0x9b (invalid UTF-8)' 'a\233b\n' $'a\357\277\275b\n'
expect 'right-to-left override' 'a\342\200\256b\n' $'a<U+202E>b\n'
expect 'isolates' '\342\201\246x\342\201\251\n' $'<U+2066>x<U+2069>\n'
expect 'zero width space and BOM' 'a\342\200\213b\357\273\277\n' $'a<U+200B>b<U+FEFF>\n'
expect 'line separator' 'a\342\200\250b\n' $'a<U+2028>b\n'
expect 'no trailing newline' 'a\033' 'a␛'
expect 'empty input' '' ''

# deploy-meta.py: wrangler 4.147.0 の実際の出力の形で確かめる
meta() { python3 "$lib/deploy-meta.py" "$@"; }
expect_meta() {
  local name=$1 mode=$2 json=$3 want=$4 got
  total=$((total + 1))
  got=$(meta "$mode" <<<"$json")
  if [ "$got" = "$want" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name (want '$want', got '$got')"
    failed=1
  fi
}

sha_a=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
sha_b=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
vid=5a18da52-cf2d-4ab6-9fbf-89d5e58b991e
no_msg='[{"id":"d1","annotations":{"workers/message":"Automatic deployment on upload.","workers/triggered_by":"upload"},"versions":[{"version_id":"'$vid'","percentage":100}],"created_on":"2026-10-04T01:07:56.177843Z"}]'
two='[{"id":"new","annotations":{"workers/message":"sha='$sha_b' pr=9"},"versions":[],"created_on":"2026-10-05T00:00:00Z"},{"id":"old","annotations":{"workers/message":"sha='$sha_a' pr=3"},"versions":[],"created_on":"2026-10-04T00:00:00Z"}]'
version='{"id":"'$vid'","annotations":{"workers/message":"sha='$sha_a' pr=12","workers/triggered_by":"upload"}}'

expect_meta 'deployment without our message has no sha' sha "$no_msg" ''
expect_meta 'version id of the latest deployment' version "$no_msg" "$vid"
expect_meta 'newest deployment wins regardless of order' sha "$two" "$sha_b"
expect_meta 'sha from a version' sha "$version" "$sha_a"
expect_meta 'short sha is ignored' sha '{"annotations":{"workers/message":"sha=abc123 pr=1"}}' ''
expect_meta 'sha must be a whole token' sha '{"annotations":{"workers/message":"xsha='$sha_a'0"}}' ''
expect_meta 'empty list' sha '[]' ''
expect_meta 'not JSON' sha 'error: boom' ''
expect_meta 'no versions' version '[{"created_on":"x"}]' ''

echo "sanitize / deploy-meta: $total 件、失敗 $failed"
exit "$failed"
