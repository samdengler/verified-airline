"""The site's content security policy: infra/csp.txt with the hash of every
inline script in the built pages and the One ID relay's origin.  Only Python's
standard library, so scripts/publish-site.sh can check a build against the live
policy without CDK."""

from __future__ import annotations

import base64
import hashlib
import re
from pathlib import Path
from urllib.parse import urlsplit

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


def origin(url: str) -> str:
    """The origin of a URL, as connect-src names it.  A CDK token passes as it is."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else url


def content_security_policy(site_dir: Path, relay_url: str = "") -> str:
    """The policy.  With no relay, connect-src names none."""
    policy = CSP_TEMPLATE.read_text().strip()
    policy = policy.replace("{script_hashes}", " ".join(inline_script_hashes(site_dir)))
    policy = policy.replace("{relay_origin}", origin(relay_url) if relay_url else "")
    return re.sub(r" {2,}", " ", policy)


def connect_sources(policy: str) -> list[str]:
    for directive in policy.split(";"):
        words = directive.split()
        if words and words[0] == "connect-src":
            return words[1:]
    return []


if __name__ == "__main__":
    # python3 infra/verified_airline_infra/csp.py <site dir> "<live policy>" [<relay URL>]
    # prints each inline script hash the live policy lacks, and the relay's
    # origin if its connect-src lacks it, and fails if anything is missing.
    import sys

    live = sys.argv[2].replace(";", " ").split()
    missing = [h for h in inline_script_hashes(Path(sys.argv[1])) if h not in live]
    if len(sys.argv) > 3 and sys.argv[3] and origin(sys.argv[3]) not in connect_sources(sys.argv[2]):
        missing.append(f"connect-src {origin(sys.argv[3])}")
    print("\n".join(missing))
    sys.exit(1 if missing else 0)
