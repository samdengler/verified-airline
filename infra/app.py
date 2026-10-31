"""CDK app entry.  One stack, in us-east-1, where CloudFront's certificate must be."""

import os

import aws_cdk as cdk
from verified_airline_infra.stack import SITE_DIR, VerifiedAirlineStack

app = cdk.App()
VerifiedAirlineStack(
    app,
    "VerifiedAirline",
    site_dir=SITE_DIR,
    env=cdk.Environment(account=os.environ.get("CDK_DEFAULT_ACCOUNT"), region="us-east-1"),
    description="Verified Airline: the site at air.dengler.io",
)
app.synth()
