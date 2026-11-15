"""scripts/prewarm.py counts a step as failed when its archive search failed (issue #38)."""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "prewarm.py"
spec = importlib.util.spec_from_file_location("prewarm", SCRIPT)
prewarm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prewarm)


def test_run_reports_errors_and_search_failures():
    def boom():
        raise RuntimeError("no network")

    assert prewarm.run("ok", lambda: []) is True
    assert prewarm.run("none", lambda: None) is True
    assert prewarm.run("error", boom) is False
    stale = ["The archive search failed; showing the last saved search result."]
    assert prewarm.run("stale", lambda: stale) is False


def test_cooldown_and_nearby_warnings_count_as_failed_steps():
    assert prewarm.run("cooldown", lambda: ["Search of coll_a, coll_b failed: IRSA did not answer"]) is False
    nearby = ["The archive search failed; showing the saved search of a position 1.2 arcmin away."]
    assert prewarm.run("nearby", lambda: nearby) is False
    assert prewarm.run("capped", lambda: ["Stacked 150 of 200 matching exposures."]) is True
