"""使い方: scan-tool.py <展開した小物のディレクトリ>

本人が読む前に、公開物として怪しい書き方を機械的に拾って要約する。該当が無ければ何も出さない。
出すのは規則名、ファイル名、件数、最初の行番号だけで、ファイルの中身は出さない
(中身は AI が書く文字列なので、要約の表示を偽装させない)。
誤検出は多い。止めるためではなく、ページャで読むときに見る場所を示すためのもの。
"""
import os
import re
import sys

TEXT_EXT = (".html", ".css", ".js", ".svg", ".json", ".txt")
LONG_LINE = 500

I = re.IGNORECASE
RULES = [
    ("外部 URL (http:// https://)", re.compile(r"https?://", I)),
    ("外部 URL (// で始まる src/href)", re.compile(r"\b(?:src|href)\s*=\s*[\"']?\s*//", I)),
    ("通信: fetch(", re.compile(r"\bfetch\s*\(")),
    ("通信: XMLHttpRequest", re.compile(r"XMLHttpRequest")),
    ("通信: WebSocket", re.compile(r"WebSocket")),
    ("通信: EventSource", re.compile(r"EventSource")),
    ("通信: sendBeacon", re.compile(r"sendBeacon")),
    ("読み込み: import(", re.compile(r"\bimport\s*\(")),
    ("読み込み: importScripts", re.compile(r"importScripts")),
    ("serviceWorker", re.compile(r"serviceWorker")),
    ("文字列の実行: eval(", re.compile(r"\beval\s*\(")),
    ("文字列の実行: Function(", re.compile(r"\bFunction\s*\(")),
    ("難読化: atob", re.compile(r"\batob\b")),
    ("難読化: fromCharCode", re.compile(r"fromCharCode")),
    ("base64 風の 200 文字以上の連続", re.compile(r"[A-Za-z0-9+/=]{200,}")),
    ("<iframe", re.compile(r"<iframe", I)),
    ("<form", re.compile(r"<form", I)),
    ("<base", re.compile(r"<base\b", I)),
    ("http-equiv", re.compile(r"http-equiv", I)),
    ("srcdoc", re.compile(r"srcdoc", I)),
    ("javascript:", re.compile(r"javascript:", I)),
    # href="data:," (空の data URL。favicon の 404 を出さないための定型)だけは中身が無いので数えない
    ("data:", re.compile(r"data:(?!,[\"'])", I)),
    ("on...= (イベント属性)", re.compile(r"\bon[a-z]+\s*=", I)),
    ("@import", re.compile(r"@import", I)),
    ("url(", re.compile(r"\burl\s*\(", I)),
]
LONG = "%d 文字を超える行" % LONG_LINE
NON_ASCII = "非 ASCII を含む .js / .css"
ORDER = [name for name, _ in RULES] + [LONG, NON_ASCII]


def scan(root):
    """{規則名: [(ファイル, 件数, 最初の行番号)]} を返す"""
    hits = {}
    for base, dirs, files in os.walk(root):
        dirs.sort()
        for fn in sorted(files):
            if not fn.endswith(TEXT_EXT):
                continue
            path = os.path.join(base, fn)
            rel = os.path.relpath(path, root)
            with open(path, "rb") as f:
                lines = f.read().decode("utf-8", "replace").split("\n")
            per = {}

            def add(rule, lineno, n=1):
                count, first = per.get(rule, (0, lineno))
                per[rule] = (count + n, first)

            for no, line in enumerate(lines, 1):
                for name, pat in RULES:
                    n = len(pat.findall(line))
                    if n:
                        add(name, no, n)
                if len(line) > LONG_LINE:
                    add(LONG, no)
                if fn.endswith((".js", ".css")) and not line.isascii():
                    add(NON_ASCII, no)
            for rule, (count, first) in per.items():
                hits.setdefault(rule, []).append((rel, count, first))
    return hits


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: scan-tool.py <dir>")
    hits = scan(sys.argv[1])
    for rule in ORDER:
        for rel, count, first in hits.get(rule, []):
            print("  [%s] %s: %d 件(最初は %d 行目)" % (rule, rel, count, first))


main()
