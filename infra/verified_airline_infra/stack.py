"""The VerifiedAirline stack: Verified Airline's site at air.dengler.io.

The site is the Angular app in web/, every page prerendered to HTML at build
time, in a private S3 bucket behind CloudFront.  The hosting follows
guppi-gpt's GuppiGpt stack: the dengler.io zone, a DNS-validated certificate,
an origin access control, and security headers on every response.

The content security policy is infra/csp.txt with the hash of each inline
script in the built pages (csp.py), so the stack reads web/'s build when it
is synthesized; scripts/deploy.sh builds web/ first.

A GitHub OIDC provider and a publish role let GitHub Actions publish the site
on a push to main: the role can write to the site bucket, invalidate the
distribution, and read this stack's outputs, and nothing else.

The support chat's API is on the same distribution, so the page's content
security policy needs no other origin: /api/chat/start and /api/chat/turns/*
go to the chat start and the turn records' read in the VerifiedAirlineChat
stack, through function URLs that only this distribution can call.  A WAF web
ACL limits how many chats one address can start.  The chat stack deploys
first; this stack finds its functions by name.

The One ID relay (the VerifiedAirlineOneId stack) has an origin of its own, so
the policy lists it in connect-src and this stack deploys after that one.  Its
address is an output here too, so scripts/publish-site.sh can write it into
one-id-relay.json for the app with the publish role alone.
"""

from __future__ import annotations

from pathlib import Path

import aws_cdk as cdk
from aws_cdk import (
    Duration,
    RemovalPolicy,
)
from aws_cdk import (
    aws_certificatemanager as acm,
)
from aws_cdk import (
    aws_cloudfront as cloudfront,
)
from aws_cdk import (
    aws_cloudfront_origins as origins,
)
from aws_cdk import (
    aws_iam as iam,
)
from aws_cdk import (
    aws_lambda as lambda_,
)
from aws_cdk import (
    aws_route53 as route53,
)
from aws_cdk import (
    aws_route53_targets as targets,
)
from aws_cdk import (
    aws_s3 as s3,
)
from aws_cdk import (
    aws_wafv2 as wafv2,
)
from constructs import Construct

from verified_airline_infra.chat_stack import CHAT_START_NAME, TURNS_API_NAME
from verified_airline_infra.csp import content_security_policy

ZONE_NAME = "dengler.io"
RECORD_NAME = "air"
HOST = f"{RECORD_NAME}.{ZONE_NAME}"
SITE_URL = f"https://{HOST}/"
GITHUB_OIDC = "token.actions.githubusercontent.com"
# The repository uses GitHub's immutable subject claims, which name the owner
# and the repository by their IDs as well, so a renamed or re-created
# repository cannot assume the role (gh api repos/<repo>/actions/oidc/customization/sub).
GITHUB_SUBJECT = "repo:samdengler@133874/verified-airline@1440554836:ref:refs/heads/main"
# Chats one address may start in five minutes; a demo needs a few.
CHAT_STARTS_PER_5_MIN = 20

ROOT = Path(__file__).resolve().parents[2]
SITE_DIR = ROOT / "web" / "dist" / "verified-airline" / "browser"
FUNCTIONS_DIR = Path(__file__).resolve().parent / "functions"


class VerifiedAirlineStack(cdk.Stack):
    def __init__(self, scope: Construct, construct_id: str, *, site_dir: Path, relay_url: str | None = None, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        zone = route53.HostedZone.from_lookup(self, "Zone", domain_name=ZONE_NAME)
        certificate = acm.Certificate(
            self,
            "Certificate",
            domain_name=HOST,
            validation=acm.CertificateValidation.from_dns(zone),
        )

        site_bucket = s3.Bucket(
            self,
            "SiteBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            removal_policy=RemovalPolicy.RETAIN,
        )

        headers_policy = cloudfront.ResponseHeadersPolicy(
            self,
            "SecurityHeadersPolicy",
            comment="CSP and security headers for Verified Airline",
            security_headers_behavior=cloudfront.ResponseSecurityHeadersBehavior(
                content_security_policy=cloudfront.ResponseHeadersContentSecurityPolicy(
                    content_security_policy=content_security_policy(site_dir, relay_url or ""),
                    override=True,
                ),
                strict_transport_security=cloudfront.ResponseHeadersStrictTransportSecurity(
                    access_control_max_age=Duration.days(365),
                    include_subdomains=False,
                    override=True,
                ),
                content_type_options=cloudfront.ResponseHeadersContentTypeOptions(override=True),
                referrer_policy=cloudfront.ResponseHeadersReferrerPolicy(
                    referrer_policy=cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                    override=True,
                ),
                frame_options=cloudfront.ResponseHeadersFrameOptions(
                    frame_option=cloudfront.HeadersFrameOption.DENY, override=True
                ),
            ),
        )
        site_path_function = cloudfront.Function(
            self,
            "SitePathFunction",
            code=cloudfront.FunctionCode.from_file(file_path=str(FUNCTIONS_DIR / "site-path.js")),
            runtime=cloudfront.FunctionRuntime.JS_2_0,
            comment="Serves each prerendered page from its index.html",
        )
        # A path with no page: S3 answers 403, since the distribution may not
        # list the bucket.  The app's shell then shows its not-found page.
        not_found = [
            cloudfront.ErrorResponse(
                http_status=status,
                response_http_status=404,
                response_page_path="/index.csr.html",
                ttl=Duration.seconds(60),
            )
            for status in (403, 404)
        ]
        distribution = cloudfront.Distribution(
            self,
            "Distribution",
            additional_behaviors=self.chat_routes(headers_policy),
            web_acl_id=self.chat_limit().attr_arn,
            comment="Verified Airline",
            domain_names=[HOST],
            certificate=certificate,
            default_root_object="index.html",
            minimum_protocol_version=cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            http_version=cloudfront.HttpVersion.HTTP2_AND_3,
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,
            error_responses=not_found,
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3BucketOrigin.with_origin_access_control(site_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                response_headers_policy=headers_policy,
                function_associations=[
                    cloudfront.FunctionAssociation(
                        function=site_path_function,
                        event_type=cloudfront.FunctionEventType.VIEWER_REQUEST,
                    )
                ],
            ),
        )
        for record_type, record_class in (("A", route53.ARecord), ("AAAA", route53.AaaaRecord)):
            record_class(
                self,
                f"Site{record_type}Record",
                zone=zone,
                record_name=RECORD_NAME,
                target=route53.RecordTarget.from_alias(targets.CloudFrontTarget(distribution)),
            )

        # Publishing from GitHub Actions.  The provider is the account's only
        # one for GitHub; another stack that needs it imports it by ARN.
        github = iam.OidcProviderNative(
            self,
            "GitHubOidcProvider",
            url=f"https://{GITHUB_OIDC}",
            client_ids=["sts.amazonaws.com"],
        )
        publish_role = iam.Role(
            self,
            "PublishRole",
            description="Publishes Verified Airline's site from GitHub Actions on a push to main",
            max_session_duration=Duration.hours(1),
            assumed_by=iam.WebIdentityPrincipal(
                github.oidc_provider_arn,
                conditions={
                    "StringEquals": {
                        f"{GITHUB_OIDC}:aud": "sts.amazonaws.com",
                        f"{GITHUB_OIDC}:sub": GITHUB_SUBJECT,
                    }
                },
            ),
        )
        site_bucket.grant_read_write(publish_role)
        site_bucket.grant_delete(publish_role)
        distribution.grant_create_invalidation(publish_role)
        publish_role.add_to_policy(
            iam.PolicyStatement(actions=["cloudformation:DescribeStacks"], resources=[self.stack_id])
        )

        cdk.CfnOutput(self, "SiteUrl", value=SITE_URL)
        cdk.CfnOutput(self, "ChatStartUrl", value=f"{SITE_URL}api/chat/start")
        cdk.CfnOutput(self, "SiteBucketName", value=site_bucket.bucket_name)
        cdk.CfnOutput(self, "DistributionId", value=distribution.distribution_id)
        # The distribution's own address, which answers before air.dengler.io resolves.
        cdk.CfnOutput(self, "DistributionDomainName", value=distribution.distribution_domain_name)
        cdk.CfnOutput(self, "PublishRoleArn", value=publish_role.role_arn)
        if relay_url:
            cdk.CfnOutput(self, "OneIdRelayUrl", value=relay_url)
        cdk.CfnOutput(self, "GitHubOidcProviderArn", value=github.oidc_provider_arn)

    def chat_routes(self, headers_policy):
        """The chat's two paths, each to its function's URL.  The URLs take
        only requests CloudFront signs, and nothing is cached.  A POST must
        carry x-amz-content-sha256, the hash of its body, for CloudFront to
        sign it; the widget sends it."""
        routes = {}
        for path, construct_id, name, methods in (
            ("/api/chat/start", "ChatStart", CHAT_START_NAME, cloudfront.AllowedMethods.ALLOW_ALL),
            ("/api/chat/turns/*", "ChatTurns", TURNS_API_NAME, cloudfront.AllowedMethods.ALLOW_GET_HEAD),
        ):
            function = lambda_.Function.from_function_attributes(
                self, f"{construct_id}Function", same_environment=True,
                function_arn=f"arn:aws:lambda:{self.region}:{self.account}:function:{name}")
            url = lambda_.FunctionUrl(self, f"{construct_id}FunctionUrl", function=function,
                                      auth_type=lambda_.FunctionUrlAuthType.AWS_IAM)
            routes[path] = cloudfront.BehaviorOptions(
                origin=origins.FunctionUrlOrigin.with_origin_access_control(url),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                allowed_methods=methods,
                cache_policy=cloudfront.CachePolicy.CACHING_DISABLED,
                origin_request_policy=cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                response_headers_policy=headers_policy,
            )
        return routes

    def chat_limit(self):
        """A web ACL that blocks an address once it has started
        CHAT_STARTS_PER_5_MIN chats in five minutes; everything else passes."""
        visibility = lambda name: wafv2.CfnWebACL.VisibilityConfigProperty(
            cloud_watch_metrics_enabled=True, metric_name=name, sampled_requests_enabled=True)
        return wafv2.CfnWebACL(
            self,
            "ChatLimit",
            scope="CLOUDFRONT",
            default_action=wafv2.CfnWebACL.DefaultActionProperty(allow={}),
            visibility_config=visibility("verified-airline"),
            rules=[
                wafv2.CfnWebACL.RuleProperty(
                    name="chat-starts-per-address",
                    priority=0,
                    action=wafv2.CfnWebACL.RuleActionProperty(block={}),
                    visibility_config=visibility("chat-starts-per-address"),
                    statement=wafv2.CfnWebACL.StatementProperty(
                        rate_based_statement=wafv2.CfnWebACL.RateBasedStatementProperty(
                            limit=CHAT_STARTS_PER_5_MIN,
                            evaluation_window_sec=300,
                            aggregate_key_type="IP",
                            scope_down_statement=wafv2.CfnWebACL.StatementProperty(
                                byte_match_statement=wafv2.CfnWebACL.ByteMatchStatementProperty(
                                    field_to_match=wafv2.CfnWebACL.FieldToMatchProperty(uri_path={}),
                                    positional_constraint="STARTS_WITH",
                                    search_string="/api/chat/start",
                                    text_transformations=[
                                        wafv2.CfnWebACL.TextTransformationProperty(priority=0, type="NONE")],
                                )
                            ),
                        )
                    ),
                )
            ],
        )
