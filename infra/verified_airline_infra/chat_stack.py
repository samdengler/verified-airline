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

The Connect instance carries the chat in front of the agent.  It is kept if
the stack is deleted, since the designer's workspace, its API user and the
admin user are made on it by hand once.  A chat reaches the agent through the
agents gateway: the canvas (chat/canvas) sends each question there as an A2A
message/send with a Cognito client-credentials token, which the gateway
checks; the gateway then calls the agent's runtime with its own role, so the
runtime keeps IAM authorization and chat/scripts/ask.py still reaches it.  The
chat start (chat/chat_start, Rust) gets that token and starts the contact on
the contact flow chat/scripts/contact_flow.py writes; until the widget is
published it has no public route and is invoked with IAM.  Each turn of a
chat is recorded in a DynamoDB table for 30 days.

guppi-hr's stacks are reference only; this stack depends on nothing of theirs.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import aws_cdk as cdk
import jsii
from aws_cdk import Duration, RemovalPolicy
from aws_cdk import aws_bedrock as bedrock
from aws_cdk import aws_bedrockagentcore as agentcore
from aws_cdk import aws_cognito as cognito
from aws_cdk import aws_connect as connect
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_ecr_assets as ecr_assets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
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
# Instance aliases are unique across AWS; the alias is also the access URL's host.
CONNECT_ALIAS = "verified-airline"
# The same model answers in both modes, so the guardrail is the only difference.
# Claude Haiku 4.5: in step 2 it misstated fees and refunds the policy covers
# (12 of 62 bait answers) and Claude Sonnet 4.6 never did, and the demo needs
# a wrong answer for the guardrail to catch.
MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
AGENTS_GATEWAY_NAME = "verified-airline-agents"
# The canvas posts to <gateway URL>/airline/invocations.
AGENT_TARGET_NAME = "airline"
SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"
# The chat start's token: one resource server, one scope, for the agents gateway only.
RESOURCE_SERVER = "verified-airline"
AGENTS_SCOPE = "agents"
CONTACT_FLOW_NAME = "verified-airline-chat"
CHAT_START_DIR = AGENT_DIR / "chat_start"
CHAT_START_NAME = "verified-airline-chat-start"
# cargo-lambda from PyPI, with the Zig linker it cross-compiles with; no install needed.
CARGO_LAMBDA = ["uvx", "--from", "cargo-lambda", "cargo-lambda", "lambda", "build", "--release", "--arm64"]
CARGO_LAMBDA_IMAGE = "ghcr.io/cargo-lambda/cargo-lambda:latest"

Policy = bedrock.CfnAutomatedReasoningPolicy


@jsii.implements(cdk.ILocalBundling)
class ChatStartBuild:
    """Builds the chat start on this machine with cargo-lambda; CDK falls back
    to cargo-lambda's image in Docker when this returns False."""

    def try_bundle(self, output_dir: str, *, image=None, **_options) -> bool:
        if not (shutil.which("uvx") and shutil.which("cargo")):
            return False
        subprocess.run(CARGO_LAMBDA, cwd=CHAT_START_DIR, check=True)
        shutil.copy2(CHAT_START_DIR / "target" / "lambda" / "air-chat-start" / "bootstrap", Path(output_dir) / "bootstrap")
        return True


def chat_start_code() -> lambda_.Code:
    """The function's binary.  The hash is of the source, so a deploy with no
    change to the Rust leaves the function alone."""
    return lambda_.Code.from_asset(
        str(CHAT_START_DIR),
        exclude=["target"],
        asset_hash_type=cdk.AssetHashType.SOURCE,
        bundling=cdk.BundlingOptions(
            image=cdk.DockerImage.from_registry(CARGO_LAMBDA_IMAGE),
            command=["bash", "-c",
                     "cargo lambda build --release --arm64 && cp target/lambda/air-chat-start/bootstrap /asset-output/"],
            local=ChatStartBuild(),
        ),
    )


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

        rules = json.loads((chat_dir / "ar-rules.json").read_text())
        statements = {rule: m["statement"] for rule, m in rules["rules"].items()}
        provenance = {"LEAN_MODEL_COMMIT": rules["source"]["commit"], "POLICY_VERSION_ARN": versioned_arn}
        traveler = json.loads((ROOT / "content" / "chat.json").read_text())["traveler"]
        provenance["CHAT_WORDING"] = json.dumps({k: traveler[k] for k in ("withheld", "faresSay")})

        knowledge_base, data_source, kb_bucket = self.knowledge_base()
        tools_gateway = self.tools_gateway(knowledge_base, data_source)
        turns = self.turns_table()
        runtime = self.agent_runtime(tools_gateway, guardrail, guardrail_version, policy, turns, statements, provenance)
        instance = self.connect_instance()
        pool, client, token_url = self.machine_identity()
        agents_gateway = self.agents_gateway(runtime, pool, client)
        chat_start = self.chat_start(instance, pool, client, token_url)

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
        cdk.CfnOutput(self, "ConnectInstanceId", value=instance.attr_id)
        cdk.CfnOutput(self, "ConnectAccessUrl", value=f"https://{CONNECT_ALIAS}.my.connect.aws")
        cdk.CfnOutput(self, "AgentsGatewayUrl", value=agents_gateway.attr_gateway_url)
        cdk.CfnOutput(self, "TurnsTableName", value=turns.table_name)
        cdk.CfnOutput(self, "ChatStartFunctionName", value=chat_start.function_name)
        cdk.CfnOutput(self, "ContactFlowName", value=CONTACT_FLOW_NAME)

    def turns_table(self):
        """Each turn of a chat, kept 30 days: the contact, the turn's number,
        and the whole turn as JSON (chat/airline_agent/turns.py)."""
        return dynamodb.Table(
            self,
            "Turns",
            partition_key=dynamodb.Attribute(name="contact", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="turn", type=dynamodb.AttributeType.NUMBER),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="expires",
            removal_policy=RemovalPolicy.DESTROY,
        )

    def machine_identity(self):
        """The chat start's identity: a Cognito user pool with one
        client-credentials app.  Its token names the chat start, so one token
        serves every chat; a day is the longest Cognito allows."""
        pool = cognito.UserPool(
            self,
            "ChatIdentity",
            user_pool_name="verified-airline-chat",
            self_sign_up_enabled=False,
            removal_policy=RemovalPolicy.DESTROY,
        )
        scope = cognito.ResourceServerScope(scope_name=AGENTS_SCOPE, scope_description="Call the agents gateway")
        server = pool.add_resource_server(
            "AgentsServer", identifier=RESOURCE_SERVER, user_pool_resource_server_name=RESOURCE_SERVER, scopes=[scope])
        domain = pool.add_domain("Domain", cognito_domain=cognito.CognitoDomainOptions(
            domain_prefix=f"verified-airline-chat-{self.account}"))
        client = pool.add_client(
            "ChatStartClient",
            user_pool_client_name="chat-start",
            generate_secret=True,
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(client_credentials=True),
                scopes=[cognito.OAuthScope.resource_server(server, scope)],
            ),
            access_token_validity=Duration.days(1),
            auth_flows=cognito.AuthFlow(),
        )
        return pool, client, f"{domain.base_url()}/oauth2/token"

    def agents_gateway(self, runtime, pool, client):
        """The canvas's way to the agent.  The gateway checks the chat start's
        token by its client and scope, then calls the runtime with its own role
        (GATEWAY_IAM_ROLE).  guppi-hr passes the caller's token through
        instead, because its agents act for a signed-in employee; an anonymous
        traveler has no identity for the agent to carry on."""
        role = self.service_role("AgentsGatewayRole", "bedrock-agentcore.amazonaws.com",
                                 "Lets the agents gateway invoke the airline agent")
        arn = runtime.attr_agent_runtime_arn
        role.add_to_policy(iam.PolicyStatement(actions=["bedrock-agentcore:InvokeAgentRuntime"],
                                               resources=[arn, f"{arn}/runtime-endpoint/*"]))
        gateway = agentcore.CfnGateway(
            self,
            "AgentsGateway",
            name=AGENTS_GATEWAY_NAME,
            description="The airline agent for the Connect canvas; callers hold the chat start's Cognito token",
            role_arn=role.role_arn,
            authorizer_type="CUSTOM_JWT",
            authorizer_configuration=agentcore.CfnGateway.AuthorizerConfigurationProperty(
                custom_jwt_authorizer=agentcore.CfnGateway.CustomJWTAuthorizerConfigurationProperty(
                    discovery_url=(f"https://cognito-idp.{self.region}.amazonaws.com/{pool.user_pool_id}"
                                   "/.well-known/openid-configuration"),
                    allowed_clients=[client.user_pool_client_id],
                    allowed_scopes=[f"{RESOURCE_SERVER}/{AGENTS_SCOPE}"],
                )
            ),
            # protocol_type is left unset: runtime targets cannot join MCP gateways.
        )
        gateway.node.add_dependency(role)
        target = agentcore.CfnGatewayTarget(
            self,
            "AgentTarget",
            gateway_identifier=gateway.attr_gateway_identifier,
            name=AGENT_TARGET_NAME,
            description="The airline agent, called with the gateway's role",
            target_configuration=agentcore.CfnGatewayTarget.TargetConfigurationProperty(
                http=agentcore.CfnGatewayTarget.HttpTargetConfigurationProperty(
                    agentcore_runtime=agentcore.CfnGatewayTarget.RuntimeTargetConfigurationProperty(
                        arn=arn, qualifier="DEFAULT")
                )
            ),
            credential_provider_configurations=[
                agentcore.CfnGatewayTarget.CredentialProviderConfigurationProperty(
                    credential_provider_type="GATEWAY_IAM_ROLE")
            ],
            # The canvas names the runtime session after the contact, so one
            # chat's turns share a session.
            metadata_configuration=agentcore.CfnGatewayTarget.MetadataConfigurationProperty(
                allowed_request_headers=[SESSION_HEADER]),
        )
        target.node.add_dependency(role)
        return gateway

    def chat_start(self, instance, pool, client, token_url):
        """The Rust chat start.  It has no public route until the widget is
        published; then it gets one on the site's distribution, with a WAF
        rate limit and a budget alarm."""
        role = iam.Role(self, "ChatStartRole", assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
                        description="Starts Verified Airline support chats")
        role.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name(
            "service-role/AWSLambdaBasicExecutionRole"))
        instance_arn = instance.attr_arn
        role.add_to_policy(iam.PolicyStatement(
            actions=["connect:StartChatContact"],
            resources=[f"{instance_arn}/contact-flow/*", f"{instance_arn}/contact/*"]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["connect:ListContactFlows"], resources=[instance_arn, f"{instance_arn}/contact-flow/*"]))
        role.add_to_policy(iam.PolicyStatement(
            actions=["cognito-idp:DescribeUserPoolClient"], resources=[pool.user_pool_arn]))
        log_group = logs.LogGroup(self, "ChatStartLogs", log_group_name=f"/aws/lambda/{CHAT_START_NAME}",
                                  retention=logs.RetentionDays.ONE_MONTH, removal_policy=RemovalPolicy.DESTROY)
        return lambda_.Function(
            self,
            "ChatStart",
            function_name=CHAT_START_NAME,
            description="Starts a Verified Airline support chat on Amazon Connect",
            runtime=lambda_.Runtime.PROVIDED_AL2023,
            architecture=lambda_.Architecture.ARM_64,
            handler="bootstrap",
            code=chat_start_code(),
            role=role,
            memory_size=256,
            timeout=Duration.seconds(20),
            # A cap on chats started at once, which bounds what a burst can spend.
            reserved_concurrent_executions=5,
            log_group=log_group,
            environment={
                "CONNECT_INSTANCE_ID": instance.attr_id,
                "CONTACT_FLOW_NAME": CONTACT_FLOW_NAME,
                "USER_POOL_ID": pool.user_pool_id,
                "CLIENT_ID": client.user_pool_client_id,
                "TOKEN_URL": token_url,
                "SCOPE": f"{RESOURCE_SERVER}/{AGENTS_SCOPE}",
            },
        )

    def connect_instance(self):
        """A chat-only instance with Connect's own user directory.  The
        attributes match guppi-hr's instance, on which the Agentic CX designer
        ran; contact flow logs are on so a canvas hand-off can be traced."""
        instance = connect.CfnInstance(
            self,
            "ConnectInstance",
            instance_alias=CONNECT_ALIAS,
            identity_management_type="CONNECT_MANAGED",
            attributes=connect.CfnInstance.AttributesProperty(
                inbound_calls=True,
                outbound_calls=False,
                contactflow_logs=True,
                contact_lens=True,
                auto_resolve_best_voices=True,
                early_media=True,
                enhanced_chat_monitoring=True,
                multi_party_chat_conference=True,
            ),
        )
        instance.apply_removal_policy(RemovalPolicy.RETAIN)
        return instance

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

    def agent_runtime(self, tools_gateway, guardrail, guardrail_version, policy, turns, statements, provenance):
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
        role.add_to_policy(iam.PolicyStatement(
            actions=["dynamodb:PutItem", "dynamodb:Query"], resources=[turns.table_arn]))
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
                "TURNS_TABLE": turns.table_name,
                # What a withheld answer's reply says the fares say.
                "RULE_STATEMENTS": json.dumps(statements, separators=(",", ":")),
                # The answer certificate's last line, and the withheld reply's words.
                **provenance,
            },
        )
        # AgentCore checks the image pull grant when it creates the runtime, so
        # the runtime waits for the role's whole policy, not only the role.
        runtime.node.add_dependency(role)
        return runtime
