#!/usr/bin/env python3
"""The renderer's checks of content/one-id.json, each shown failing on wording
that breaks it, and the renderer running on verified-air's model alone.
`npm test` runs this.  It needs only Python's standard library."""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import render_airline

ROOT = Path(__file__).resolve().parent.parent
ONE_ID = ROOT / "model" / "one-id"


class Tours(unittest.TestCase):
    def pages(self, target):
        section = render_airline.Section("Tours", "tours", [])
        section.blocks = [("fence", "tours", [f"A tour | What it shows | {target}"])]
        return {"index": {"sections": [section]}}

    def test_a_tour_may_start_with_any_traveler_in_the_model(self):
        render_airline.check_tours(self.pages("/gate?lean=1&traveler=two-john-smiths"), ONE_ID)
        render_airline.check_tours(self.pages("@refunds?lean=1"), ONE_ID)

    def test_a_tour_whose_traveler_left_the_model_stops_the_build(self):
        with self.assertRaises(render_airline.BuildError) as caught:
            render_airline.check_tours(self.pages("/gate?traveler=nobody"), ONE_ID)
        self.assertIn("nobody", str(caught.exception))


class Wording(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        self.addCleanup(setattr, render_airline, "CONTENT", render_airline.CONTENT)
        self.words = json.loads((ROOT / "content" / "one-id.json").read_text())
        render_airline.CONTENT = self.dir
        self.model = self.dir / "model"
        shutil.copytree(ONE_ID, self.model)

    def load(self):
        (self.dir / "one-id.json").write_text(json.dumps(self.words))
        return render_airline.load_one_id(self.model)

    def fails(self, *fragments):
        with self.assertRaises(render_airline.BuildError) as caught:
            self.load()
        for fragment in fragments:
            self.assertIn(fragment, str(caught.exception))

    def test_the_wording_as_it_stands_passes(self):
        self.assertIsNotNone(self.load())

    def test_a_traveler_never_reads_the_banned_words(self):
        for word in ("the rule", "a theorem", "this criterion", "these criteria", "OID-101", "OID-101.5", "TRIP-001", "G-01"):
            self.words["traveler"]["gate"]["lede"] = f"This mentions {word} by mistake."
            self.fails("never reads")

    def test_a_traveler_reads_no_typed_amount(self):
        self.words["traveler"]["gate"]["lede"] = "A change costs $75."
        self.fails("types an amount")

    def test_the_lean_wording_may_use_those_words(self):
        self.words["lean"]["legend"]["text"] = "Each criterion of OID-101, by its theorem."
        self.assertIsNotNone(self.load())

    def test_a_requirement_the_model_lacks_stops_the_build(self):
        self.words["lean"]["checks"]["photoid"]["requirements"] = ["OID-999"]
        self.fails("OID-999", "does not have")

    def test_a_criterion_the_model_lacks_stops_the_build(self):
        self.words["lean"]["deciding"]["validity"]["open"] = ["OID-104.99"]
        self.fails("OID-104.99", "does not have")

    def test_a_point_still_being_decided_must_be_open(self):
        self.words["lean"]["deciding"]["validity"]["open"] = ["OID-104.1"]
        self.fails("OID-104.1", "no longer holds a point still being decided")

    def test_proving_an_open_criterion_stops_the_build(self):
        model = json.loads((self.model / "model.json").read_text())
        for criterion in model["requirements"]["OID-104"]["criteria"]:
            if criterion["id"] == "OID-104.5":
                criterion["status"] = "proven"
        (self.model / "model.json").write_text(json.dumps(model))
        self.fails("OID-104.5", "rewrite that wording")

    def test_an_element_the_model_lacks_stops_the_build(self):
        self.words["traveler"]["request"][0]["element"] = "noSuchId"
        self.fails("noSuchId", "does not have")

    def test_a_stand_in_must_still_be_one(self):
        scenarios = json.loads((self.model / "scenarios.json").read_text())
        scenarios["standIns"]["invented"] = False
        (self.model / "scenarios.json").write_text(json.dumps(scenarios))
        self.fails("stand-in")

    def test_settling_a_question_stops_the_build_until_its_wording_goes(self):
        readings = json.loads((self.model / "readings.json").read_text())
        readings["readings"] = [r for r in readings["readings"] if r["id"] != "MatchReading"]
        (self.model / "readings.json").write_text(json.dumps(readings))
        self.fails("MatchReading", "no longer an undecided point")

    def test_it_is_skipped_without_the_model_or_the_wording(self):
        self.assertIsNone(render_airline.load_one_id(self.dir / "no-such-directory"))
        (self.dir / "one-id.json").unlink(missing_ok=True)
        self.assertIsNone(render_airline.load_one_id(self.model))


class VerifiedAirOnly(unittest.TestCase):
    """verified-air's CI gives the renderer its own model and a scratch directory."""

    def test_the_renderer_needs_only_verified_airs_model(self):
        with tempfile.TemporaryDirectory() as d:
            scratch = Path(d)
            (scratch / "m").mkdir()
            for f in ("facts.json", "model.json"):
                shutil.copy(ROOT / "model" / f, scratch / "m" / f)
            script = str(ROOT / "scripts" / "render_airline.py")
            for extra in ([], ["--one-id", str(scratch / "none")]):
                run = subprocess.run([sys.executable, script, "--model", str(scratch / "m"), "--out", str(scratch / "out"), *extra],
                                     capture_output=True, text=True)
                self.assertEqual(run.returncode, 0, run.stderr)


if __name__ == "__main__":
    unittest.main()
