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
# コードポイントを UTF-8 にして挟み、<U+XXXX> になることを確かめる
blocked() {
  local name=$1 cp=$2 ch
  ch=$(python3 -I -c 'import sys; sys.stdout.buffer.write(chr(int(sys.argv[1], 16)).encode())' "$cp")
  expect "$name (U+$cp)" "a${ch}b\\n" "a<U+$cp>b"$'\n'
}
passes() {
  local name=$1 cp=$2 ch
  ch=$(python3 -I -c 'import sys; sys.stdout.buffer.write(chr(int(sys.argv[1], 16)).encode())' "$cp")
  expect "$name (U+$cp) passes" "a${ch}b\\n" "a${ch}b"$'\n'
}

expect 'ASCII, tab and newline pass through' 'a\tb ~!\nc\n' $'a\tb ~!\nc\n'
expect 'Japanese passes through' 'ひらがな、カタカナー・漢字。「全角ＡＢＣ１２３!」\n' $'ひらがな、カタカナー・漢字。「全角ＡＢＣ１２３!」\n'
expect 'no trailing newline' 'a\033' 'a<U+001B>'
expect 'empty input' '' ''
expect 'CR cannot overwrite the line' 'safe\rEVIL\n' $'safe<U+000D>EVIL\n'
expect 'CRLF' 'a\r\n' $'a<U+000D>\n'
expect 'raw 0x9b (invalid UTF-8)' 'a\233b\n' $'a<U+FFFD>b\n'
expect 'truncated multibyte sequence' 'a\343\201b\n' $'a<U+FFFD>b\n'

passes 'ideographic comma' 3001
passes 'last of CJK symbols' 303F
passes 'hiragana' 3042
passes 'katakana' 30A2
passes 'kanji first' 4E00
passes 'kanji last' 9FFF
passes 'fullwidth first' FF01
passes 'fullwidth last' FF5E

expect 'NUL (U+0000)' 'a\000b\n' $'a<U+0000>b\n'
blocked 'BEL' 0007
blocked 'backspace' 0008
blocked 'vertical tab' 000B
blocked 'form feed' 000C
blocked 'ESC' 001B
blocked 'DEL' 007F
blocked 'C1 CSI' 009B
blocked 'no-break space' 00A0
blocked 'soft hyphen' 00AD
blocked 'Latin letter outside ASCII' 00E9
blocked 'Cyrillic lookalike' 0430
blocked 'Arabic letter mark' 061C
blocked 'Hangul choseong filler' 115F
blocked 'en quad' 2000
blocked 'thin space' 2009
blocked 'zero width space' 200B
blocked 'zero width joiner' 200D
blocked 'left-to-right mark' 200E
blocked 'line separator' 2028
blocked 'paragraph separator' 2029
blocked 'right-to-left override' 202E
blocked 'narrow no-break space' 202F
blocked 'medium mathematical space' 205F
blocked 'word joiner' 2060
blocked 'invisible times' 2062
blocked 'isolate' 2066
blocked 'braille blank' 2800
blocked 'ideographic space' 3000
blocked 'combining voiced mark' 3099
blocked 'Hangul filler' 3164
blocked 'variation selector' FE0F
blocked 'BOM' FEFF
blocked 'fullwidth left white parenthesis' FF5F
blocked 'halfwidth katakana' FF71
blocked 'halfwidth Hangul filler' FFA0
blocked 'private use' E000
blocked 'private use (plane 15)' F0000
blocked 'tag character' E0041
blocked 'variation selector supplement' E0100
blocked 'emoji' 1F600
blocked 'CJK extension B' 20000

total=$((total + 1))
if grep 're.compile' "$lib/sanitize.py" | LC_ALL=C grep -qP '[^\x00-\x7f]' || ! grep -q 're.compile' "$lib/sanitize.py"; then
  echo "FAIL the pattern in sanitize.py is written with escapes only"
  failed=1
else
  echo "ok   the pattern in sanitize.py is written with escapes only"
fi

# deploy-meta.py: wrangler 4.147.0 の実際の出力の形で確かめる
expect_meta() {
  local name=$1 mode=$2 json=$3 want=$4 got
  total=$((total + 1))
  got=$(python3 -I "$lib/deploy-meta.py" "$mode" <<<"$json")
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
