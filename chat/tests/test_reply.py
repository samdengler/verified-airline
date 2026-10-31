"""The states a turn is shown in, and the text of a withheld answer."""

from airline_agent import reply


def turn(*findings, untranslated=(), mode="verified"):
    return {"mode": mode, "answer": "Nothing comes back.",
            "check": {"findings": list(findings), "untranslated": list(untranslated)}}


VALID = {"kind": "valid", "rules": ["RMAICXLMISS0"]}
VACUOUS = {"kind": "valid", "rules": []}
INVALID = {"kind": "invalid", "rules": ["RMAICXLMISS0"]}
AMBIGUOUS = {"kind": "translationAmbiguous"}


def test_a_contradicted_draft_is_withheld_even_beside_an_ambiguous_finding():
    assert reply.state(turn(AMBIGUOUS, INVALID)) == reply.WITHHELD


def test_verified_needs_a_rule_in_every_finding_and_nothing_untranslated():
    assert reply.state(turn(VALID)) == reply.VERIFIED
    assert reply.state(turn(VALID, VACUOUS)) == reply.NOT_CHECKED
    assert reply.state(turn(VALID, untranslated=["you also get a travel credit"])) == reply.NOT_CHECKED
    assert reply.state(turn()) == reply.NOT_CHECKED


def test_the_knowledge_base_alone_is_never_checked():
    assert reply.state({"mode": "kb", "answer": "x"}) == reply.NOT_CHECKED


def test_a_withheld_answer_says_what_the_fares_say_and_drops_the_draft():
    meaning = {"RMAICXLMISS0": "On Main, cancelling after a missed flight returns nothing."}
    t = turn(INVALID, INVALID)
    t["answer"] = "You get $150 back."
    text = reply.text(t, reply.WITHHELD, meaning)
    assert "$150" not in text
    assert text.endswith("The fares say: On Main, cancelling after a missed flight returns nothing.")
    assert text.count("On Main") == 1


def test_other_states_show_the_draft():
    assert reply.text(turn(VALID), reply.VERIFIED, {}) == "Nothing comes back."
