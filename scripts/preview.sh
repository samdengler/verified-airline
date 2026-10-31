#!/usr/bin/env bash
# Render the pages and serve them at http://localhost:8001/ (or the port
# given), to review a change before it is pushed.  verified-air's preview uses
# port 8000, so both can run at once.
#
#   scripts/preview.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
port="${1:-8001}"
python3 scripts/render_airline.py
echo "serving build/ at http://localhost:$port/ (Ctrl-C to stop)"
python3 -m http.server "$port" --directory build
