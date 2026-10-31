#!/usr/bin/env python3
"""Write the support chat's knowledge base documents into build/chat/kb/.

  python3 scripts/export_chat.py [--model DIR] [--out DIR]

The documents are Markdown, written from the Lean model's files in model/:
one per fare and the worked examples, from facts.json; the six policy pages
as scripts/render_airline.py writes them, with the Lean model's markers and
popovers left out; and the requirements on fares and refunds, from
model.json.  Each names the verified-air commit it came from.
chat/scripts/sync_kb.py uploads them.

The chat's Automated Reasoning policy is not written here: verified-air
writes it beside facts.json (its scripts/export_airline_policy.py), and
scripts/update-model.sh copies ar-policy.json, ar-rules.json and
ar-checks.json into model/.  It needs only Python's standard library, like
the renderer.
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

FARES = {"basic": "Basic", "main": "Main", "flex": "Flex"}
# The stages a fare's terms name, as facts.json keys them, in the words of
# content/changes.md.
STAGES = {"beforeDeparture": "before departure", "afterDeparture": "after your first flight",
          "noShow": "after a missed flight"}
REQUIREMENTS = {"change": ["ONE-503", "ONE-504"], "cancel": ["ONE-503", "ONE-505"]}


def usd(m):
    """Whole dollars from a facts.json amount, which is in cents."""
    if m["currency"] != "USD" or m["cents"] % 100:
        sys.exit(f"export_chat: expected whole US dollars, found {m!r}")
    return m["cents"] // 100


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
        name = FARES[key]
        lines = [f"# The {name} fare", "", provenance(source), "",
                 f"The {name} fare costs ${usd(fare['price'])} on the sample trip in the worked examples.", ""]
        for action, title in (("change", "Changing a flight"), ("cancel", "Cancelling a booking")):
            lines += [f"## {title} on the {name} fare", ""]
            for stage_key, when in STAGES.items():
                t = fare[action][stage_key]
                req = ", ".join(REQUIREMENTS[action])
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


def main():
    ap = argparse.ArgumentParser(description="Write the support chat's knowledge base from the Lean model's files.")
    ap.add_argument("--model", type=Path, default=MODEL, help="the directory with facts.json and model.json")
    ap.add_argument("--out", type=Path, default=OUT, help="where to write them")
    args = ap.parse_args()
    facts = json.loads((args.model / "facts.json").read_text())
    model = json.loads((args.model / "model.json").read_text())
    kb = args.out / "kb"
    if kb.exists():
        shutil.rmtree(kb)
    docs = knowledge_base(facts, model)
    for name, text in docs.items():
        path = kb / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    commit = (model["source"].get("commit") or "")[:7] or "an uncommitted build"
    print(f"wrote {kb}: {len(docs)} knowledge base documents, from verified-air at {commit}")


if __name__ == "__main__":
    main()
