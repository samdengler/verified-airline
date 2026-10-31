"""The VerifiedAirlineChat stack: the support chat's backend.

The Automated Reasoning policy is the definition scripts/export_chat.py writes
from the Lean model's facts.json, loaded as JSON: CloudFormation creates the
policy from it and runs no extraction, so no LLM writes a rule.  A numbered
policy version is attached to a guardrail, and each policy definition gets
its own numbered guardrail version, which the chat calls.

The knowledge base is a Bedrock managed knowledge base over the documents the
same script writes (chat/scripts/sync_kb.py uploads them and ingests).  The
tools gateway exposes its Retrieve as the MCP tool docs___Retrieve and
authorizes callers by IAM; the airline agent, a Strands agent on AgentCore
Runtime, is the only caller its role allows.

guppi-hr's stacks are reference only; this stack depends on nothing of theirs.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import aws_cdk as cdk
from aws_cdk import RemovalPolicy
from aws_cdk import aws_bedrock as bedrock
from aws_cdk import aws_bedrockagentcore as agentcore
from aws_cdk import aws_ecr_assets as ecr_assets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_s3 as s3
from constructs import Construct

ROOT = Path(__file__).resolve().parents[2]
CHAT_DIR = ROOT / "build" / "chat"
AGENT_DIR = ROOT / "chat"
GUARDRAIL_PROFILE = "us.guardrail.v1:0"
KB_PREFIX = "kb/"
TOOLS_GATEWAY_NAME = "verified-airline-tools"
KB_TARGET_NAME = "docs"
RUNTIME_NAME = "verified_airline_agent"
# The same model answers in both modes, so the guardrail is the only difference.
# Claude Haiku 4.5: in step 2 it misstated fees and refunds the policy covers
# (12 of 62 bait answers) and Claude Sonnet 4.6 never did, and the demo needs
# a wrong answer for the guardrail to catch.
MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"

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

        knowledge_base, data_source, kb_bucket = self.knowledge_base()
        tools_gateway = self.tools_gateway(knowledge_base, data_source)
        runtime = self.agent_runtime(tools_gateway, guardrail, guardrail_version, policy)

        cdk.CfnOutput(self, "PolicyArn", value=policy.attr_policy_arn)
        cdk.CfnOutput(self, "PolicyVersionArn", value=versioned_arn)
        cdk.CfnOutput(self, "GuardrailId", value=guardrail.attr_guardrail_id)
        cdk.CfnOutput(self, "GuardrailVersion", value=guardrail_version.attr_version)
        cdk.CfnOutput(self, "KnowledgeBaseId", value=knowledge_base.attr_knowledge_base_id)
        cdk.CfnOutput(self, "DataSourceId", value=data_source.attr_data_source_id)
        cdk.CfnOutput(self, "KnowledgeBaseBucketName", value=kb_bucket.bucket_name)
        cdk.CfnOutput(self, "ToolsGatewayUrl", value=tools_gateway.attr_gateway_url)
        cdk.CfnOutput(self, "RuntimeArn", value=runtime.attr_agent_runtime_arn)
        cdk.CfnOutput(self, "ModelId", value=MODEL_ID)

    def service_role(self, construct_id, service, description):
        """A role a Bedrock or AgentCore service assumes for this account only."""
        return iam.Role(
            self,
            construct_id,
            description=description,
            assumed_by=iam.ServicePrincipal(
                service,
                conditions={
                    "StringEquals": {"aws:SourceAccount": self.account},
                    "ArnLike": {"aws:SourceArn": f"arn:aws:{service.split('.')[0]}:{self.region}:{self.account}:*"},
                },
            ),
        )

    def knowledge_base(self):
        bucket = s3.Bucket(
            self,
            "KnowledgeBaseBucket",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,
            removal_policy=RemovalPolicy.RETAIN,
        )
        role = self.service_role("KnowledgeBaseRole", "bedrock.amazonaws.com",
                                 "Lets the managed knowledge base read the documents written from the Lean model")
        bucket.grant_read(role)
        kb = bedrock.CfnKnowledgeBase(
            self,
            "KnowledgeBase",
            name="verified-airline",
            description="Verified Airline's fares, policy pages and requirements, written from the Lean model",
            role_arn=role.role_arn,
            knowledge_base_configuration=bedrock.CfnKnowledgeBase.KnowledgeBaseConfigurationProperty(
                type="MANAGED",
                managed_knowledge_base_configuration=bedrock.CfnKnowledgeBase.ManagedKnowledgeBaseConfigurationProperty(
                    embedding_model_type="MANAGED"
                ),
            ),
        )
        kb.node.add_dependency(role)
        # Deletion protection is off, so a document the exporter stops writing
        # leaves the knowledge base at the next ingestion.
        source = bedrock.CfnDataSource(
            self,
            "KnowledgeBaseSource",
            name="lean-model-documents",
            description="Markdown written by scripts/export_chat.py, uploaded by chat/scripts/sync_kb.py",
            knowledge_base_id=kb.attr_knowledge_base_id,
            data_deletion_policy="DELETE",
            data_source_configuration=bedrock.CfnDataSource.DataSourceConfigurationProperty(
                type="MANAGED_KNOWLEDGE_BASE_CONNECTOR",
                managed_knowledge_base_connector_configuration=(
                    bedrock.CfnDataSource.ManagedKnowledgeBaseConnectorConfigurationProperty(
                        connector_parameters={
                            "type": "S3",
                            "version": "1",
                            "connectionConfiguration": {
                                "bucketName": bucket.bucket_name,
                                "bucketOwnerAccountId": self.account,
                            },
                            "filterConfiguration": {"inclusionPrefixes": [KB_PREFIX]},
                        },
                        deletion_protection_configuration=bedrock.CfnDataSource.DeletionProtectionConfigurationProperty(
                            deletion_protection_status="DISABLED"
                        ),
                    )
                ),
            ),
        )
        return kb, source, bucket

    def tools_gateway(self, kb, source):
        role = self.service_role("ToolsGatewayRole", "bedrock-agentcore.amazonaws.com",
                                 "Lets the tools gateway retrieve from the knowledge base")
        # GetKnowledgeBase lets the gateway validate the target when it is created.
        role.add_to_policy(iam.PolicyStatement(actions=["bedrock:GetKnowledgeBase", "bedrock:Retrieve"],
                                               resources=[kb.attr_knowledge_base_arn]))
        gateway = agentcore.CfnGateway(
            self,
            "ToolsGateway",
            name=TOOLS_GATEWAY_NAME,
            description="The knowledge base as an MCP tool, for the airline agent; callers authorized by IAM",
            role_arn=role.role_arn,
            protocol_type="MCP",
            authorizer_type="AWS_IAM",
        )
        gateway.node.add_dependency(role)
        target = agentcore.CfnGatewayTarget(
            self,
            "KnowledgeBaseTarget",
            gateway_identifier=gateway.attr_gateway_identifier,
            name=KB_TARGET_NAME,
            description="Verified Airline's knowledge base",
            target_configuration=agentcore.CfnGatewayTarget.TargetConfigurationProperty(
                mcp=agentcore.CfnGatewayTarget.McpTargetConfigurationProperty(
                    connector=agentcore.CfnGatewayTarget.ConnectorTargetConfigurationProperty(
                        source=agentcore.CfnGatewayTarget.ConnectorSourceProperty(connector_id="bedrock-knowledge-bases"),
                        configurations=[
                            agentcore.CfnGatewayTarget.ConnectorConfigurationProperty(
                                name="Retrieve",
                                description=(
                                    "Search Verified Airline's documents (fares, what a change costs, what a "
                                    "cancellation returns, refunds, payment, extras, schedule changes) and return "
                                    "the most relevant passages."
                                ),
                                parameter_values={"knowledgeBaseId": kb.attr_knowledge_base_id},
                            ),
                        ],
                    )
                )
            ),
            credential_provider_configurations=[
                agentcore.CfnGatewayTarget.CredentialProviderConfigurationProperty(
                    credential_provider_type="GATEWAY_IAM_ROLE"
                )
            ],
        )
        target.node.add_dependency(role)
        target.node.add_dependency(source)
        return gateway

    def agent_runtime(self, tools_gateway, guardrail, guardrail_version, policy):
        image = ecr_assets.DockerImageAsset(self, "AgentImage", directory=str(AGENT_DIR),
                                            platform=ecr_assets.Platform.LINUX_ARM64)
        role = self.service_role("AgentRole", "bedrock-agentcore.amazonaws.com",
                                 "The airline agent's runtime role: the model, the guardrail and the tools gateway")
        region, account = self.region, self.account
        image.repository.grant_pull(role)
        role.add_to_policy(iam.PolicyStatement(actions=["ecr:GetAuthorizationToken"], resources=["*"]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["logs:CreateLogGroup", "logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"],
            resources=[f"arn:aws:logs:{region}:{account}:log-group:/aws/bedrock-agentcore/runtimes/*"]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["logs:DescribeLogGroups"], resources=[f"arn:aws:logs:{region}:{account}:log-group:*"]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules",
                     "xray:GetSamplingTargets"], resources=["*"]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["cloudwatch:PutMetricData"], resources=["*"],
            conditions={"StringEquals": {"cloudwatch:namespace": "bedrock-agentcore"}}))
        role.add_to_policy(iam.PolicyStatement(
            actions=["bedrock-agentcore:GetWorkloadAccessToken"],
            resources=[
                f"arn:aws:bedrock-agentcore:{region}:{account}:workload-identity-directory/default",
                f"arn:aws:bedrock-agentcore:{region}:{account}:workload-identity-directory/default/workload-identity/{RUNTIME_NAME}-*",
            ]))
        # The model through its US cross-Region inference profile.
        role.add_to_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources=[
                f"arn:aws:bedrock:{region}:{account}:inference-profile/{MODEL_ID}",
                "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
            ]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["bedrock:ApplyGuardrail"],
            resources=[guardrail.attr_guardrail_arn, f"arn:aws:bedrock:*:{account}:guardrail-profile/*"]))
        # ApplyGuardrail also needs the caller allowed to invoke the policy
        # version the guardrail names.
        role.add_to_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeAutomatedReasoningPolicy"],
            resources=[policy.attr_policy_arn, cdk.Fn.join(":", [policy.attr_policy_arn, "*"])]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["bedrock-agentcore:InvokeGateway"], resources=[tools_gateway.attr_gateway_arn]))
        runtime = agentcore.CfnRuntime(
            self,
            "AgentRuntime",
            agent_runtime_name=RUNTIME_NAME,
            description="Verified Airline's support chat agent: knowledge base over MCP, Automated Reasoning check",
            role_arn=role.role_arn,
            agent_runtime_artifact=agentcore.CfnRuntime.AgentRuntimeArtifactProperty(
                container_configuration=agentcore.CfnRuntime.ContainerConfigurationProperty(
                    container_uri=image.image_uri
                )
            ),
            network_configuration=agentcore.CfnRuntime.NetworkConfigurationProperty(network_mode="PUBLIC"),
            protocol_configuration="HTTP",
            environment_variables={
                "AWS_REGION": region,
                "MODEL_ID": MODEL_ID,
                "TOOLS_GATEWAY_URL": tools_gateway.attr_gateway_url,
                "GUARDRAIL_ID": guardrail.attr_guardrail_id,
                "GUARDRAIL_VERSION": guardrail_version.attr_version,
            },
        )
        # AgentCore checks the image pull grant when it creates the runtime, so
        # the runtime waits for the role's whole policy, not only the role.
        runtime.node.add_dependency(role)
        return runtime
