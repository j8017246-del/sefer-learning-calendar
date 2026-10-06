#!/usr/bin/env python3
"""Build the learning calendar as one page for the claude.ai preview.

Styles and scripts are written into the page. By default the data files stay
separate (published next to the page and fetched when a sefer is opened).
With --pack, every data file is packed into the page too (gzip + base64), so
the page fetches nothing else.

Usage: python3 tools/build_preview.py OUT.html [--pack]
"""
import base64
import gzip
import json
import sys
from pathlib import Path

LEARN = Path(__file__).resolve().parent.parent / "learn"


def main(out, pack=False):
    src = (LEARN / "index.html").read_text(encoding="utf-8")
    body = src[src.index("<body>") + 6:src.index("</body>")]
    packed = {}
    for f in sorted((LEARN / "data").rglob("*.json")) if pack else []:
        rel = "data/" + f.relative_to(LEARN / "data").as_posix()
        packed[rel] = base64.b64encode(gzip.compress(f.read_bytes(), 9, mtime=0)).decode()
    data_js = "window.LEARN_DATA = " + json.dumps(packed, separators=(",", ":")) + ";" if pack else ""
    for name in ["engine/sefer.js", "engine/schedule.js", "app.js"]:
        tag = f'<script src="{name}"></script>'
        assert tag in body, name
        code = (LEARN / name).read_text(encoding="utf-8")
        if name == "app.js":
            code = data_js + "\n" + code
        body = body.replace(tag, "<script>\n" + code + "\n</script>")
    head = src[:src.index("<body>")]
    fonts = "\n".join(line.strip() for line in head.splitlines() if "fonts.googleapis.com" in line)
    page = ("<title>Learning Calendar</title>\n<meta name=\"theme-color\" content=\"#1f3a5f\">\n" + fonts + "\n<style>\n"
            + (LEARN / "app.css").read_text(encoding="utf-8") + "\n</style>\n" + body)
    Path(out).write_text(page, encoding="utf-8")
    print(f"{out}: {len(page.encode()) / 1e6:.1f} MB" + (f", {len(packed)} data files packed" if pack else ", data files separate"))


if __name__ == "__main__":
    main(sys.argv[1], "--pack" in sys.argv[2:])
