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

violations=0
err() {
  violations=$((violations + 1))
  if [ "$violations" -le "$MAX_REPORT" ]; then
    echo "NG: $*" >&2
  fi
}

# パスは AI が決められる文字列なので、そのまま端末に出さない
q() { printf '%q' "$1"; }

listing=$(mktemp)
trap 'rm -f "$listing"' EXIT
git --git-dir="$git_dir" ls-tree -r -z "$sha" -- "$prefix" >"$listing"

count=0
total=0
has_index=0
while IFS= read -r -d '' entry; do
  meta=${entry%%$'\t'*}
  path=${entry#*$'\t'}
  read -r mode type oid <<<"$meta"
  count=$((count + 1))

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
  # 上限を超えたら結果は決まっている。大量のファイルで cat-file を回し続けない
  if [ "$count" -le "$MAX_FILES" ]; then
    size=$(git --git-dir="$git_dir" cat-file -s "$oid")
    total=$((total + size))
  fi
done <"$listing"

if [ "$count" -eq 0 ]; then
  err "tools/$slug/ がこのコミットに無い"
else
  [ "$has_index" -eq 1 ] || err "tools/$slug/index.html が無い"
  [ "$count" -le "$MAX_FILES" ] || err "ファイル数が $MAX_FILES を超えている: $count"
  [ "$total" -le "$MAX_BYTES" ] || err "合計サイズが 5MB を超えている: $total バイト"
fi

if [ "$violations" -gt 0 ]; then
  if [ "$violations" -gt "$MAX_REPORT" ]; then
    echo "NG: ほか $((violations - MAX_REPORT)) 件" >&2
  fi
  exit 1
fi
echo "OK: tools/$slug/ $count ファイル、$total バイト"
