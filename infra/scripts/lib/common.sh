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

# 手元のプレビューと本番(_headers)で同じ値を使う。違うと、見たものと公開したものの挙動が食い違う。
# インラインの script / style と外部への通信を止める。小物は同じ場所のファイルだけで動く前提
# shellcheck disable=SC2034
TOOL_CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

die() {
  echo "中止: $*" >&2
  exit 1
}

sanitize() { bash "$SCRIPTS_DIR/lib/sanitize.sh"; }

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

# 第 3 引数(アセットのディレクトリ)は公開のときだけ渡す
write_wrangler_config() {
  local out=$1 slug=$2 dir=${3:-} assets=''
  if [ -n "$dir" ]; then
    assets="
  \"assets\": { \"directory\": \"$dir\" },"
  fi
  cat >"$out" <<JSON
{
  "name": "tf-$slug",
  "account_id": "$MAIN_ACCOUNT_ID",
  "compatibility_date": "$COMPATIBILITY_DATE",$assets
  "routes": [{ "pattern": "tf-$slug.$TOOL_DOMAIN", "custom_domain": true }],
  "workers_dev": false,
  "preview_urls": false
}
JSON
}

# wrangler は必ずここを通して呼ぶ。第 1 引数は write_wrangler_config で作った設定。
# wrangler は --config が無いと cwd から親へ設定ファイルを探し、設定の account_id は環境変数より強い。
# 上位のディレクトリに置かれた設定で別のアカウントや別の Worker に向かないよう、自分で作った設定を必ず渡す
wrangler_main() {
  local config=$1
  shift
  (cd "$(dirname "$config")" && CLOUDFLARE_ACCOUNT_ID="$MAIN_ACCOUNT_ID" "$WRANGLER_BIN" "$@" --config "$config")
}

# 結果を DEPLOY_STATE(none / exists)と DEPLOY_JSON(deployments list の出力)に入れる。
# 「存在しない」と「調べられなかった」を取り違えると上書きの警告が抜けるので、後者は中止する
load_deployments() {
  local config=$1 name=$2 err
  err="$(dirname "$config")/deployments.err"
  DEPLOY_JSON=''
  if DEPLOY_JSON=$(wrangler_main "$config" deployments list --name "$name" --json 2>"$err"); then
    DEPLOY_STATE=exists
  elif grep -q 'code: 10007' "$err"; then
    DEPLOY_STATE=none
  else
    sanitize <"$err" >&2
    die "$name のデプロイ状況を取得できなかった"
  fi
}
