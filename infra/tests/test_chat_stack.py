"""Synthesizes the chat stack from a fresh export and checks the policy and the guardrail."""

import json
import subprocess
import sys
from pathlib import Path

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Template
from verified_airline_infra.chat_stack import (
    AGENT_TARGET_NAME,
    CONNECT_ALIAS,
    GUARDRAIL_PROFILE,
    VerifiedAirlineChatStack,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def export(tmp_path_factory):
    out = tmp_path_factory.mktemp("chat")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "export_chat.py"), "--out", str(out)], check=True,
                   capture_output=True)
    return out


@pytest.fixture(scope="module")
def template(export):
    # No bundling: the chat start's Rust is built at deploy, not in tests.
    app = cdk.App(context={"aws:cdk:bundling-stacks": []})
    stack = VerifiedAirlineChatStack(app, "VerifiedAirlineChat", chat_dir=export,
                                     env=cdk.Environment(account="123456789012", region="us-east-1"))
    return Template.from_stack(stack)


def test_the_policy_is_the_exported_definition(template, export):
    exported = json.loads((export / "ar-policy.json").read_text())
    (policy,) = template.find_resources("AWS::Bedrock::AutomatedReasoningPolicy").values()
    definition = policy["Properties"]["PolicyDefinition"]
    assert [r["Id"] for r in definition["Rules"]] == [r["id"] for r in exported["rules"]]
    assert [r["Expression"] for r in definition["Rules"]] == [r["expression"] for r in exported["rules"]]
    assert [v["Name"] for v in definition["Variables"]] == [v["name"] for v in exported["variables"]]


def test_every_rule_names_its_lean_rule(export):
    rules = json.loads((export / "ar-rules.json").read_text())["rules"]
    exported = json.loads((export / "ar-policy.json").read_text())
    assert set(rules) == {r["id"] for r in exported["rules"]}
    assert all(m["lean"] and (m["requirements"] or m.get("axiom")) for m in rules.values())


def test_every_rule_has_a_right_and_a_wrong_answer(export):
    checks = json.loads((export / "ar-checks.json").read_text())["checks"]
    by_rule = {}
    for c in checks:
        by_rule.setdefault(c["rule"], set()).add(c["expect"])
    exported = json.loads((export / "ar-policy.json").read_text())
    meaning = json.loads((export / "ar-rules.json").read_text())["rules"]
    for r in exported["rules"]:
        if r["id"] != "RREFUNDWITHN" and not meaning[r["id"]].get("axiom") and not meaning[r["id"]].get("definition"):
            assert by_rule.get(r["id"]) == {"VALID", "INVALID"}, r["id"]


def test_the_guardrail_names_a_numbered_policy_version_through_the_profile(template):
    (guardrail,) = template.find_resources("AWS::Bedrock::Guardrail").values()
    props = guardrail["Properties"]
    assert props["CrossRegionConfig"]["GuardrailProfileArn"].endswith(f"guardrail-profile/{GUARDRAIL_PROFILE}") or \
        GUARDRAIL_PROFILE in json.dumps(props["CrossRegionConfig"])
    (policy_ref,) = props["AutomatedReasoningPolicyConfig"]["Policies"]
    joined = json.dumps(policy_ref)
    assert "Fn::Join" in joined and "Version" in joined
    assert len(template.find_resources("AWS::Bedrock::GuardrailVersion")) == 1


def test_the_tools_gateway_authorizes_by_iam_and_offers_only_retrieve(template):
    (gateway,) = [g for g in template.find_resources("AWS::BedrockAgentCore::Gateway").values()
                  if g["Properties"].get("ProtocolType") == "MCP"]
    assert gateway["Properties"]["AuthorizerType"] == "AWS_IAM"
    assert gateway["Properties"]["ProtocolType"] == "MCP"
    (target,) = [t for t in template.find_resources("AWS::BedrockAgentCore::GatewayTarget").values()
                 if "Mcp" in t["Properties"]["TargetConfiguration"]]
    connector = target["Properties"]["TargetConfiguration"]["Mcp"]["Connector"]
    assert connector["Source"]["ConnectorId"] == "bedrock-knowledge-bases"
    assert [c["Name"] for c in connector["Configurations"]] == ["Retrieve"]


def test_the_agent_reaches_only_this_gateway_and_this_guardrail(template):
    statements = [s for p in template.find_resources("AWS::IAM::Policy").values()
                  for s in p["Properties"]["PolicyDocument"]["Statement"]]

    def resources(action):
        found = [s["Resource"] for s in statements
                 if action in (s["Action"] if isinstance(s["Action"], list) else [s["Action"]])]
        assert found, action
        return json.dumps(found)
    assert "ToolsGateway" in resources("bedrock-agentcore:InvokeGateway")
    assert "Guardrail" in resources("bedrock:ApplyGuardrail")
    assert "FaresPolicy" in resources("bedrock:InvokeAutomatedReasoningPolicy")
    assert "*" not in json.loads(resources("bedrock-agentcore:InvokeGateway"))[0]


def test_one_model_answers_both_modes(template):
    (runtime,) = template.find_resources("AWS::BedrockAgentCore::Runtime").values()
    env = runtime["Properties"]["EnvironmentVariables"]
    assert env["MODEL_ID"].startswith("us.anthropic.claude-")
    assert "GUARDRAIL_VERSION" in env and "TOOLS_GATEWAY_URL" in env


def test_the_connect_instance_is_kept_and_uses_connect_users(template):
    (instance,) = template.find_resources("AWS::Connect::Instance").values()
    assert instance["DeletionPolicy"] == "Retain"
    assert instance["Properties"]["InstanceAlias"] == CONNECT_ALIAS
    assert instance["Properties"]["IdentityManagementType"] == "CONNECT_MANAGED"
    assert instance["Properties"]["Attributes"]["OutboundCalls"] is False


def test_the_agents_gateway_takes_only_the_chat_starts_token_and_calls_the_agent_with_its_role(template):
    (gateway,) = [g for g in template.find_resources("AWS::BedrockAgentCore::Gateway").values()
                  if g["Properties"]["AuthorizerType"] == "CUSTOM_JWT"]
    jwt = gateway["Properties"]["AuthorizerConfiguration"]["CustomJWTAuthorizer"]
    assert "ChatIdentity" in json.dumps(jwt["DiscoveryUrl"])
    assert "ChatIdentityChatStartClient" in json.dumps(jwt["AllowedClients"])
    assert jwt["AllowedScopes"] == ["verified-airline/agents"]
    (target,) = [t for t in template.find_resources("AWS::BedrockAgentCore::GatewayTarget").values()
                 if "Http" in t["Properties"]["TargetConfiguration"]]
    assert target["Properties"]["Name"] == AGENT_TARGET_NAME
    assert [c["CredentialProviderType"] for c in target["Properties"]["CredentialProviderConfigurations"]] == [
        "GATEWAY_IAM_ROLE"]


def test_the_chat_start_token_is_client_credentials_only(template):
    (client,) = template.find_resources("AWS::Cognito::UserPoolClient").values()
    props = client["Properties"]
    assert props["AllowedOAuthFlows"] == ["client_credentials"]
    assert props["GenerateSecret"] is True
    assert props.get("ExplicitAuthFlows", []) == []


def test_the_chat_start_starts_chats_and_reads_nothing_else(template):
    (function,) = [f for f in template.find_resources("AWS::Lambda::Function").values()
                   if f["Properties"].get("FunctionName") == "verified-airline-chat-start"]
    assert function["Properties"]["Runtime"] == "provided.al2023"
    assert function["Properties"]["Architectures"] == ["arm64"]
    role = function["Properties"]["Role"]["Fn::GetAtt"][0]
    actions = sorted(a for p in template.find_resources("AWS::IAM::Policy").values()
                     if {"Ref": role} in p["Properties"]["Roles"]
                     for s in p["Properties"]["PolicyDocument"]["Statement"]
                     for a in (s["Action"] if isinstance(s["Action"], list) else [s["Action"]]))
    assert actions == ["cognito-idp:DescribeUserPoolClient", "connect:ListContactFlows", "connect:StartChatContact"]


def test_turns_are_kept_thirty_days_and_the_agent_writes_them(template):
    (table,) = template.find_resources("AWS::DynamoDB::Table").values()
    assert table["Properties"]["TimeToLiveSpecification"] == {"AttributeName": "expires", "Enabled": True}
    (runtime,) = template.find_resources("AWS::BedrockAgentCore::Runtime").values()
    env = runtime["Properties"]["EnvironmentVariables"]
    assert "TURNS_TABLE" in env
    assert json.loads(env["RULE_STATEMENTS"])
    assert len(env["LEAN_MODEL_COMMIT"]) == 40
    assert "FaresPolicyVersion" in json.dumps(env["POLICY_VERSION_ARN"])
