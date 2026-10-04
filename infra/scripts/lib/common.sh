# shellcheck shell=bash
# publish-tool.sh / unpublish-tool.sh が source する。config.sh を先に読んでおくこと。

# [a-z] の範囲は照合順序で変わり、大文字に一致するロケールがある。
# LC_ALL=C にすると日本語の表示まで壊れるので、照合順序だけを固定する
if [ -n "${LC_ALL:-}" ]; then
  export LANG="$LC_ALL"
  unset LC_ALL
fi
export LC_COLLATE=C

SCRIPTS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
INFRA_DIR=$(cd "$SCRIPTS_DIR/.." && pwd)
# npx で取ってくると、その時点の最新版と依存が本人の権限で動く。ロックファイルで固定した版だけを使う
WRANGLER_BIN="$INFRA_DIR/core/node_modules/.bin/wrangler"

die() {
  echo "中止: $*" >&2
  exit 1
}

valid_slug() {
  [[ $1 =~ ^[a-z][a-z0-9-]{1,38}[a-z0-9]$ ]]
}

# `yes |` やパイプで確認を流し込めないようにする。他のプログラムや AI のセッションから呼ばれた場合に止めるため
require_tty() {
  [ -t 0 ] || die "標準入力が端末ではない。本人が端末から直接実行すること"
}

need_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "$c が見つからない"
  done
}

need_wrangler() {
  [ -x "$WRANGLER_BIN" ] || die "wrangler が無い。先に pnpm -C infra install を実行すること"
}

# cwd を空のディレクトリにして呼ぶ。infra/core で呼ぶと core の wrangler.jsonc を拾い、
# --name の解釈しだいで trend-factory-core 自体を操作しかねない
wrangler_main() {
  local empty=$1
  shift
  (cd "$empty" && CLOUDFLARE_ACCOUNT_ID="$MAIN_ACCOUNT_ID" "$WRANGLER_BIN" "$@")
}

# 結果を DEPLOY_STATE(none / exists)と DEPLOY_JSON(deployments list の出力)に入れる。
# 「存在しない」と「調べられなかった」を取り違えると上書きの警告が抜けるので、後者は中止する
load_deployments() {
  local empty=$1 name=$2 err
  err=$(mktemp)
  DEPLOY_JSON=''
  if DEPLOY_JSON=$(wrangler_main "$empty" deployments list --name "$name" --json 2>"$err"); then
    DEPLOY_STATE=exists
  elif grep -q 'code: 10007' "$err"; then
    DEPLOY_STATE=none
  else
    bash "$SCRIPTS_DIR/lib/sanitize.sh" <"$err" >&2
    rm -f "$err"
    die "$name のデプロイ状況を取得できなかった"
  fi
  rm -f "$err"
}

write_wrangler_config() {
  local out=$1 slug=$2 dir=$3
  cat >"$out" <<JSON
{
  "name": "tf-$slug",
  "compatibility_date": "$COMPATIBILITY_DATE",
  "assets": { "directory": "$dir" },
  "routes": [{ "pattern": "tf-$slug.$TOOL_DOMAIN", "custom_domain": true }],
  "workers_dev": false,
  "preview_urls": false
}
JSON
}
