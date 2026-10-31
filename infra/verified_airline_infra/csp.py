"""The site's content security policy: infra/csp.txt with the hash of every
inline script in the built pages.  Only Python's standard library, so
scripts/publish-site.sh can check a build against the live policy without CDK."""

from __future__ import annotations

import base64
import hashlib
import re
from pathlib import Path

CSP_TEMPLATE = Path(__file__).resolve().parents[1] / "csp.txt"
SCRIPT = re.compile(r"<script([^>]*)>(.*?)</script>", re.S)


def inline_script_hashes(site_dir: Path) -> list[str]:
    """The CSP hash of every inline script in the built pages.  A script of
    type application/json, such as Angular's state, never runs and needs none."""
    pages = sorted(Path(site_dir).rglob("*.html"))
    if not pages:
        raise SystemExit(f"no pages in {site_dir}; build web/ first (npm --prefix web run build)")
    hashes = set()
    for page in pages:
        for attrs, body in SCRIPT.findall(page.read_text()):
            if body.strip() and "application/json" not in attrs:
                digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
                hashes.add(f"'sha256-{digest}'")
    return sorted(hashes)


def content_security_policy(site_dir: Path) -> str:
    return CSP_TEMPLATE.read_text().strip().replace("{script_hashes}", " ".join(inline_script_hashes(site_dir)))


if __name__ == "__main__":
    # python3 infra/verified_airline_infra/csp.py <site dir> "<live policy>"
    # prints each inline script hash the live policy lacks, and fails if any.
    import sys

    live = sys.argv[2].replace(";", " ").split()
    missing = [h for h in inline_script_hashes(Path(sys.argv[1])) if h not in live]
    print("\n".join(missing))
    sys.exit(1 if missing else 0)
