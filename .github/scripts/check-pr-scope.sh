#!/usr/bin/env bash
# 標準入力に変更ファイルのパス(1 行 1 件)を受け取り、範囲外なら 1 で終わる。
# git diff 側で --no-renames を付けること。リネーム元のパスが落ちると tools/ 外への移動を見逃す。
set -u

slug_re='^[a-z0-9][a-z0-9-]{1,40}$'
allowed_ext_re='\.(html|css|js|svg|png|jpg|webp|ico|json|txt|md)$'
fail=0
dirs=()

err() { echo "NG: $*" >&2; fail=1; }

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    tools/*/*) ;;
    *) err "tools/<slug>/ の外の変更: $f"; continue ;;
  esac
  slug=${f#tools/}
  slug=${slug%%/*}
  if [ "$slug" = "_template" ]; then
    err "tools/_template/ は変更できない: $f"
    continue
  fi
  if ! [[ $slug =~ $slug_re ]]; then
    err "slug が不正: $slug ($f)"
    continue
  fi
  dirs+=("$slug")
  base=${f##*/}
  case "$base" in
    package.json | package-lock.json | wrangler.* | cloudflare.config.* | *.ts | *.mts | *.cts)
      err "禁止されたファイル: $f"; continue ;;
  esac
  if ! [[ $f =~ $allowed_ext_re ]]; then
    err "許可されていない拡張子: $f"
  fi
done

if [ "${#dirs[@]}" -gt 0 ]; then
  n=$(printf '%s\n' "${dirs[@]}" | sort -u | wc -l)
  if [ "$n" -gt 1 ]; then
    err "複数の tools/<slug>/ にまたがっている: $(printf '%s\n' "${dirs[@]}" | sort -u | tr '\n' ' ')"
  fi
fi

exit "$fail"
