#!/usr/bin/env python3
"""Check Verified Airline's check-in, wallet and gate screens against a build
of the One ID model.  verified-id's scripts/check-airline.sh runs this with
--model pointing at its fresh build, and scripts/update-model.sh runs it before
model/one-id/ changes.

It stops if

  * content/one-id.json uses a word or ID a traveler never reads, cites a
    requirement or criterion the model lacks, calls a point still being decided
    that is no longer open, or calls something a stand-in once the scenarios
    use none (render_airline.load_one_id);
  * a TypeScript check in web/src/app/one-id/rules/ names no requirement, names
    one the model does not have, or gives another Lean name for it;
  * the reading points the TypeScript takes differ from readings.json; or
  * a line of decisions.jsonl gives a different answer from the TypeScript
    checks (web/scripts/one-id-vectors.mjs, which needs npm ci in web/).

  python3 scripts/check_one_id.py [--model DIR] [--static] [--decisions FILE]

--static leaves out the vectors, which `npm test` also runs.  --decisions also
writes the model's answers as one JSON object keyed by each decision's name, for
the gate's "the model's answer" display.  It needs only Python's standard
library, as the renderer does, and node for the vectors.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import render_airline

ROOT = Path(__file__).resolve().parent.parent
RULES = ROOT / "web" / "src" / "app" / "one-id" / "rules"
DOC = re.compile(r"/\*\*((?:(?!\*/).)*?)\*/\s*export function (\w+)", re.S)
# A check outside the model would name its guarantee here.  There are none.
OUTSIDE_THE_MODEL = {}


def check_traceability(model):
    """Every exported function of a rule file names a requirement of the model
    and its Lean function.  Returns how many there are."""
    requirements = model["requirements"]
    count = 0
    for path in sorted(RULES.glob("*.ts")):
        if path.name.endswith(".spec.ts"):
            continue
        where = f"web/src/app/one-id/rules/{path.name}"
        text = path.read_text()
        exported = re.findall(r"^export function (\w+)", text, re.M)
        if not exported:
            render_airline.fail(where, "exports no check")
        docs = {name: body for body, name in DOC.findall(text)}
        for name in exported:
            doc = docs.get(name, "")
            outside = re.search(r"not in the model: (\S+)", doc)
            if outside:
                if OUTSIDE_THE_MODEL.get(name) != outside.group(1):
                    render_airline.fail(where, f"{name} says it is outside the model; only {OUTSIDE_THE_MODEL} may")
                if outside.group(1) in requirements:
                    render_airline.fail(where, f"{name} says {outside.group(1)} is not in the model, and now it is")
                count += 1
                continue
            req, lean = re.search(r"requirement: (\S+)", doc), re.search(r"lean: (\S+)", doc)
            if not req or not lean:
                render_airline.fail(where, f"{name} names no requirement and Lean function in its comment")
            if req.group(1) not in requirements:
                render_airline.fail(where, f"{name} names {req.group(1)}, which the model does not have")
            if "part of requirement:" not in doc and requirements[req.group(1)]["name"] != lean.group(1):
                render_airline.fail(where, f"{name} names {lean.group(1)}, and the model calls {req.group(1)} "
                                           f"{requirements[req.group(1)]['name']}")
            count += 1
    return count


def check_readings(readings, constant="READING_POINTS"):
    """The reading points the TypeScript takes are the ones a readings file has."""
    text = (RULES / "support" / "readings.ts").read_text()
    block = text[re.search(rf"\bconst {constant}\b", text).start():]
    block = block[:block.index("};")]
    ours = {k: re.findall(r"'([^']+)'", v) for k, v in re.findall(r"^\s*'?([\w.]+)'?: \[([^\]]*)\]", block, re.M)}
    theirs = {r["id"]: r["checks"] for r in readings["readings"]}
    if ours != theirs:
        only_ours = sorted(set(ours) - set(theirs))
        only_theirs = sorted(set(theirs) - set(ours))
        differ = sorted(k for k in set(ours) & set(theirs) if ours[k] != theirs[k])
        render_airline.fail("web/src/app/one-id/rules/support/readings.ts",
                            f"the reading points differ from readings.json: only here {only_ours}, "
                            f"only there {only_theirs}, other checks {differ}")
    return len(theirs)


def main():
    ap = argparse.ArgumentParser(description="Check the One ID screens against a build of the model.")
    ap.add_argument("--model", type=Path, default=render_airline.ONE_ID, help="the directory with the One ID model's files")
    ap.add_argument("--static", action="store_true", help="leave out the conformance vectors")
    ap.add_argument("--decisions", type=Path, help="also write the model's answers, by decision name, to this file")
    args = ap.parse_args()
    model_dir = args.model.resolve()
    for f in ("model.json", "scenarios.json", "readings.json", "decisions.jsonl"):
        if not (model_dir / f).exists():
            sys.exit(f"check_one_id: {model_dir / f} is missing")
    try:
        if render_airline.load_one_id(model_dir) is None:
            print("check_one_id: content/one-id.json does not exist yet, so its wording is not checked")
        else:
            print("check_one_id: content/one-id.json agrees with the model")
        checks = check_traceability(json.loads((model_dir / "model.json").read_text()))
        points = check_readings(json.loads((model_dir / "readings.json").read_text()))
        presentation = model_dir / "presentation" / "readings.json"
        if presentation.exists():
            points += check_readings(json.loads(presentation.read_text()), "PRESENTATION_READING_POINTS")
        print(f"check_one_id: {checks} checks name what the model has; {points} reading points agree")
    except render_airline.BuildError as e:
        sys.exit(f"check_one_id: {e}")
    if args.decisions:
        files = [model_dir / "decisions.jsonl", model_dir / "presentation" / "decisions.jsonl"]
        rows = [json.loads(line) for f in files if f.exists() for line in f.read_text().splitlines() if line.strip()]
        args.decisions.parent.mkdir(parents=True, exist_ok=True)
        args.decisions.write_text(json.dumps({r["name"]: r["response"]["result"] for r in rows if r["scenario"]},
                                             ensure_ascii=False, separators=(",", ":")) + "\n")
    if args.static:
        return
    if not (ROOT / "web" / "node_modules" / "esbuild").exists():
        print("check_one_id: the vectors did not run; run npm ci in web/ first")
        return
    run = subprocess.run(["node", str(ROOT / "web" / "scripts" / "one-id-vectors.mjs"), "--model", str(model_dir)])
    if run.returncode != 0:
        sys.exit("check_one_id: the TypeScript checks and decisions.jsonl disagree")


if __name__ == "__main__":
    main()
