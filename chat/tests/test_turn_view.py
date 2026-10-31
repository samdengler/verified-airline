"""What the widget reads of a turn."""

import json

from airline_agent.turn_view import view

RULES = {"RMAICXLMISS0": {"lean": "MAIN-CANCEL-MISSED", "requirements": ["ONE-503"],
                          "statement": "On Main, cancelling after a missed flight returns nothing."}}
REQUIREMENTS = {"ONE-503": {"criteria": [{"status": "proven"}, {"status": "proven"}, {"status": "open"}]}}


def item(**body):
    turn = {"mode": "verified", "state": "withheld", "question": "q", "answer": "You get $150 back.",
            "retrieved": ["a passage"], "provenance": {"leanModelCommit": "1b4d567"},
            "check": {"result": "INVALID", "rulesApplied": ["RMAICXLMISS0"], "untranslated": [], "units": 2, "ms": 900,
                      "findings": [{"kind": "invalid", "rules": ["RMAICXLMISS0"], "premises": [], "claims": []}]}}
    turn.update(body)
    return {"contact": "c", "turn": 2, "at": 1, "body": json.dumps(turn)}


def test_the_passages_and_the_checks_cost_stay_in_the_record():
    v = view(item(), RULES, REQUIREMENTS)
    assert "retrieved" not in json.dumps(v) and "units" not in v["check"]
    assert v["draft"] == "You get $150 back."


def test_each_cited_rule_carries_its_statement_lean_rule_and_criteria():
    rule = view(item(), RULES, REQUIREMENTS)["rules"]["RMAICXLMISS0"]
    assert rule["lean"] == "MAIN-CANCEL-MISSED"
    assert rule["requirements"] == [{"id": "ONE-503", "proven": 2, "total": 3}]


def test_a_knowledge_base_turn_has_no_check_and_no_rules():
    v = view(item(mode="kb", state="not checked", check=None), RULES, REQUIREMENTS)
    assert v["check"] is None and v["rules"] == {}
