#!/usr/bin/env bash
# 使い方: check-tool-tree.sh <git-dir> <sha> <slug>
# コミット <sha> の tools/<slug>/ が公開してよい形かを、作業ツリーに展開せずに調べる。
# 違反があれば理由を標準エラーに出して 1 で終わる。
set -euo pipefail
# [a-z] が大文字に一致するロケールがある。違反パスを %q で出すときに非 ASCII をエスケープさせる意味もある
export LC_ALL=C

MAX_FILES=50
MAX_BYTES=$((5 * 1024 * 1024))
MAX_REPORT=20

if [ $# -ne 3 ]; then
  echo "usage: check-tool-tree.sh <git-dir> <sha> <slug>" >&2
  exit 2
fi
git_dir=$1
sha=$2
slug=$3

[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "NG: sha は 40 桁の 16 進数で指定する" >&2; exit 2; }
[[ $slug =~ ^[a-z][a-z0-9-]{1,38}[a-z0-9]$ ]] || { echo "NG: slug が不正" >&2; exit 2; }

prefix="tools/$slug/"
name_re='^[a-z0-9][a-z0-9._-]*$'
ext_re='\.(html|css|js|svg|png|jpg|webp|ico|json|txt)$'
text_re='\.(html|css|js|svg|json|txt)$'

violations=0
err() {
  violations=$((violations + 1))
  if [ "$violations" -le "$MAX_REPORT" ]; then
    echo "NG: $*" >&2
  fi
}

# パスは AI が決められる文字列なので、そのまま端末に出さない
q() { printf '%q' "$1"; }

g() { git --git-dir="$git_dir" "$@"; }

# 先頭 12 バイトを 16 進で返す。head が先に閉じると git が SIGPIPE で終わるので、その失敗は無視する
head_hex() { { g cat-file blob "$1" 2>/dev/null || true; } | head -c 12 | od -An -tx1 | tr -d ' \n'; }

# 拡張子が画像なのに中身が HTML や JS、という偽装を落とす。
# ブラウザが中身から種類を推測する経路と、本人が「画像だから読まなくてよい」と飛ばす経路の両方を塞ぐ
magic_ok() {
  local rel=$1 hex=$2
  case "$rel" in
    *.png) [[ $hex == 89504e470d0a1a0a* ]] ;;
    *.jpg) [[ $hex == ffd8ff* ]] ;;
    *.webp) [[ $hex == 52494646????????57454250 ]] ;;
    *.ico) [[ $hex == 00000100* ]] ;;
  esac
}

listing=$(mktemp)
trap 'rm -f "$listing"' EXIT
g ls-tree -r -z "$sha" -- "$prefix" >"$listing"

count=0
total=0
has_index=0
truncated=0
while IFS= read -r -d '' entry; do
  meta=${entry%%$'\t'*}
  path=${entry#*$'\t'}
  read -r mode type oid <<<"$meta"
  count=$((count + 1))
  # 違反だらけのツリーで延々と回らない。1 件でも違反なら公開しないので、全部を数える意味は無い
  if [ "$violations" -ge "$MAX_REPORT" ]; then
    truncated=1
    break
  fi

  # 120000(シンボリックリンク)は tools/ の外や手元のファイルを公開しうる。160000(サブモジュール)は
  # 中身がこのコミットに無い。100755 は静的ファイルに要らないので、意図しないものとして落とす
  if [ "$mode" != 100644 ] || [ "$type" != blob ]; then
    err "通常ファイル(100644)以外: mode=$mode $(q "$path")"
    continue
  fi
  if [[ $path != "$prefix"* ]]; then
    err "tools/$slug/ の外: $(q "$path")"
    continue
  fi

  rel=${path#"$prefix"}
  ok=1
  IFS=/ read -r -a parts <<<"$rel"
  # read は改行で止まる。改行を含むパスは parts を繋ぎ直しても元に戻らないので、ここで弾ける
  joined=$(IFS=/; echo "${parts[*]}")
  if [ "$joined" != "$rel" ] || [ "${#parts[@]}" -eq 0 ]; then
    ok=0
  else
    for part in "${parts[@]}"; do
      # 先頭が . や _ のもの(_headers、_redirects、.assetsignore、.well-known など)は
      # Cloudflare 側で特別な意味を持つので一律に落とす
      [[ $part =~ $name_re ]] || ok=0
    done
  fi
  if [ "$ok" -ne 1 ]; then
    err "使えない名前を含むパス: $(q "$path")"
    continue
  fi
  if ! [[ $rel =~ $ext_re ]]; then
    err "許可されていない拡張子: $(q "$path")"
    continue
  fi

  [ "$rel" = index.html ] && has_index=1
  # 上限を超えたら結果は決まっている。大量のファイルや巨大な blob で読み続けない
  [ "$count" -le "$MAX_FILES" ] || continue
  size=$(g cat-file -s "$oid")
  total=$((total + size))
  [ "$total" -le "$MAX_BYTES" ] || continue

  if [[ $rel =~ $text_re ]]; then
    # NUL が 1 個あると git diff が「Binary files differ」だけを出し、中身が本人に見えなくなる
    if [ "$(g cat-file blob "$oid" | tr -d '\000' | wc -c)" -ne "$size" ]; then
      err "テキストのはずのファイルに NUL がある: $(q "$path")"
    fi
  elif ! magic_ok "$rel" "$(head_hex "$oid")"; then
    err "拡張子と中身(先頭バイト)が合わない画像: $(q "$path")"
  fi
done <"$listing"

if [ "$truncated" -eq 1 ]; then
  echo "NG: 違反が $MAX_REPORT 件に達したので検査を打ち切った" >&2
elif [ "$count" -eq 0 ]; then
  err "tools/$slug/ がこのコミットに無い"
else
  [ "$has_index" -eq 1 ] || err "tools/$slug/index.html が無い"
  [ "$count" -le "$MAX_FILES" ] || err "ファイル数が $MAX_FILES を超えている: $count"
  [ "$total" -le "$MAX_BYTES" ] || err "合計サイズが 5MB を超えている: $total バイト"
fi

if [ "$violations" -gt 0 ]; then
  exit 1
fi
echo "OK: tools/$slug/ $count ファイル、$total バイト"
