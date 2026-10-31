"""Ask the support chat agent every question in chat/questions.json.

  uv run scripts/ask.py [--rounds N] [--only ID] [--mode verified|kb] [--local]

Each question goes to the agent on AgentCore Runtime (or, with --local, to the
agent in this process, with the deployed tools gateway and guardrail).  In
verified mode a reply carries the knowledge base's answer and the guardrail's
result for it, so one run shows both what the knowledge base alone says and
what the check makes of it.  The report, build/chat/ask-report.json, keeps
every answer, the passages retrieval returned and every finding.
"""

import argparse
import json
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

CHAT = Path(__file__).resolve().parents[1]
REPORT = CHAT.parent / "build" / "chat" / "ask-report.json"
REGION = "us-east-1"


def outputs(stack):
    cf = boto3.client("cloudformation", region_name=REGION)
    (s,) = cf.describe_stacks(StackName=stack)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}


def remote(out):
    client = boto3.client("bedrock-agentcore", region_name=REGION)

    def ask(question, mode):
        response = client.invoke_agent_runtime(
            agentRuntimeArn=out["RuntimeArn"],
            runtimeSessionId=uuid.uuid4().hex + uuid.uuid4().hex[:8],
            contentType="application/json",
            accept="application/json",
            payload=json.dumps({"question": question, "mode": mode}).encode(),
        )
        return json.loads(response["response"].read())
    return ask


def local(out):
    os.environ.setdefault("TOOLS_GATEWAY_URL", out["ToolsGatewayUrl"])
    os.environ.setdefault("MODEL_ID", out["ModelId"])
    os.environ.setdefault("GUARDRAIL_ID", out["GuardrailId"])
    os.environ.setdefault("GUARDRAIL_VERSION", out["GuardrailVersion"])
    from airline_agent.agent import answer
    return answer


def main():
    ap = argparse.ArgumentParser(description="Ask the support chat agent the question set.")
    ap.add_argument("--rounds", type=int, default=1)
    ap.add_argument("--only", help="ask only the question with this ID")
    ap.add_argument("--kind", choices=["direct", "leading"], help="ask only questions of this kind")
    ap.add_argument("--mode", choices=["verified", "kb"], default="verified")
    ap.add_argument("--local", action="store_true", help="run the agent in this process")
    ap.add_argument("--report", type=Path, default=REPORT)
    args = ap.parse_args()
    questions = json.loads((CHAT / "questions.json").read_text())["questions"]
    if args.only:
        questions = [q for q in questions if q["id"] == args.only]
    if args.kind:
        questions = [q for q in questions if q.get("kind", "direct") == args.kind]
    out = outputs("VerifiedAirlineChat")
    ask = local(out) if args.local else remote(out)
    jobs = [q for q in questions for _ in range(args.rounds)]

    def run(q):
        try:
            return {**ask(q["question"], args.mode), "id": q["id"]}
        except Exception as e:  # one failed turn is reported, not fatal
            return {"id": q["id"], "error": f"{type(e).__name__}: {e}"}

    with ThreadPoolExecutor(max_workers=4) as pool:
        turns = list(pool.map(run, jobs))
    report = []
    for i, q in enumerate(questions):
        rounds = turns[i * args.rounds:(i + 1) * args.rounds]
        results = [t.get("check", {}).get("result", "ERROR" if "error" in t else "-") for t in rounds]
        tally = ", ".join(f"{results.count(k)} {k}" for k in dict.fromkeys(results))
        print(f"{q['id']:<22} {q['policy']:<8} {tally}")
        for t in rounds:
            text = t.get("answer") or t.get("error", "")
            print(f"    {text[:220]}")
        report.append({**q, "rounds": rounds})
    args.report.write_text(json.dumps({"mode": args.mode, "rounds": args.rounds, "results": report}, indent=1,
                                      default=str) + "\n")
    print(f"report in {args.report}")


if __name__ == "__main__":
    main()
