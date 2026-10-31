#!/usr/bin/env python3
"""Write what the support chat needs from the Lean model into build/chat/.

  python3 scripts/export_chat.py [--model DIR] [--out DIR]

ar-policy.json
    An Amazon Bedrock Automated Reasoning policy definition for fares and
    refunds.  Its rules are generated from facts.json, the fares that
    `lake exe airline-facts` evaluated with the model's own functions: one
    rule for each fare, request and stage of a trip, plus the amount due on a
    change (ONE-202) and the refund limit of acceptRefund (OO-003).  Two
    axioms carry what the model's types say: an amount of money is never
    negative (Money's amount is a natural number), and every fare's price is
    positive.  The chat stack (infra/) loads it as JSON, so no LLM writes a
    rule.
ar-rules.json
    Each rule's ID with the Lean rule and requirements it encodes, and a
    sentence for people, so the chat can show a finding's rules the way the
    site shows a section's requirement.  A fare rule also names the Lean
    theorem that proves its fact, from theorems.json, which the chat's answer
    certificate links.
ar-checks.json
    Questions with a right and a wrong answer for each rule, which
    chat/scripts/check_policy.py sends through the guardrail.  A right answer
    must come back VALID and a wrong one INVALID.  Checks marked "explore"
    have no expected result: they probe what the model leaves open.
kb/
    The knowledge base's documents, in Markdown: one per fare and the worked
    examples, from facts.json; the six policy pages as scripts/render_airline.py
    writes them, with the Lean model's markers and popovers left out; and the
    requirements on fares and refunds, from model.json.  Each names the
    verified-air commit it came from.  chat/scripts/sync_kb.py uploads them.

The policy encodes only what the model decides.  Whether refunds against one
payment are capped in total is the model's open question OO-003.2, so no rule
mentions a total.  It needs only Python's standard library, like the renderer.
"""

import argparse
import json
import re
import shutil
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_airline  # noqa: E402  (the renderer beside this script)

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "model"
OUT = ROOT / "build" / "chat"

FARES = {"basic": ("BASIC", "BAS", "Basic"), "main": ("MAIN", "MAI", "Main"), "flex": ("FLEX", "FLX", "Flex")}
# The stages a fare's terms name, as facts.json keys them.  The site's
# wording for each is in content/changes.md.
STAGES = {
    "beforeDeparture": ("PAID_BEFORE_DEPARTURE", "PAID", "before departure",
                        "I have paid for my trip, and my first flight has not left yet."),
    "afterDeparture": ("AFTER_FIRST_FLIGHT", "FLWN", "after your first flight",
                       "I have already taken the first flight of my trip."),
    "noShow": ("AFTER_MISSED_FLIGHT", "MISS", "after a missed flight", "I missed my flight."),
}
# Change and cancellation each have variables of their own, so a rule needs
# no variable for which one the traveler asks about: one more variable for
# the translation to assign only made it disagree with itself.
REQUESTS = {"change": ("CHG", ["ONE-503", "ONE-504"]), "cancel": ("CXL", ["ONE-503", "ONE-505"])}

TYPES = [
    {"name": "FareType", "description": "The fares Verified Airline sells.", "values": [
        {"value": "BASIC", "description": "The Basic fare, the lowest price, with no changes."},
        {"value": "MAIN", "description": "The Main fare."},
        {"value": "FLEX", "description": "The Flex fare, the most flexible."},
    ]},
    {"name": "TripStage", "description": "How far along the trip the traveler is when they ask.", "values": [
        {"value": "PAID_BEFORE_DEPARTURE",
         "description": "The booking is paid and the first flight of the trip has not departed."},
        {"value": "AFTER_FIRST_FLIGHT", "description": "The traveler has taken the first flight of the trip."},
        {"value": "AFTER_MISSED_FLIGHT", "description": "The traveler missed a flight or did not show up for it."},
    ]},
]

VARIABLES = [
    ("fare", "FareType",
     "The fare the traveler booked with Verified Airline: BASIC, MAIN or FLEX. Set it from the fare named in the "
     "question or the answer, such as 'my Main ticket' (MAIN) or 'a Flex fare' (FLEX)."),
    ("tripStage", "TripStage",
     "Where the traveler is in the trip when they ask. PAID_BEFORE_DEPARTURE when the booking is paid and the first "
     "flight has not left ('before departure', 'I haven't flown yet'). AFTER_FIRST_FLIGHT when the traveler has taken "
     "the first flight of the trip ('after my first flight', 'partway through the trip'). AFTER_MISSED_FLIGHT when "
     "the traveler missed a flight ('I missed my flight', 'no-show', 'after a missed flight')."),
    ("changeAllowed", "BOOL",
     "Whether Verified Airline allows the traveler to change the flight in this situation. Set it only when the "
     "answer says outright that a change is allowed ('yes, you can change') or not allowed ('changes are not "
     "allowed'). Do not set it from a fee or an amount to pay alone."),
    ("changeFeeUsd", "NUMBER",
     "The change fee in US dollars that Verified Airline charges for an allowed change, not counting any difference "
     "in fare between the old and the new flight. 0 when the answer says there is no change fee or that the traveler "
     "pays only the fare difference."),
    ("cancellationRefundUsd", "NUMBER",
     "The amount in US dollars that Verified Airline gives back when the traveler cancels the booking, when the "
     "answer states it as a dollar amount ('$150 back'), or 0 when it says nothing comes back. When the answer says "
     "'the full price', set refundIsFullPrice instead and leave this unset."),
    ("refundIsFullPrice", "BOOL",
     "Whether cancelling gives back the full price the traveler paid for the fare. True when the answer says 'full "
     "refund', 'the full price back' or 'all your money back'. False when the answer names a smaller amount or "
     "says nothing comes back."),
    ("paidUsd", "NUMBER", "The price in US dollars the traveler paid for the fare they booked."),
    ("newFareUsd", "NUMBER", "The price in US dollars of the new flight the traveler wants to change to."),
    ("fareDifferenceUsd", "NUMBER",
     "The difference in fare in US dollars on a change: the new flight's price minus the price the traveler paid. "
     "Set it only when a dollar amount is stated for it, such as 'the $60 difference in fare'. Leave it unset for "
     "'plus any difference in fare' or 'only the fare difference', which name no amount."),
    ("amountDueUsd", "NUMBER",
     "The total in US dollars the traveler pays Verified Airline to make a change: the change fee plus the difference "
     "in fare when the new flight costs more than what was paid."),
    ("paymentUsd", "NUMBER", "The amount in US dollars of one payment the traveler made to Verified Airline."),
    ("refundRequestUsd", "NUMBER",
     "The amount in US dollars of one refund the traveler asks for against that one payment."),
    ("refundAccepted", "BOOL", "Whether Verified Airline accepts that one refund against that one payment."),
]


def usd(m):
    """Whole dollars from a facts.json amount, which is in cents."""
    if m["currency"] != "USD" or m["cents"] % 100:
        sys.exit(f"export_chat: expected whole US dollars, found {m!r}")
    return m["cents"] // 100


def term_rules(facts):
    """One rule, one map entry and two checks for each fare, request and stage."""
    rules, meaning, checks = [], {}, []
    for key in facts.get("fareOrder", FARES):
        fare = facts["fares"][key]
        value, code, name = FARES[key]
        for action, (rcode, requirements) in REQUESTS.items():
            for stage_key, (stage, scode, when, situation) in STAGES.items():
                t = fare[action][stage_key]
                rid = f"R{code}{rcode}{scode}".ljust(12, "0")
                cond = f"(and (= fare {value}) (= tripStage {stage}))"
                if action == "change":
                    question = f"I booked the {name} fare. {situation} Can I change to a different flight, and is there a fee?"
                    if t["decision"] == "refused":
                        then = "(not changeAllowed)"
                        statement = f"On {name}, a change {when} is not allowed."
                        right = f"No. The {name} fare does not allow a change {when}."
                        wrong = f"Yes. On the {name} fare a change {when} is allowed for a $75 change fee."
                    else:
                        fee = usd(t["fee"])
                        then = f"(and changeAllowed (= changeFeeUsd {fee}))"
                        if fee:
                            statement = f"On {name}, a change {when} is allowed for a ${fee} fee plus any fare difference."
                            right = (f"Yes. On the {name} fare a change {when} is allowed for a ${fee} change fee, "
                                     "plus any difference in fare.")
                            wrong = f"Yes. On the {name} fare a change {when} is allowed with no change fee."
                        else:
                            statement = f"On {name}, a change {when} is allowed with no change fee."
                            right = (f"Yes. On the {name} fare a change {when} is allowed with no change fee; "
                                     "you pay only any difference in fare.")
                            wrong = f"No. The {name} fare does not allow a change {when}."
                else:
                    question = f"I booked the {name} fare. {situation} If I cancel my booking, what do I get back?"
                    kind = t["kind"]
                    if kind == "full":
                        then = "(and refundIsFullPrice (= cancellationRefundUsd paidUsd))"
                        statement = f"On {name}, cancelling {when} returns the full price paid."
                        right = "You get back the full price you paid."
                        wrong = "You get nothing back."
                    else:
                        amount = usd(t["refund"])
                        if kind == "nothing" and amount:
                            sys.exit(f"export_chat: {t['rule']} returns nothing but names {amount}")
                        then = f"(and (= cancellationRefundUsd {amount}) (not refundIsFullPrice))"
                        if amount:
                            statement = f"On {name}, cancelling {when} returns ${amount}."
                            right = f"You get ${amount} back."
                        else:
                            statement = f"On {name}, cancelling {when} returns nothing."
                            right = "You get nothing back."
                        wrong = "You get back the full price you paid."
                rules.append({"id": rid, "expression": f"(=> {cond} {then})"})
                meaning[rid] = {"lean": t["rule"], "requirements": requirements, "statement": statement}
                checks.append({"name": f"{t['rule']} right", "rule": rid, "question": question, "answer": right,
                               "expect": "VALID"})
                checks.append({"name": f"{t['rule']} wrong", "rule": rid, "question": question, "answer": wrong,
                               "expect": "INVALID"})
    return rules, meaning, checks


def general_rules(facts, model):
    """The amount due on a change, from the worked example, and the refund limit."""
    ex = facts["examples"]["mainChange"]
    old, new, fee, pay = usd(ex["oldPrice"]), usd(ex["newPrice"]), usd(ex["fee"]), usd(ex["youPay"])
    if pay != new - old + fee:
        sys.exit("export_chat: the Main change example does not net to the fare difference plus the fee")
    name = FARES[ex["fare"]][2]
    rules = [
        # ONE-202 when the new flight costs at least what was paid; when it
        # costs less, the model's readings of an excess penalty differ.
        {"id": "RFAREDIFFERN", "expression": "(= fareDifferenceUsd (- newFareUsd paidUsd))"},
        {"id": "RDUEONCHANGE", "expression":
            "(=> (and changeAllowed (>= fareDifferenceUsd 0)) "
            "(= amountDueUsd (+ fareDifferenceUsd changeFeeUsd)))"},
        {"id": "RREFUNDOVER0", "expression": "(=> (> refundRequestUsd paymentUsd) (not refundAccepted))"},
        {"id": "RREFUNDWITHN", "expression": "(=> (<= refundRequestUsd paymentUsd) refundAccepted)"},
    ]
    meaning = {
        "RFAREDIFFERN": {"lean": model["requirements"]["ONE-201"]["name"], "requirements": ["ONE-201"],
                         "definition": True,
                         "statement": "The fare difference is the new flight's price minus the price paid."},
        "RDUEONCHANGE": {"lean": model["requirements"]["ONE-202"]["name"], "requirements": ["ONE-201", "ONE-202"],
                         "statement": "A change costs the fee plus the fare difference when the new flight costs more."},
        "RREFUNDOVER0": {"lean": model["requirements"]["OO-003"]["name"], "requirements": ["OO-003"],
                         "statement": "A refund larger than its payment is refused."},
        "RREFUNDWITHN": {"lean": model["requirements"]["OO-003"]["name"], "requirements": ["OO-003"],
                         "statement": "A refund no larger than its payment is accepted."},
    }
    q_change = (f"I paid ${old} for the {name} fare, and before departure I want to move to a flight that costs "
                f"${new}. What do I pay?")
    q_over = "I made one payment of $100. Can I get a refund of $120 against it?"
    q_twice = "I made one payment of $100. Can I get two separate refunds of $60 against it, $120 in total?"
    checks = [
        {"name": "Main change example right", "rule": "RDUEONCHANGE", "question": q_change,
         "answer": f"You pay ${pay}: the ${new - old} difference in fare plus the ${fee} change fee.", "expect": "VALID"},
        {"name": "Main change example wrong", "rule": "RDUEONCHANGE", "question": q_change,
         "answer": f"You pay ${new - old}, the difference in fare.", "expect": "INVALID"},
        {"name": "Refund over its payment right", "rule": "RREFUNDOVER0", "question": q_over,
         "answer": "No. A refund cannot be more than the payment it is made against.", "expect": "VALID"},
        {"name": "Refund over its payment wrong", "rule": "RREFUNDOVER0", "question": q_over,
         "answer": "Yes. A $120 refund against your $100 payment is accepted.", "expect": "INVALID"},
        {"name": "Two refunds, each within the payment", "rule": None, "question": q_twice,
         "answer": "Yes. Each $60 refund is within your $100 payment, so both are accepted.", "expect": "explore"},
        {"name": "Two refunds, capped in total", "rule": None, "question": q_twice,
         "answer": "No. Refunds against one payment cannot add up to more than the payment.", "expect": "explore"},
    ]
    return rules, meaning, checks


def axioms(facts):
    """What the model's types say about amounts, as rules that always hold.
    Without them a full refund could be a refund of nothing, for a fare that
    cost nothing."""
    if not all(f["price"]["cents"] > 0 for f in facts["fares"].values()):
        sys.exit("export_chat: a fare's price is not positive, so the policy cannot assume one is")
    rules = [
        {"id": "RNONNEGATIVE", "expression":
            "(and (>= changeFeeUsd 0) (>= cancellationRefundUsd 0) (>= newFareUsd 0) (>= amountDueUsd 0) "
            "(>= paymentUsd 0) (>= refundRequestUsd 0))"},
        {"id": "RPAIDPOSITIV", "expression": "(> paidUsd 0)"},
    ]
    meaning = {
        "RNONNEGATIVE": {"lean": "Rules.Core.Money", "requirements": [], "axiom": True,
                         "statement": "An amount of money is never negative."},
        "RPAIDPOSITIV": {"lean": "Airline.Fares", "requirements": [], "axiom": True,
                         "statement": "Every fare has a positive price."},
    }
    return rules, meaning


def policy(facts, model):
    rules, meaning, checks = term_rules(facts)
    more_rules, more_meaning, more_checks = general_rules(facts, model)
    rules += more_rules
    meaning.update(more_meaning)
    checks += more_checks
    axiom_rules, axiom_meaning = axioms(facts)
    rules += axiom_rules
    meaning.update(axiom_meaning)
    definition = {
        "version": "1.0",
        "types": TYPES,
        "variables": [{"name": n, "type": t, "description": d} for n, t, d in VARIABLES],
        "rules": rules,
    }
    check_definition(definition)
    return definition, meaning, checks


def check_definition(d):
    """The limits Bedrock documents for a definition, checked before a deploy finds them."""
    import re
    names = [t["name"] for t in d["types"]] + [v["value"] for t in d["types"] for v in t["values"]]
    names += [v["name"] for v in d["variables"]]
    if len(names) != len(set(names)):
        sys.exit("export_chat: type names, type values and variable names must all differ")
    for r in d["rules"]:
        if not re.fullmatch(r"[A-Z][0-9A-Z]{11}", r["id"]):
            sys.exit(f"export_chat: rule ID {r['id']!r} does not match [A-Z][0-9A-Z]{{11}}")
        if len(r["expression"]) > 2048:
            sys.exit(f"export_chat: rule {r['id']} is longer than 2,048 characters")
    if len({r["id"] for r in d["rules"]}) != len(d["rules"]):
        sys.exit("export_chat: two rules share an ID")
    for v in d["variables"]:
        if len(v["name"]) > 64 or len(v["description"]) > 1024:
            sys.exit(f"export_chat: variable {v['name']} is too long")
    if len(d["rules"]) > 500 or len(d["variables"]) > 200 or len(d["types"]) > 50:
        sys.exit("export_chat: the definition exceeds Bedrock's quotas")


# Knowledge base ---------------------------------------------------------

KB_REQUIREMENTS = ["ONE-201", "ONE-202", "ONE-203", "ONE-503", "ONE-504", "ONE-505", "OO-003"]


class PageText(HTMLParser):
    """A rendered page as Markdown, as a traveler reads it with the Lean model
    hidden: headings, paragraphs, lists and the fare table, without markers,
    popovers, buttons, the search form or navigation."""

    VOID = render_airline.VisibleText.VOID
    SKIP = {"script", "style", "button", "form", "nav"}
    BLOCKS = {"h1": "# ", "h2": "## ", "h3": "### ", "p": "", "li": "- ", "tr": "| ", "div": ""}

    def __init__(self):
        super().__init__()
        self.hidden, self.lines, self.line = [], [], []

    def flush(self):
        text = re.sub(r"\s+", " ", "".join(self.line)).strip()
        if text and text not in ("|", "- |"):
            self.lines.append(text)
        self.line = []

    def handle_starttag(self, tag, attrs):
        if tag in self.VOID:
            return
        hide = tag in self.SKIP or "data-lean" in dict(attrs) or (self.hidden and self.hidden[-1])
        self.hidden.append(bool(hide))
        if not hide and tag in self.BLOCKS:
            self.flush()
            self.line.append(self.BLOCKS[tag])

    def handle_endtag(self, tag):
        if tag in self.VOID or not self.hidden:
            return
        hidden = self.hidden.pop()
        if hidden:
            return
        if tag in ("td", "th"):
            self.line.append(" | ")
        elif tag == "span":
            self.line.append(" ")
        elif tag in self.BLOCKS:
            self.flush()

    def handle_data(self, data):
        if not (self.hidden and self.hidden[-1]):
            self.line.append(data)

    def markdown(self):
        self.flush()
        out = []
        for line in self.lines:
            if line.startswith("#") and out:
                out.append("")
            out.append(line)
            if line.startswith("#"):
                out.append("")
        return "\n".join(out).strip() + "\n"


def provenance(source):
    commit = (source.get("commit") or "")[:7] or "an uncommitted build"
    return (f"Source: the Verified Air Lean model at commit {commit} ({source.get('repository')}). "
            "Written by scripts/export_chat.py; do not edit by hand.")


def fare_documents(facts, source):
    docs = {}
    for key in facts.get("fareOrder", FARES):
        fare = facts["fares"][key]
        _, _, name = FARES[key]
        lines = [f"# The {name} fare", "", provenance(source), "",
                 f"The {name} fare costs ${usd(fare['price'])} on the sample trip in the worked examples.", ""]
        for action, title in (("change", "Changing a flight"), ("cancel", "Cancelling a booking")):
            lines += [f"## {title} on the {name} fare", ""]
            for stage_key, (_, _, when, _) in STAGES.items():
                t = fare[action][stage_key]
                req = ", ".join(REQUESTS[action][1])
                if action == "change":
                    if t["decision"] == "refused":
                        what = "a change is not allowed"
                    elif usd(t["fee"]):
                        what = f"a change is allowed for a ${usd(t['fee'])} change fee plus any difference in fare"
                    else:
                        what = "a change is allowed with no change fee; the traveler pays only any difference in fare"
                else:
                    if t["kind"] == "full":
                        what = "cancelling gives back the full price paid"
                    elif usd(t["refund"]):
                        what = f"cancelling gives back ${usd(t['refund'])}"
                    else:
                        what = "cancelling gives back nothing"
                lines.append(f"- {when[0].upper() + when[1:]}: {what}. (Rule {t['rule']}; requirements {req}.)")
            lines.append("")
        docs[f"fares/{key}.md"] = "\n".join(lines)
    return docs


def example_document(facts, source):
    ex = facts["examples"]
    c = ex["mainChange"]
    old, new, fee, pay = usd(c["oldPrice"]), usd(c["newPrice"]), usd(c["fee"]), usd(c["youPay"])
    lines = ["# Worked examples of changes and cancellations", "", provenance(source), "",
             "## Changing a Main fare before departure", "",
             f"A traveler paid ${old} for a Main fare and changes, before departure, to a flight that costs ${new}. "
             f"The difference in fare is ${new - old} and the Main change fee is ${fee}, so the traveler pays ${pay}. "
             "(Requirements ONE-201, ONE-202, ONE-504.)", ""]
    for key, label in (("mainCancel", "Main"), ("flexCancel", "Flex"), ("basicCancel", "Basic")):
        e = ex[key]
        refund = usd(e["refund"])
        got = f"gets ${refund} back" if refund else "gets nothing back"
        lines += [f"## Cancelling a {label} fare before departure", "",
                  f"A traveler who paid ${usd(e['price'])} for a {label} fare and cancels before departure {got}. "
                  "(Requirement ONE-505.)", ""]
    return {"examples.md": "\n".join(lines)}


def page_documents(facts, model, source):
    pages = {p.stem: render_airline.parse(p) for p in sorted(render_airline.CONTENT.glob("*.md"))}
    r = render_airline.Renderer(pages, facts, render_airline.load_model(model), source, app=True)
    docs = {}
    for slug, page in pages.items():
        if page["meta"].get("kind") != "policy":
            continue
        part = r.policy(slug)
        text = PageText()
        text.feed(part["band"] + part["body"])
        docs[f"policies/{slug}.md"] = text.markdown().replace("\n", f"\n\n{provenance(source)}\n", 1)
    return docs


def requirement_documents(model, source):
    docs = {}
    open_by = model["openQuestions"]
    for rid in KB_REQUIREMENTS:
        r = model["requirements"][rid]
        lines = [f"# Requirement {rid}: {r['name']}", "", provenance(source), "", r["ears"], "",
                 f"Review: {r['review']}", "", "## Criteria", ""]
        for c in r["criteria"]:
            lines.append(f"- {c['id']} ({c['status']}): {c['ears']}")
        questions = [(c["id"], q) for c in r["criteria"] for q in open_by.get(c["id"], [])]
        if questions:
            lines += ["", "## Still being decided", ""]
            for cid, q in questions:
                lines.append(f"- {cid}: {q['question']}")
        docs[f"requirements/{rid}.md"] = "\n".join(lines) + "\n"
    return docs


def knowledge_base(facts, model):
    source = model["source"]
    docs = {}
    docs.update(fare_documents(facts, source))
    docs.update(example_document(facts, source))
    docs.update(page_documents(facts, model, source))
    docs.update(requirement_documents(model, source))
    return docs


def link_theorems(meaning, path, model):
    """Give each fare rule the theorem verified-air proves its fact with,
    matched by the Lean rule's name.  The theorems must come from the same
    commit as model.json; a fare rule with no theorem stops the export."""
    if not path.exists():
        return
    theorems = json.loads(path.read_text())
    if theorems["source"]["commit"] != model["source"].get("commit"):
        sys.exit(f"export_chat: {path} is from {theorems['source']['commit'][:7]}, model.json from "
                 f"{(model['source'].get('commit') or '')[:7]}; run scripts/update-model.sh")
    by_rule = {}
    for key, t in theorems["facts"].items():
        by_rule.setdefault(t["rule"], []).append({"fact": key, "name": t["theorem"], "url": t["url"]})
    for rid, m in meaning.items():
        if m["lean"] in by_rule:
            m["theorems"] = by_rule[m["lean"]]
        elif rid.startswith(("RBAS", "RMAI", "RFLX")):
            sys.exit(f"export_chat: no theorem in {path} proves {m['lean']} ({rid})")


def main():
    ap = argparse.ArgumentParser(description="Write the support chat's files from the Lean model's files.")
    ap.add_argument("--model", type=Path, default=MODEL, help="the directory with facts.json and model.json")
    ap.add_argument("--out", type=Path, default=OUT, help="where to write them")
    args = ap.parse_args()
    facts = json.loads((args.model / "facts.json").read_text())
    model = json.loads((args.model / "model.json").read_text())
    definition, meaning, checks = policy(facts, model)
    link_theorems(meaning, args.model / "theorems.json", model)
    args.out.mkdir(parents=True, exist_ok=True)
    source = {"commit": model["source"].get("commit"), "repository": model["source"].get("repository")}
    (args.out / "ar-policy.json").write_text(json.dumps(definition, indent=1) + "\n")
    (args.out / "ar-rules.json").write_text(json.dumps({"source": source, "rules": meaning}, indent=1) + "\n")
    (args.out / "ar-checks.json").write_text(json.dumps({"source": source, "checks": checks}, indent=1) + "\n")
    kb = args.out / "kb"
    if kb.exists():
        shutil.rmtree(kb)
    docs = knowledge_base(facts, model)
    for name, text in docs.items():
        path = kb / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    commit = (source["commit"] or "")[:7] or "an uncommitted build"
    print(f"wrote {args.out}: a policy of {len(definition['rules'])} rules and {len(definition['variables'])} "
          f"variables, {len(checks)} checks, and {len(docs)} knowledge base documents, from verified-air at {commit}")


if __name__ == "__main__":
    main()
