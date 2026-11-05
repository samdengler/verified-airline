#!/usr/bin/env bash
# Copy the files the site and the chat read from the Lean model into model/:
# facts.json, Verified Airline's fares evaluated by the model's functions;
# model.json, every requirement with its criteria and their statuses;
# theorems.json, the Lean theorems behind each fare fact and each general rule,
# which the chat's answer certificate links; and the chat's Automated Reasoning
# policy, ar-policy.json with ar-rules.json and ar-checks.json.  They come from
# verified-air's published site, or from a local build of it.
#
#   scripts/update-model.sh                                      # the published site
#   scripts/update-model.sh ../verified-air/build/airline-data   # a local build
#   scripts/update-model.sh --one-id                             # the One ID model, from ../verified-id/build/one-id-data
#   scripts/update-model.sh --one-id DIR                         # the One ID model, from another build
#
# The One ID files, model.json, scenarios.json, readings.json and decisions.jsonl,
# go to model/one-id/.  They come only from a local build: verified-id is
# private and has no published site.  scripts/check_one_id.py checks the screens
# against the new files before model/one-id/ changes.
#
# The pages are rendered from the new files before model/ changes, so if the
# wording no longer matches the model, model/ keeps the old files and the
# error says what to rewrite.  Commit model/ afterwards: the committed files
# are the version of the model the site shows.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--one-id" ]; then
  src="${2:-../verified-id/build/one-id-data}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  for f in model.json scenarios.json readings.json decisions.jsonl; do cp "$src/$f" "$tmp/$f"; done
  python3 scripts/check_one_id.py --model "$tmp"
  mkdir -p model/one-id
  cp "$tmp"/* model/one-id/
  git status --short -- model/one-id/
  git diff --stat -- model/one-id/
  exit 0
fi
src="${1:-https://samdengler.github.io/verified-air/airline-data}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for f in model.json facts.json theorems.json ar-policy.json ar-rules.json ar-checks.json; do
  case "$src" in
    http://* | https://*) curl -fsSL "$src/$f" -o "$tmp/$f" ;;
    *) cp "$src/$f" "$tmp/$f" ;;
  esac
done
python3 scripts/render_airline.py --model "$tmp" --out "$tmp/site" >/dev/null
cp "$tmp"/*.json model/
python3 scripts/render_airline.py
git diff --stat -- model/
