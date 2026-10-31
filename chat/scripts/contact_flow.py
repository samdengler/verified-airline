"""Create or update the Connect contact flow that hands a chat to the canvas.

  uv run scripts/contact_flow.py

The flow sets the contact's language, then runs the Agentic CX block with the
deployment chat/canvas/deploy.js wrote to build/chat/canvas.json.  The block
copies the contact attributes `mode` and `agentsToken`, which the chat start
sets, into the canvas's context variables.  When the canvas ends, the chat
ends; an error says so in the chat first.  The chat start finds the flow by
its name, so a redeploy of the canvas needs only this script.
"""

import json
import sys
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / "build" / "chat" / "canvas.json"
REGION = "us-east-1"
FLOW_NAME = "verified-airline-chat"


def outputs(stack):
    cf = boto3.client("cloudformation", region_name=REGION)
    (s,) = cf.describe_stacks(StackName=stack)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}


def flow_content(canvas):
    return {
        "Version": "2019-10-30",
        "StartAction": "SetLanguage",
        "Metadata": {},
        "Actions": [
            {
                "Identifier": "SetLanguage",
                "Type": "UpdateContactData",
                "Parameters": {"LanguageCode": "en-US"},
                "Transitions": {"NextAction": "Canvas",
                                "Errors": [{"ErrorType": "NoMatchingError", "NextAction": "Canvas"}]},
            },
            {
                "Identifier": "Canvas",
                "Type": "ConnectParticipantWithAgenticCX",
                "Parameters": {
                    "AgentConfiguration": {
                        "WorkspaceId": canvas["workspaceId"],
                        "ApplicationId": canvas["applicationId"],
                        "Alias": canvas["deploymentAlias"],
                        "ContextVariables": {"mode": "$.Attributes.mode", "agentsToken": "$.Attributes.agentsToken"},
                    },
                    # Both blocks appear in the console's export, and an import
                    # without them fails with "Invalid Action property value"
                    # (guppi-hr's contact flow notes).
                    "SpeechRecognitionConfiguration": {"SpeechRecognitionEngine": "AMAZON_AGENTIC_VOICE"},
                    "AudioFillerConfiguration": {
                        "Enabled": True,
                        "AudioType": "MELODY_CHIPPER_CHIME",
                        "StartDelayInMilliseconds": 2500,
                        "MinimumPlayDurationInMilliseconds": 3000,
                        "ResponseDeliveryDelayInMilliseconds": 500,
                    },
                },
                "Transitions": {
                    "NextAction": "Disconnect",
                    "Errors": [
                        {"ErrorType": "NoMatchingError", "NextAction": "ErrorMessage"},
                        {"ErrorType": "NoMatchingCondition", "NextAction": "Disconnect"},
                        {"ErrorType": "InputTimeLimitExceeded", "NextAction": "Disconnect"},
                    ],
                },
            },
            {
                "Identifier": "ErrorMessage",
                "Type": "MessageParticipant",
                "Parameters": {"Text": "Sorry, the chat stopped working. Please start a new one."},
                "Transitions": {"NextAction": "Disconnect",
                                "Errors": [{"ErrorType": "NoMatchingError", "NextAction": "Disconnect"}]},
            },
            {"Identifier": "Disconnect", "Type": "DisconnectParticipant", "Parameters": {}, "Transitions": {}},
        ],
    }


def main():
    if not STATE.exists():
        sys.exit(f"no {STATE}; run node chat/canvas/deploy.js first")
    canvas = json.loads(STATE.read_text())
    instance = outputs("VerifiedAirlineChat")["ConnectInstanceId"]
    connect = boto3.client("connect", region_name=REGION)
    content = json.dumps(flow_content(canvas))
    flows = [f for page in connect.get_paginator("list_contact_flows").paginate(
        InstanceId=instance, ContactFlowTypes=["CONTACT_FLOW"]) for f in page["ContactFlowSummaryList"]]
    existing = next((f for f in flows if f["Name"] == FLOW_NAME), None)
    if existing:
        connect.update_contact_flow_content(InstanceId=instance, ContactFlowId=existing["Id"], Content=content)
        print(f"updated contact flow {existing['Id']}, alias {canvas['deploymentAlias']}")
    else:
        flow_id = connect.create_contact_flow(
            InstanceId=instance, Name=FLOW_NAME, Type="CONTACT_FLOW",
            Description="Hands a Verified Airline support chat to the canvas", Content=content,
            Status="PUBLISHED")["ContactFlowId"]
        print(f"created contact flow {flow_id}, alias {canvas['deploymentAlias']}")


if __name__ == "__main__":
    main()
