"""scripts/prewarm.py counts a step as failed when its archive search failed (issue #38)."""

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "prewarm.py"
spec = importlib.util.spec_from_file_location("prewarm", SCRIPT)
prewarm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prewarm)


def test_search_failures_count_as_failed_steps():
    assert prewarm.search_failed(["The archive search failed; showing the last saved search result."])
    assert prewarm.search_failed(["Search of spherex_dr1, spherex_qr3 failed: DALServiceError: 502"])
    assert not prewarm.search_failed(["Stacked 150 of 200 matching exposures, spread evenly over time."])
    assert not prewarm.search_failed([])


def test_run_reports_errors_and_search_failures():
    def boom():
        raise RuntimeError("no network")

    assert prewarm.run("ok", lambda: []) is True
    assert prewarm.run("none", lambda: None) is True
    assert prewarm.run("error", boom) is False
    stale = ["The archive search failed; showing the last saved search result."]
    assert prewarm.run("stale", lambda: stale) is False
