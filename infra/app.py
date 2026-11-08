"""CDK app entry.  The site, the support chat and the One ID relay, each a stack
in us-east-1, where CloudFront's certificate must be.  The site's content
security policy names the relay's address, so the site deploys after it."""

import os

import aws_cdk as cdk
from verified_airline_infra.chat_stack import CHAT_DIR, VerifiedAirlineChatStack
from verified_airline_infra.one_id_stack import VerifiedAirlineOneIdStack
from verified_airline_infra.stack import SITE_DIR, VerifiedAirlineStack

app = cdk.App()
env = cdk.Environment(account=os.environ.get("CDK_DEFAULT_ACCOUNT"), region="us-east-1")
relay = VerifiedAirlineOneIdStack(
    app,
    "VerifiedAirlineOneId",
    env=env,
    description="Verified Airline: the One ID relay between devices",
)
VerifiedAirlineStack(
    app,
    "VerifiedAirline",
    site_dir=SITE_DIR,
    relay_url=relay.relay_url,
    env=env,
    description="Verified Airline: the site at air.dengler.io",
)
VerifiedAirlineChatStack(
    app,
    "VerifiedAirlineChat",
    chat_dir=CHAT_DIR,
    env=env,
    description="Verified Airline: the support chat's backend",
)
app.synth()
