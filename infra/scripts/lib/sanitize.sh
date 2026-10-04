#!/usr/bin/env bash
# 標準入力を、端末に出しても安全な形にして標準出力へ流す。中身は sanitize.py。
set -euo pipefail
# -I: 環境変数(PYTHONPATH など)と cwd のモジュールを読ませない
exec python3 -I "$(dirname "${BASH_SOURCE[0]}")/sanitize.py"
