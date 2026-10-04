#!/usr/bin/env bash
# 標準入力を、端末に出しても安全な形にして標準出力へ流すフィルタ。
# AI が書いたファイルや差分をそのまま端末に出すと、ESC でカーソルを動かして行を書き換えたり、
# CR で行頭を上書きしたり、双方向制御文字で見た目の順序を入れ替えたりして、
# 本人が読んでいる中身を偽装できる。改行とタブ以外の制御文字を可視の文字に置き換える。
set -euo pipefail

exec python3 -c '
import re, sys

# C0(改行・タブ以外)、DEL、C1、双方向制御、ゼロ幅、行・段落区切り、BOM
PAT = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f؜᠎​-‏ -‮⁠-⁩﻿￹-￻]")

def rep(m):
    c = ord(m.group())
    if c < 0x20:
        return chr(0x2400 + c)
    if c == 0x7f:
        return "␡"
    return "<U+%04X>" % c

out = sys.stdout
out.reconfigure(encoding="utf-8", errors="replace", newline="\n")
try:
    for line in sys.stdin.buffer:
        # 不正な UTF-8 は U+FFFD にする(8 ビットの CSI 0x9b を生で通さない)
        out.write(PAT.sub(rep, line.decode("utf-8", "replace")))
    out.flush()
except BrokenPipeError:
    # ページャを途中で閉じただけ
    sys.stderr.close()
'
