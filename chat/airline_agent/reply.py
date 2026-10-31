"""What the traveler is shown for one turn, from the turn's mode and check.

The bar is the one the design doc proposes for review ("Answer states in
verified mode"): a draft the check contradicts is withheld; a draft is shown
as verified only when every finding is VALID with at least one rule and
nothing in the draft was left untranslated; anything else is shown as not
checked.  INVALID is tested first, since the guardrail's own worst-finding
order puts TRANSLATION_AMBIGUOUS above it.  In "kb" mode nothing is checked.
"""

import json
import os

WITHHELD = "withheld"
VERIFIED = "verified"
NOT_CHECKED = "not checked"


def state(turn):
    check = turn.get("check")
    if turn["mode"] != "verified" or not check:
        return NOT_CHECKED
    findings = check["findings"]
    if any(f["kind"] == "invalid" for f in findings):
        return WITHHELD
    if findings and all(f["kind"] == "valid" and f.get("rules") for f in findings) and not check["untranslated"]:
        return VERIFIED
    return NOT_CHECKED


def statements():
    """Each policy rule's meaning in traveler's words, keyed by rule ID
    (RULE_STATEMENTS, which the stack sets from model/ar-rules.json)."""
    return json.loads(os.environ.get("RULE_STATEMENTS") or "{}")


def wording():
    """The withheld reply's words, from content/chat.json (CHAT_WORDING, set
    by the stack)."""
    return json.loads(os.environ["CHAT_WORDING"])


def text(turn, shown_state, meaning=None, words=None):
    """The reply's text.  A withheld draft is replaced by what the fares say
    on the point the draft got wrong."""
    if shown_state != WITHHELD:
        return turn["answer"]
    meaning = statements() if meaning is None else meaning
    words = wording() if words is None else words
    contradicted = [r for f in turn["check"]["findings"] if f["kind"] == "invalid" for r in f.get("rules", [])]
    said = list(dict.fromkeys(meaning[r] for r in contradicted if r in meaning))
    return " ".join([words["withheld"], *([words["faresSay"], *said] if said else [])])
