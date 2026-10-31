#!/usr/bin/env bash
# Copy the files the site and the chat read from the Lean model into model/:
# facts.json, Verified Airline's fares evaluated by the model's functions;
# model.json, every requirement with its criteria and their statuses; and
# theorems.json, the Lean theorem that proves each fare fact, which the chat's
# answer certificate links.  They come from verified-air's published site, or
# from a local build of it.
#
#   scripts/update-model.sh                                      # the published site
#   scripts/update-model.sh ../verified-air/build/airline-data   # a local build
#
# The pages are rendered from the new files before model/ changes, so if the
# wording no longer matches the model, model/ keeps the old files and the
# error says what to rewrite.  Commit model/ afterwards: the committed files
# are the version of the model the site shows.
set -euo pipefail
cd "$(dirname "$0")/.."
src="${1:-https://samdengler.github.io/verified-air/airline-data}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for f in model.json facts.json theorems.json; do
  case "$src" in
    http://* | https://*) curl -fsSL "$src/$f" -o "$tmp/$f" ;;
    *) cp "$src/$f" "$tmp/$f" ;;
  esac
done
python3 scripts/render_airline.py --model "$tmp" --out "$tmp/site" >/dev/null
cp "$tmp/model.json" "$tmp/facts.json" "$tmp/theorems.json" model/
python3 scripts/render_airline.py
git diff --stat -- model/
