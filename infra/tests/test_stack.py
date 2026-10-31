"""Synthesizes the stack against a stand-in build and checks what it serves and who may publish."""

import base64
import hashlib
import json

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Match, Template
from verified_airline_infra.stack import GITHUB_SUBJECT, HOST, VerifiedAirlineStack

ACCOUNT = "123456789012"
SCRIPT = "document.documentElement.className = 'js';"


@pytest.fixture(scope="module")
def template(tmp_path_factory):
    site = tmp_path_factory.mktemp("browser")
    (site / "index.html").write_text(
        f'<html><head><script>{SCRIPT}</script><script src="main.js" type="module"></script>'
        '<script id="ng-state" type="application/json">{}</script></head></html>'
    )
    app = cdk.App(
        context={
            f"hosted-zone:account={ACCOUNT}:domainName=dengler.io:region=us-east-1": {
                "Id": "/hostedzone/Z0000000000000",
                "Name": "dengler.io.",
            }
        }
    )
    stack = VerifiedAirlineStack(
        app, "VerifiedAirline", site_dir=site, env=cdk.Environment(account=ACCOUNT, region="us-east-1")
    )
    return Template.from_stack(stack)


def test_serves_air_dengler_io(template):
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {"DistributionConfig": Match.object_like({"Aliases": [HOST], "HttpVersion": "http2and3"})},
    )
    template.has_resource_properties("AWS::Route53::RecordSet", {"Name": f"{HOST}.", "Type": "A"})
    template.has_resource_properties("AWS::Route53::RecordSet", {"Name": f"{HOST}.", "Type": "AAAA"})


def test_a_path_with_no_page_gets_the_shell_and_404(template):
    template.has_resource_properties(
        "AWS::CloudFront::Distribution",
        {
            "DistributionConfig": Match.object_like(
                {
                    "CustomErrorResponses": [
                        Match.object_like({"ErrorCode": code, "ResponseCode": 404, "ResponsePagePath": "/index.csr.html"})
                        for code in (403, 404)
                    ]
                }
            )
        },
    )


def test_the_policy_allows_the_inline_script_by_hash_and_nothing_else_inline(template):
    digest = base64.b64encode(hashlib.sha256(SCRIPT.encode()).digest()).decode()
    policies = template.find_resources("AWS::CloudFront::ResponseHeadersPolicy")
    (policy,) = policies.values()
    csp = policy["Properties"]["ResponseHeadersPolicyConfig"]["SecurityHeadersConfig"]["ContentSecurityPolicy"][
        "ContentSecurityPolicy"
    ]
    script_src = next(d for d in csp.split(";") if d.strip().startswith("script-src")).split()
    assert script_src == ["script-src", "'self'", f"'sha256-{digest}'"]
    assert "unsafe-inline" not in csp
    assert "frame-ancestors 'none'" in csp


def test_the_path_function_serves_each_page_from_its_index_html(template):
    functions = template.find_resources("AWS::CloudFront::Function")
    (function,) = functions.values()
    code = function["Properties"]["FunctionCode"]
    assert "index.html" in code and "/index.html" in code


def test_only_pushes_to_main_may_publish(template):
    assert GITHUB_SUBJECT.endswith(":ref:refs/heads/main")
    roles = template.find_resources("AWS::IAM::Role")
    (role,) = roles.values()
    (statement,) = role["Properties"]["AssumeRolePolicyDocument"]["Statement"]
    assert statement["Action"] == "sts:AssumeRoleWithWebIdentity"
    assert statement["Condition"]["StringEquals"] == {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": GITHUB_SUBJECT,
    }


def test_the_publish_role_reaches_only_the_site(template):
    policies = template.find_resources("AWS::IAM::Policy")
    actions = set()
    for p in policies.values():
        for s in p["Properties"]["PolicyDocument"]["Statement"]:
            actions.update([s["Action"]] if isinstance(s["Action"], str) else s["Action"])
            assert s["Resource"] != "*", json.dumps(s)
    assert {a.split(":")[0] for a in actions} == {"s3", "cloudfront", "cloudformation"}
