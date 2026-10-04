# shellcheck shell=bash
# publish-tool.sh / unpublish-tool.sh が source する共通設定。

# 本人の wrangler ログインは本体とプレビュー専用の 2 アカウントに属する。
# 指定しないと wrangler が対話で選ばせるか、意図しないほうを使うので、必ずこの値を渡す。
# shellcheck disable=SC2034
MAIN_ACCOUNT_ID='d49004aee2b170cd870967a1a9cdc1d1'
# shellcheck disable=SC2034
TOOL_DOMAIN='nakake.com'
# shellcheck disable=SC2034
TOOLS_REPO='nakake/trend-factory-tools'
# 挙動が日付で変わるのを避けるため固定。更新は手動(core / console の wrangler.jsonc と揃える)
# shellcheck disable=SC2034
COMPATIBILITY_DATE='2026-10-01'
