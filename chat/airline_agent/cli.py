"""Ask the agent one question from this machine, with the deployed tools
gateway and guardrail:

  uv run python -m airline_agent.cli [--mode kb|verified] "question"
"""

import argparse
import json
import os

import boto3

from airline_agent.agent import MODES, answer


def main():
    ap = argparse.ArgumentParser(description="Ask the support chat agent one question.")
    ap.add_argument("question")
    ap.add_argument("--mode", choices=MODES, default="verified")
    args = ap.parse_args()
    cf = boto3.client("cloudformation", region_name="us-east-1")
    (stack,) = cf.describe_stacks(StackName="VerifiedAirlineChat")["Stacks"]
    out = {o["OutputKey"]: o["OutputValue"] for o in stack["Outputs"]}
    os.environ.setdefault("TOOLS_GATEWAY_URL", out["ToolsGatewayUrl"])
    os.environ.setdefault("MODEL_ID", out["ModelId"])
    os.environ.setdefault("GUARDRAIL_ID", out["GuardrailId"])
    os.environ.setdefault("GUARDRAIL_VERSION", out["GuardrailVersion"])
    print(json.dumps(answer(args.question, args.mode), indent=1))


if __name__ == "__main__":
    main()
