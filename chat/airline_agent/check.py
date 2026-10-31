"""The Automated Reasoning check: one question and answer through the guardrail.

The question goes in as user-side content (the `query` qualifier) and the
answer as the content to check, so the check reads its premises from the
question and its claims from the answer.  Automated Reasoning only detects; the
result is returned as the guardrail gives it.
"""

import time

KINDS = ["valid", "invalid", "satisfiable", "impossible", "translationAmbiguous", "tooComplex", "noTranslations"]
# Worst first, as AWS's integration guide sorts them.
SEVERITY = {"tooComplex": 0, "translationAmbiguous": 0, "impossible": 1, "invalid": 2, "satisfiable": 3,
            "valid": 4, "noTranslations": 5}
NAMES = {"translationAmbiguous": "TRANSLATION_AMBIGUOUS", "tooComplex": "TOO_COMPLEX",
         "noTranslations": "NO_TRANSLATIONS"}


def kind_of(finding):
    return next((k for k in KINDS if k in finding), None)


def logic(items):
    return [i.get("logic") or i.get("naturalLanguage") for i in items or []]


def summarize(finding):
    kind = kind_of(finding)
    body = finding[kind]
    if kind == "translationAmbiguous":
        return {"kind": kind, "options": [
            {"premises": logic(tr.get("premises")), "claims": logic(tr.get("claims"))}
            for o in body.get("options", []) for tr in o.get("translations", [])]}
    t = body.get("translation") or {}
    rules = body.get("supportingRules") or body.get("contradictingRules") or []
    return {
        "kind": kind,
        "premises": logic(t.get("premises")),
        "claims": logic(t.get("claims")),
        "confidence": t.get("confidence"),
        "untranslated": [u.get("text") for u in (t.get("untranslatedPremises") or []) + (t.get("untranslatedClaims") or [])],
        "rules": [r.get("identifier") for r in rules],
    }


def check(runtime, guardrail, version, question, answer):
    """The guardrail's result for one answer: the worst finding's kind, every
    finding summarized, the policy units billed and the time taken."""
    started = time.monotonic()
    response = runtime.apply_guardrail(
        guardrailIdentifier=guardrail,
        guardrailVersion=version,
        source="OUTPUT",
        content=[
            {"text": {"text": question, "qualifiers": ["query"]}},
            {"text": {"text": answer, "qualifiers": ["guard_content"]}},
        ],
    )
    ms = round((time.monotonic() - started) * 1000)
    findings = [f for a in response.get("assessments", []) for f in a.get("automatedReasoningPolicy", {}).get("findings", [])]
    kinds = [kind_of(f) for f in findings]
    worst = min(kinds, key=lambda k: SEVERITY.get(k, 0)) if kinds else None
    result = NAMES.get(worst, worst.upper()) if worst else "NONE"
    summaries = [summarize(f) for f in findings]
    # A VALID finding whose only claim is `true` checked nothing: the text did
    # not translate into the policy's variables.  The result stays as the
    # guardrail returned it; these fields let the chat say no rule applied.
    rules = sorted({r for f in summaries for r in f.get("rules", [])})
    return {"result": result, "findings": summaries, "rulesApplied": rules,
            "untranslated": [u for f in summaries for u in f.get("untranslated", [])],
            "units": response.get("usage", {}).get("automatedReasoningPolicyUnits"), "ms": ms}
