# shellcheck shell=bash
# テスト用の共通部品。source した側で $tmp(一時ディレクトリ)を用意しておくこと。
# 作業ツリーを使わずインデックスへ直接エントリを入れる(シンボリックリンクやサブモジュールの
# モードを、ファイルシステムに関係なく作るため)。

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib"
export GIT_DIR="$tmp/repo.git"
export GIT_INDEX_FILE="$tmp/index"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
git init -q --bare "$GIT_DIR"

blob() { git hash-object -w --stdin; }
empty_blob=$(blob </dev/null)
png_blob=$(printf '\x89PNG\r\n\x1a\n0000' | blob)
fake_commit=0123456789abcdef0123456789abcdef01234567

reset() { rm -f "$GIT_INDEX_FILE"; }
# 画像は中身の検査があるので、oid を省いたら拡張子に合う最小の中身を入れる
add() {
  local mode=$1 path=$2 oid=${3:-}
  if [ -z "$oid" ]; then
    case "$path" in
      *.png) oid=$png_blob ;;
      *) oid=$empty_blob ;;
    esac
  fi
  git update-index --add --cacheinfo "$mode,$oid,$path"
}
commit() { git commit-tree -m t "$(git write-tree)"; }

failed=0
total=0
ok() { total=$((total + 1)); echo "ok   $1"; }
ng() { total=$((total + 1)); failed=1; echo "FAIL $1${2:+ ($2)}"; }
finish() {
  echo "$1: $total 件、失敗 $failed"
  exit "$failed"
}
