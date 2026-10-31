#!/usr/bin/env bash
# Build the site, deploy the VerifiedAirline stack (infra/), and publish the
# site to air.dengler.io.  Extra arguments go to cdk deploy.  Needs AWS
# credentials for the account that holds the dengler.io zone.
#
#   scripts/deploy.sh                       # build, cdk deploy, publish
#   scripts/deploy.sh --site-only           # build and publish; no cdk deploy
#   scripts/deploy.sh --require-approval never
#
# cdk deploy comes before the publish because the stack's content security
# policy names the hashes of the build's inline scripts.
set -euo pipefail
cd "$(dirname "$0")/.."
SITE_ONLY=0
if [[ "${1:-}" == "--site-only" ]]; then
  SITE_ONLY=1
  shift
fi
export AWS_REGION="${AWS_REGION:-us-east-1}"
for tool in npm npx uv aws curl python3; do
  command -v "$tool" >/dev/null || { echo "missing: $tool" >&2; exit 1; }
done

(cd web && npm ci --silent --no-audit --no-fund && npm run build --silent)
# The CDK app also synthesizes the chat stack, which reads the policy export.
python3 scripts/export_chat.py >/dev/null
if [[ "$SITE_ONLY" == 0 ]]; then
  (cd infra && npx --yes aws-cdk@2 deploy VerifiedAirline "$@")
fi
scripts/publish-site.sh
