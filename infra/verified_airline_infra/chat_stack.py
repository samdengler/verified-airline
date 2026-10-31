"""The VerifiedAirlineChat stack: the support chat's backend.

The Automated Reasoning policy is the definition scripts/export_chat.py writes
from the Lean model's facts.json, loaded as JSON: CloudFormation creates the
policy from it and runs no extraction, so no LLM writes a rule.  A numbered
policy version is attached to a guardrail, and each policy definition gets
its own numbered guardrail version, which the chat calls.

guppi-hr's stacks are reference only; this stack depends on nothing of theirs.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import aws_cdk as cdk
from aws_cdk import aws_bedrock as bedrock
from constructs import Construct

ROOT = Path(__file__).resolve().parents[2]
CHAT_DIR = ROOT / "build" / "chat"
GUARDRAIL_PROFILE = "us.guardrail.v1:0"

Policy = bedrock.CfnAutomatedReasoningPolicy


def load_definition(chat_dir: Path) -> dict:
    path = chat_dir / "ar-policy.json"
    if not path.exists():
        raise SystemExit(f"no {path}; run python3 scripts/export_chat.py first")
    return json.loads(path.read_text())


def policy_definition(d: dict) -> Policy.PolicyDefinitionProperty:
    return Policy.PolicyDefinitionProperty(
        version=d["version"],
        types=[
            Policy.PolicyDefinitionTypeProperty(
                name=t["name"],
                description=t.get("description"),
                values=[Policy.PolicyDefinitionTypeValueProperty(value=v["value"], description=v.get("description"))
                        for v in t["values"]],
            )
            for t in d["types"]
        ],
        variables=[Policy.PolicyDefinitionVariableProperty(name=v["name"], type=v["type"], description=v["description"])
                   for v in d["variables"]],
        rules=[Policy.PolicyDefinitionRuleProperty(id=r["id"], expression=r["expression"]) for r in d["rules"]],
    )


class VerifiedAirlineChatStack(cdk.Stack):
    def __init__(self, scope: Construct, construct_id: str, *, chat_dir: Path, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        definition = load_definition(chat_dir)
        digest = hashlib.sha256(json.dumps(definition, sort_keys=True).encode()).hexdigest()[:8]

        policy = Policy(
            self,
            "FaresPolicy",
            name="verified-airline-fares",
            description="Fares and refunds, generated from the Verified Air Lean model by scripts/export_chat.py",
            policy_definition=policy_definition(definition),
            force_delete=True,
        )
        # A new definition changes the hash, which replaces the version: the
        # guardrail then names the new numbered version.
        policy_version = bedrock.CfnAutomatedReasoningPolicyVersion(
            self,
            "FaresPolicyVersion",
            policy_arn=policy.attr_policy_arn,
            last_updated_definition_hash=policy.attr_definition_hash,
        )
        versioned_arn = cdk.Fn.join(":", [policy.attr_policy_arn, policy_version.attr_version])

        guardrail = bedrock.CfnGuardrail(
            self,
            "Guardrail",
            name="verified-airline",
            description="Automated Reasoning checks of the support chat's answers against the fares policy",
            blocked_input_messaging="Verified Airline cannot answer that.",
            blocked_outputs_messaging="Verified Airline cannot give that answer.",
            automated_reasoning_policy_config=bedrock.CfnGuardrail.AutomatedReasoningPolicyConfigProperty(
                policies=[versioned_arn],
            ),
            cross_region_config=bedrock.CfnGuardrail.GuardrailCrossRegionConfigProperty(
                guardrail_profile_arn=f"arn:aws:bedrock:{self.region}:{self.account}:guardrail-profile/{GUARDRAIL_PROFILE}",
            ),
        )
        guardrail_version = bedrock.CfnGuardrailVersion(
            self,
            f"GuardrailVersion{digest}",
            guardrail_identifier=guardrail.attr_guardrail_id,
            description=f"Fares policy definition {digest}",
        )

        cdk.CfnOutput(self, "PolicyArn", value=policy.attr_policy_arn)
        cdk.CfnOutput(self, "PolicyVersionArn", value=versioned_arn)
        cdk.CfnOutput(self, "GuardrailId", value=guardrail.attr_guardrail_id)
        cdk.CfnOutput(self, "GuardrailVersion", value=guardrail_version.attr_version)
