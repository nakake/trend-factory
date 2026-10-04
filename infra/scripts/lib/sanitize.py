"""端末に出しても安全な形にするフィルタ(標準入力 → 標準出力)。

AI が書いたファイルや差分をそのまま端末に出すと、ESC でカーソルを動かして行を書き換えたり、
CR で行頭を上書きしたり、双方向制御文字や見えない文字で、本人が読んでいる中身を偽装できる。
危ない文字を数え上げる方式は、Unicode に見えない文字が増えるたびに漏れる。
通す文字のほうを決め、それ以外はすべて <U+XXXX> にする。
"""
import re
import sys

# 通すもの: ASCII の印字可能文字、タブ、改行、CJK の記号と句読点(全角空白 U+3000 は除く)、
# ひらがな、カタカナ、CJK 統合漢字、全角英数記号。
# 半角カナ領域(U+FFA0 は見えないハングル)や互換領域は入れない
BLOCKED = re.compile("[^\\x20-\\x7e\\t\\n\\u3001-\\u303f\\u3041-\\u3096\\u309b-\\u30ff\\u4e00-\\u9fff\\uff01-\\uff5e]")


def clean(text):
    return BLOCKED.sub(lambda m: "<U+%04X>" % ord(m.group()), text)


def main():
    out = sys.stdout
    out.reconfigure(encoding="utf-8", errors="replace", newline="\n")
    try:
        for line in sys.stdin.buffer:
            # 不正な UTF-8 は U+FFFD になり、上の置換で <U+FFFD> と出る
            out.write(clean(line.decode("utf-8", "replace")))
        out.flush()
    except BrokenPipeError:
        sys.stderr.close()


if __name__ == "__main__":
    main()
