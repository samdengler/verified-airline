#!/usr/bin/env bash
# Publish web/'s build to air.dengler.io: upload it to the site bucket and
# invalidate CloudFront.  scripts/deploy.sh runs it after cdk deploy, and CI
# runs it on a push to main with the stack's publish role.
#
#   scripts/publish-site.sh
#
# The bucket and distribution come from the VerifiedAirline stack's outputs.
# The live content security policy allows inline scripts by hash, so the
# upload stops if the build has an inline script the policy lacks; run
# scripts/deploy.sh, which updates the policy, instead.
set -euo pipefail
cd "$(dirname "$0")/.."
DIST=web/dist/verified-airline/browser
export AWS_REGION="${AWS_REGION:-us-east-1}"
[[ -f "$DIST/index.html" ]] || { echo "no build in $DIST; run npm --prefix web run build" >&2; exit 1; }

output() {
  aws cloudformation describe-stacks --stack-name VerifiedAirline \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
bucket="$(output SiteBucketName)"
distribution="$(output DistributionId)"
domain="$(output DistributionDomainName)"
url="$(output SiteUrl)"

# From the distribution's own address, so a publish does not wait on DNS.  Error
# responses carry the policy too, so this works on an empty bucket.
live="$(curl -sSI "https://$domain/" | tr -d '\r' | sed -n 's/^content-security-policy: //Ip')"
if ! missing="$(python3 infra/verified_airline_infra/csp.py "$DIST" "$live")"; then
  echo "the live content security policy lacks these inline script hashes; run scripts/deploy.sh:" >&2
  echo "$missing" >&2
  exit 1
fi

# Scripts, styles and fonts have hashed names, so they keep for a year; pages
# and the model's files are revalidated on every load.  New assets go up
# before the pages that name them, and old ones are removed after.
aws s3 sync "$DIST" "s3://$bucket" --exclude '*.html' --exclude '*.json' \
  --cache-control 'public, max-age=31536000, immutable' --only-show-errors
aws s3 sync "$DIST" "s3://$bucket" --delete --exclude '*' --include '*.html' --include '*.json' \
  --cache-control 'no-cache' --only-show-errors
aws s3 sync "$DIST" "s3://$bucket" --delete --exclude '*.html' --exclude '*.json' --only-show-errors
aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' >/dev/null
echo "published $url"
