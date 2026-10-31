"""Send each check in build/chat/ar-checks.json through the chat's guardrail.

  uv run scripts/check_policy.py [--only TEXT] [--rounds N] [--report FILE]

Each check is a traveler's question and an answer.  The question goes in as
user-side content (the `query` qualifier) and the answer as the content to
check, so Automated Reasoning reads its premises from the question and its
claims from the answer.  A right answer must come back VALID and a wrong one
INVALID; checks marked "explore" are reported without an expected result.
The translation step uses several LLMs, so a result can differ from one run
to the next; --rounds runs every check N times and a check passes only if
every round does.  The report, build/chat/check-report.json, keeps every
finding as returned.
"""

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[2]
CHAT = ROOT / "build" / "chat"
REGION = "us-east-1"
KINDS = ["valid", "invalid", "satisfiable", "impossible", "translationAmbiguous", "tooComplex", "noTranslations"]
# Worst first, as AWS's integration guide sorts them.
SEVERITY = {"tooComplex": 0, "translationAmbiguous": 0, "impossible": 1, "invalid": 2, "satisfiable": 3,
            "valid": 4, "noTranslations": 5}


def outputs(stack):
    cf = boto3.client("cloudformation", region_name=REGION)
    (s,) = cf.describe_stacks(StackName=stack)["Stacks"]
    return {o["OutputKey"]: o["OutputValue"] for o in s["Outputs"]}


def kind_of(finding):
    return next((k for k in KINDS if k in finding), None)


def logic(items):
    return [i.get("logic") or i.get("naturalLanguage") for i in items or []]


def summarize(finding):
    kind = kind_of(finding)
    body = finding[kind]
    t = body.get("translation") or {}
    rules = body.get("supportingRules") or body.get("contradictingRules") or []
    if kind == "translationAmbiguous":
        return {"kind": kind, "options": [
            {"premises": logic(tr.get("premises")), "claims": logic(tr.get("claims"))}
            for o in body.get("options", []) for tr in o.get("translations", [])]}
    return {
        "kind": kind,
        "premises": logic(t.get("premises")),
        "claims": logic(t.get("claims")),
        "confidence": t.get("confidence"),
        "untranslated": [u.get("text") for u in (t.get("untranslatedPremises") or []) + (t.get("untranslatedClaims") or [])],
        "rules": [r.get("identifier") for r in rules],
    }


def check(runtime, guardrail, version, c):
    started = time.monotonic()
    response = runtime.apply_guardrail(
        guardrailIdentifier=guardrail,
        guardrailVersion=version,
        source="OUTPUT",
        content=[
            {"text": {"text": c["question"], "qualifiers": ["query"]}},
            {"text": {"text": c["answer"], "qualifiers": ["guard_content"]}},
        ],
    )
    ms = round((time.monotonic() - started) * 1000)
    findings = [f for a in response.get("assessments", []) for f in a.get("automatedReasoningPolicy", {}).get("findings", [])]
    units = response.get("usage", {}).get("automatedReasoningPolicyUnits")
    kinds = [kind_of(f) for f in findings]
    result = min(kinds, key=lambda k: SEVERITY.get(k, 0)) if kinds else None
    return {**c, "result": result.upper() if result else "NONE", "findings": [summarize(f) for f in findings],
            "units": units, "ms": ms, "action": response.get("action")}


def result_name(kind):
    return {"TRANSLATIONAMBIGUOUS": "TRANSLATION_AMBIGUOUS", "TOOCOMPLEX": "TOO_COMPLEX",
            "NOTRANSLATIONS": "NO_TRANSLATIONS"}.get(kind, kind)


def main():
    ap = argparse.ArgumentParser(description="Check the guardrail against right and wrong answers.")
    ap.add_argument("--only", help="run only checks whose name contains this text")
    ap.add_argument("--rounds", type=int, default=1, help="run every check this many times")
    ap.add_argument("--report", type=Path, default=CHAT / "check-report.json")
    args = ap.parse_args()
    checks = json.loads((CHAT / "ar-checks.json").read_text())["checks"]
    rules = json.loads((CHAT / "ar-rules.json").read_text())["rules"]
    if args.only:
        checks = [c for c in checks if args.only in c["name"]]
    out = outputs("VerifiedAirlineChat")
    runtime = boto3.client("bedrock-runtime", region_name=REGION)
    jobs = [c for c in checks for _ in range(args.rounds)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        runs = list(pool.map(lambda c: check(runtime, out["GuardrailId"], out["GuardrailVersion"], c), jobs))
    results, failed = [], 0
    for i, c in enumerate(checks):
        rounds = runs[i * args.rounds:(i + 1) * args.rounds]
        for r in rounds:
            r["result"] = result_name(r["result"])
        seen = [r["result"] for r in rounds]
        ok = c["expect"] == "explore" or all(x == c["expect"] for x in seen)
        failed += not ok
        mark = "NOTE" if c["expect"] == "explore" else "PASS" if ok else "FAIL"
        named = sorted({rid for r in rounds for f in r["findings"] for rid in f.get("rules", [])})
        lean = ", ".join(rules[rid]["lean"] for rid in named if rid in rules)
        tally = ", ".join(f"{seen.count(k)} {k}" for k in dict.fromkeys(seen))
        ms = round(sum(r["ms"] for r in rounds) / len(rounds))
        print(f"{mark}  {c['name']:<42} {tally:<34} {ms:>5} ms  {lean}")
        results.append({**c, "rounds": rounds})
    args.report.write_text(json.dumps({"guardrail": out["GuardrailId"], "version": out["GuardrailVersion"],
                                       "results": results}, indent=1, default=str) + "\n")
    passed = sum(1 for r in results if r["expect"] != "explore") - failed
    every = [r for x in results if x["expect"] != "explore" for r in x["rounds"]]
    agree = sum(1 for r in every if r["result"] == r["expect"])
    print(f"{passed} of {passed + failed} checks right in every round; {agree} of {len(every)} runs right; "
          f"report in {args.report}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
