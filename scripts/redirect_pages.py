#!/usr/bin/env python3
"""Write the pages GitHub Pages serves at samdengler.github.io/verified-airline/:
one per page of the site, each sending the reader to the same page at
air.dengler.io, and a 404.html that does the same for any other address.

  python3 scripts/redirect_pages.py [--out DIR]

The page list comes from the static pages in build/, so run
scripts/render_airline.py first.  A redirect keeps the address's query, such as
?lean=1, and its anchor.  It needs only Python's standard library.
"""

import argparse
import html
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
OUT = ROOT / "pages"
SITE = "https://air.dengler.io"
PREFIX = "/verified-airline"

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Verified Airline has moved</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="{url}">
<meta http-equiv="refresh" content="0; url={url}">
<script>location.replace({target} + location.search + location.hash);</script>
</head>
<body>
<p>Verified Airline has moved to <a href="{url}">{url}</a>.</p>
</body>
</html>
"""


def page(path, target_js):
    url = SITE + path
    return PAGE.format(url=html.escape(url), target=target_js)


def main():
    ap = argparse.ArgumentParser(description="Write github.io's redirects to air.dengler.io.")
    ap.add_argument("--out", type=Path, default=OUT, help="where to write the pages")
    args = ap.parse_args()
    pages = sorted(BUILD.rglob("index.html"))
    if not pages:
        raise SystemExit("redirect_pages: no pages in build/; run scripts/render_airline.py first")
    if args.out.exists():
        shutil.rmtree(args.out)
    for p in pages:
        rel = p.parent.relative_to(BUILD).as_posix()
        path = "/" if rel == "." else f"/{rel}/"
        out = args.out / p.relative_to(BUILD)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page(path, repr(SITE + path).replace("'", '"')))
    # Any other address under the project site: the same path at air.dengler.io.
    strip = f'location.pathname.replace(/^{PREFIX.replace("/", chr(92) + "/")}\\/?/, "/")'
    (args.out / "404.html").write_text(page("/", f'"{SITE}" + {strip}'))
    print(f"wrote {args.out}: {len(pages)} redirects to {SITE}, and 404.html")


if __name__ == "__main__":
    main()
