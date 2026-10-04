#!/usr/bin/env bash
# 使い方: pnpm -C infra unpublish-tool <slug>
# 本番の tf-<slug>(Worker と Custom Domain)を削除する。tools リポジトリのコードは消さない。
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=config.sh
. "$here/config.sh"
# shellcheck source=lib/common.sh
. "$here/lib/common.sh"

if [ $# -ne 1 ]; then
  echo "usage: pnpm -C infra unpublish-tool <slug>" >&2
  exit 2
fi
slug=$1
valid_slug "$slug" || die "slug が不正(^[a-z][a-z0-9-]{1,38}[a-z0-9]\$)"
require_tty
need_cmd python3
need_wrangler

empty=$(mktemp -d)
trap 'rm -rf "$empty"' EXIT

load_deployments "$empty" "tf-$slug"
[ "$DEPLOY_STATE" = exists ] || die "tf-$slug は公開されていない"

echo "https://tf-$slug.$TOOL_DOMAIN/ を取り下げる(Worker tf-$slug を削除)。"
read -r -p "取り下げるには slug を入力: " typed
[ "$typed" = "$slug" ] || die "入力が slug と一致しない。削除していない"

# 名前は位置引数で渡す(wrangler 4.147.0 の help にあるのはこの形だけ)
wrangler_main "$empty" delete "tf-$slug" --force
echo "取り下げた: tf-$slug"
