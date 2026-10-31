"""What the widget may read of a turn: its state, the draft, the check, and
for the answer certificate, each cited rule's statement, Lean rule and
requirements with their criteria's status.  The passages retrieval returned
stay in the record."""

import json


def criteria(requirements, rid):
    statuses = [c["status"] for c in requirements.get(rid, {}).get("criteria", [])]
    return {"id": rid, "proven": statuses.count("proven"), "total": len(statuses)}


def view(item, rules, requirements):
    """One record as the widget reads it.  `rules` is ar-rules.json's rules
    and `requirements` model.json's."""
    body = json.loads(item["body"])
    check = body.get("check")
    cited = sorted({r for f in (check or {}).get("findings", []) for r in f.get("rules", [])})
    return {
        "contact": item["contact"],
        "turn": int(item["turn"]),
        "at": int(item["at"]),
        "mode": body["mode"],
        "state": body["state"],
        "question": body["question"],
        "draft": body["answer"],
        "check": check and {k: check[k] for k in ("result", "findings", "rulesApplied", "untranslated")},
        "rules": {r: {"statement": rules[r]["statement"], "lean": rules[r]["lean"],
                      "requirements": [criteria(requirements, q) for q in rules[r]["requirements"]]}
                  for r in cited if r in rules},
        "provenance": body.get("provenance"),
    }
