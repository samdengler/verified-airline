"""Keep the policy's own tests in step with the checks, and run them.

  uv run scripts/policy_tests.py [--no-run]

Bedrock stores test cases on an Automated Reasoning policy and runs them
against one of the policy's builds; the console shows the results beside the
policy.  CloudFormation manages neither, so this script does both.  Every check
in build/chat/ar-checks.json with an expected result becomes a test case: the
question as query content, the answer as guard content, the expected result as
the aggregated finding.  Test cases no check describes are deleted.  A build
that imports build/chat/ar-policy.json gives the tests the deployed definition
to run against; the build only produces a result and leaves the policy as it
is.  scripts/check_policy.py stays the test of the deployed guardrail, its
version, its role and its cross-Region profile; these tests cover the policy
alone.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[2]
CHAT = ROOT / "build" / "chat"
REGION = "us-east-1"
DONE = ("COMPLETED", "FAILED", "CANCELLED")


def outputs(stack):
    cf = boto3.client("cloudformation", region_name=REGION)
    (s,) = cf.describe_stacks(StackName=stack)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}


def pages(call, key, **kwargs):
    while True:
        page = call(**kwargs)
        yield from page.get(key, [])
        if not page.get("nextToken"):
            return
        kwargs["nextToken"] = page["nextToken"]


def sync_cases(bedrock, arn, checks):
    """Create a test case for each check that has none, delete the rest, and
    return the test case IDs in the checks' order."""
    want = {(c["question"], c["answer"]): c["expect"] for c in checks}
    have = {}
    for t in pages(bedrock.list_automated_reasoning_policy_test_cases, "testCases", policyArn=arn):
        key = (t.get("queryContent"), t["guardContent"])
        if want.get(key) == t.get("expectedAggregatedFindingsResult") and key not in have:
            have[key] = t["testCaseId"]
        else:
            bedrock.delete_automated_reasoning_policy_test_case(
                policyArn=arn, testCaseId=t["testCaseId"], lastUpdatedAt=t["updatedAt"])
    created = 0
    for (question, answer), expect in want.items():
        if (question, answer) not in have:
            have[(question, answer)] = bedrock.create_automated_reasoning_policy_test_case(
                policyArn=arn, queryContent=question, guardContent=answer,
                expectedAggregatedFindingsResult=expect)["testCaseId"]
            created += 1
    print(f"{len(want)} test cases, {created} created")
    return [have[(c["question"], c["answer"])] for c in checks]


def wait(get, label):
    while True:
        status = get()
        if status in DONE:
            return status
        print(f"  {label}: {status.lower()}", file=sys.stderr)
        time.sleep(15)


def build(bedrock, arn, definition):
    """A completed build of the deployed definition.  Earlier builds are
    deleted first, since a policy keeps only a few."""
    for b in pages(bedrock.list_automated_reasoning_policy_build_workflows,
                   "automatedReasoningPolicyBuildWorkflowSummaries", policyArn=arn):
        if b["status"] in DONE:
            bedrock.delete_automated_reasoning_policy_build_workflow(
                policyArn=arn, buildWorkflowId=b["buildWorkflowId"], lastUpdatedAt=b["updatedAt"])
    build_id = bedrock.start_automated_reasoning_policy_build_workflow(
        policyArn=arn, buildWorkflowType="IMPORT_POLICY",
        sourceContent={"policyDefinition": definition})["buildWorkflowId"]
    status = wait(lambda: bedrock.get_automated_reasoning_policy_build_workflow(
        policyArn=arn, buildWorkflowId=build_id)["status"], "build")
    if status != "COMPLETED":
        sys.exit(f"build {build_id} {status.lower()}")
    return build_id


def main():
    ap = argparse.ArgumentParser(description="Sync the policy's test cases with the checks and run them.")
    ap.add_argument("--no-run", action="store_true", help="sync the test cases only")
    args = ap.parse_args()
    checks = [c for c in json.loads((CHAT / "ar-checks.json").read_text())["checks"] if c["expect"] != "explore"]
    definition = json.loads((CHAT / "ar-policy.json").read_text())
    arn = outputs("VerifiedAirlineChat")["PolicyArn"]
    bedrock = boto3.client("bedrock", region_name=REGION)
    ids = sync_cases(bedrock, arn, checks)
    if args.no_run:
        return
    build_id = build(bedrock, arn, definition)
    # With no test case IDs the run takes every test case; the call takes at
    # most one ID otherwise.
    bedrock.start_automated_reasoning_policy_test_workflow(policyArn=arn, buildWorkflowId=build_id)

    def results():
        return {r["testCase"]["testCaseId"]: r for r in pages(
            bedrock.list_automated_reasoning_policy_test_results, "testResults",
            policyArn=arn, buildWorkflowId=build_id)}

    while True:
        got = results()
        running = [i for i in ids if got.get(i, {}).get("testRunStatus") not in ("COMPLETED", "FAILED")]
        if not running:
            break
        print(f"  tests: {len(ids) - len(running)} of {len(ids)} done", file=sys.stderr)
        time.sleep(15)
    failed = 0
    for c, i in zip(checks, ids):
        r = got[i]
        ok = r.get("testRunResult") == "PASSED"
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {c['name']:<40} expected {c['expect']}, got "
              f"{r.get('aggregatedTestFindingsResult', r['testRunStatus'])}")
    print(f"{len(ids) - failed} of {len(ids)} passed against build {build_id}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
