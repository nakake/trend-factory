"""使い方: preview-server.py <配信するディレクトリ> <CSP>

公開前に手元で動かすための配信。標準出力に「PORT <番号>」を 1 行出し、以後は標準エラーにアクセスログを出す。

python3 -m http.server を使わない理由:
- ディレクトリ一覧を出す
- 本番と同じヘッダー(CSP など)を付けられない。付けないと、手元では動いた外部通信が本番では止まる、
  またはその逆になり、見たものと公開するものの挙動が食い違う
"""
import os
import posixpath
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# -I で起動すると、スクリプトのあるディレクトリが sys.path に入らない
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sanitize import clean  # noqa: E402

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}
# check-tool-tree.sh が通す名前と同じ形だけを配信する(_headers などは配信しない)
SEGMENT = re.compile(r"[a-z0-9][a-z0-9._-]*")


def make_handler(root, csp):
    class Handler(BaseHTTPRequestHandler):
        server_version = "tf-preview"
        sys_version = ""

        def resolve(self):
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            parts = [p for p in path.split("/") if p]
            if any(not SEGMENT.fullmatch(p) for p in parts):
                return None
            target = os.path.join(root, *parts) if parts else root
            if os.path.isdir(target):
                target = os.path.join(target, "index.html")
            if os.path.islink(target) or not os.path.isfile(target):
                return None
            return target

        def respond(self, body_wanted):
            target = self.resolve()
            ctype = TYPES.get(posixpath.splitext(target)[1]) if target else None
            if not ctype:
                data, status, ctype = b"not found\n", 404, "text/plain; charset=utf-8"
            else:
                with open(target, "rb") as f:
                    data = f.read()
                status = 200
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Security-Policy", csp)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if body_wanted:
                self.wfile.write(data)

        def do_GET(self):
            self.respond(True)

        def do_HEAD(self):
            self.respond(False)

        def log_request(self, code="-", size="-"):
            status = getattr(code, "value", code)
            # パスはページ内のスクリプトが決められる文字列。端末に出す前に置換し、長さも切る
            sys.stderr.write("  [preview] %s %s %s\n" % (clean(str(self.command))[:10], clean(self.path)[:200], status))
            sys.stderr.flush()

        def log_message(self, fmt, *args):
            # 既定の実装は生のリクエスト行を出す(不正なリクエストのエラーなど)
            sys.stderr.write("  [preview] %s\n" % clean(fmt % args)[:200])
            sys.stderr.flush()

    return Handler


def main():
    if len(sys.argv) != 3 or not os.path.isdir(sys.argv[1]):
        sys.exit("usage: preview-server.py <dir> <csp>")
    root = os.path.realpath(sys.argv[1])
    # 外から届かないよう loopback だけに bind する。ポートは OS に空きを選ばせる
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(root, sys.argv[2]))
    print("PORT %d" % server.server_address[1], flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


main()
