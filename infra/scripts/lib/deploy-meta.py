"""wrangler の JSON 出力から、公開時に --message へ入れた sha=<sha> を取り出す。

使い方(JSON は標準入力):
  deploy-meta.py sha      deployments list または versions view の出力から SHA を出す。無ければ何も出さない
  deploy-meta.py version  deployments list の最新デプロイで割合が最大のバージョン ID を出す

--message はバージョンに付き、デプロイ側の workers/message は「Automatic deployment on upload.」に
なることがある(wrangler 4.147.0 で確認)。そのため両方の出力を同じ関数で読めるようにしてある。
"""
import json
import re
import sys

SHA = re.compile(r"(?:^|\s)sha=([0-9a-f]{40})(?:\s|$)")


def latest(deployments):
    # 並び順は文書化されていないので、作成時刻で選ぶ
    return max(deployments, key=lambda d: str(d.get("created_on", "")), default=None)


def message(obj):
    ann = obj.get("annotations") if isinstance(obj, dict) else None
    msg = ann.get("workers/message") if isinstance(ann, dict) else None
    return msg if isinstance(msg, str) else ""


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    target = latest([d for d in data if isinstance(d, dict)]) if isinstance(data, list) else data
    if not isinstance(target, dict):
        return
    if mode == "sha":
        m = SHA.search(message(target))
        if m:
            print(m.group(1))
    elif mode == "version":
        versions = [v for v in target.get("versions") or [] if isinstance(v, dict)]
        top = max(versions, key=lambda v: v.get("percentage") or 0, default=None)
        vid = top.get("version_id") if top else None
        if isinstance(vid, str) and re.fullmatch(r"[0-9a-f-]{36}", vid):
            print(vid)


main()
