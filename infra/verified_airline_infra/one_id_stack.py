"""The VerifiedAirlineOneId stack: the relay that lets the One ID demo span devices.

A laptop shows the airline's check-in page, a phone runs the demo wallet, a
tablet runs the gate reader.  The screen that asks starts a session with its
request and shows a code for the phone; the phone's wallet reads the request,
asks the traveler, and writes its answer, which the asking screen reads.  The
relay is transport: it reads nothing in what it carries, and the checks on each
screen decide (web/src/app/one-id/relay.ts).

An HTTP API with two Lambda functions, one that writes and one that reads, and
one DynamoDB table whose items expire after SESSION_SECONDS.  The sessions hold
specimen data, and are kept as if they held real data: a random id of 128 bits,
no route that lists sessions, CORS for the site and the local dev server only,
a size limit on each part, and throttling on the stage.

The site's content security policy lists the API's origin in connect-src, so
the VerifiedAirline stack takes relay_url from this stack and deploys after it.
"""

from __future__ import annotations

from pathlib import Path

import aws_cdk as cdk
from aws_cdk import Duration, RemovalPolicy
from aws_cdk import aws_apigatewayv2 as apigw
from aws_cdk import aws_apigatewayv2_integrations as integrations
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from constructs import Construct

RELAY_DIR = Path(__file__).resolve().parent / "functions" / "relay"
# The site, and the app under `npm start`.
ALLOWED_ORIGINS = ["https://air.dengler.io", "http://localhost:4200", "http://127.0.0.1:4200"]
# Ten minutes: long enough to walk from the laptop to the gate, short enough
# that nothing lingers.
SESSION_SECONDS = 600
# Requests per second across the API.  A screen polls every two seconds, so this
# serves a few dozen demos at once and caps what a script can cost.
RATE_LIMIT = 20
BURST_LIMIT = 40


class VerifiedAirlineOneIdStack(cdk.Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        table = dynamodb.Table(
            self,
            "Sessions",
            partition_key=dynamodb.Attribute(name="id", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="expires",
            removal_policy=RemovalPolicy.DESTROY,
        )

        def function(construct_id: str, handler: str, description: str) -> lambda_.Function:
            log_group = logs.LogGroup(self, f"{construct_id}Logs", retention=logs.RetentionDays.ONE_WEEK,
                                      removal_policy=RemovalPolicy.DESTROY)
            return lambda_.Function(
                self,
                construct_id,
                description=description,
                runtime=lambda_.Runtime.PYTHON_3_13,
                architecture=lambda_.Architecture.ARM_64,
                handler=handler,
                code=lambda_.Code.from_asset(str(RELAY_DIR), exclude=["__pycache__"]),
                memory_size=128,
                timeout=Duration.seconds(5),
                log_group=log_group,
                environment={"SESSIONS_TABLE": table.table_name, "SESSION_SECONDS": str(SESSION_SECONDS)},
            )

        writer = function("Write", "relay.write", "Writes a One ID relay session's request, answer or boarding pass")
        reader = function("Read", "relay.read", "Reads one part of a One ID relay session")
        # Conditional writes, and a read to tell a gone session from a part already written.
        table.grant(writer, "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem")
        table.grant(reader, "dynamodb:GetItem")

        api = apigw.HttpApi(
            self,
            "Api",
            description="The One ID relay between Verified Airline's screens",
            create_default_stage=False,
            cors_preflight=apigw.CorsPreflightOptions(
                allow_origins=ALLOWED_ORIGINS,
                allow_methods=[apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST],
                allow_headers=["content-type"],
                max_age=Duration.days(1),
            ),
        )
        stage = apigw.HttpStage(
            self,
            "Stage",
            http_api=api,
            stage_name="$default",
            auto_deploy=True,
            throttle=apigw.ThrottleSettings(rate_limit=RATE_LIMIT, burst_limit=BURST_LIMIT),
        )
        write = integrations.HttpLambdaIntegration("WriteIntegration", writer)
        read = integrations.HttpLambdaIntegration("ReadIntegration", reader)
        api.add_routes(path="/sessions", methods=[apigw.HttpMethod.POST], integration=write)
        api.add_routes(path="/sessions/{id}/{part}", methods=[apigw.HttpMethod.POST], integration=write)
        api.add_routes(path="/sessions/{id}/{part}", methods=[apigw.HttpMethod.GET], integration=read)

        # The $default stage serves at the API's own address, which is also its origin.
        self.relay_url = api.api_endpoint
        cdk.CfnOutput(self, "RelayUrl", value=self.relay_url)
        cdk.CfnOutput(self, "SessionsTableName", value=table.table_name)
