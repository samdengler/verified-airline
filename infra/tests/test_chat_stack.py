"""Synthesizes the chat stack from a fresh export and checks the policy and the guardrail."""

import json
import subprocess
import sys
from pathlib import Path

import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Template
from verified_airline_infra.chat_stack import GUARDRAIL_PROFILE, VerifiedAirlineChatStack

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def export(tmp_path_factory):
    out = tmp_path_factory.mktemp("chat")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "export_chat.py"), "--out", str(out)], check=True,
                   capture_output=True)
    return out


@pytest.fixture(scope="module")
def template(export):
    stack = VerifiedAirlineChatStack(cdk.App(), "VerifiedAirlineChat", chat_dir=export,
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
