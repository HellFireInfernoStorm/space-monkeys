"""The committed API contract must match the code."""

import json
from pathlib import Path

from app.main import app

CONTRACT = Path(__file__).resolve().parents[2] / "docs" / "openapi.json"


def test_contract_file_is_up_to_date():
    assert CONTRACT.exists(), "Run: python scripts/export_openapi.py"
    committed = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert committed == app.openapi(), (
        "docs/openapi.json is out of date. Run: python scripts/export_openapi.py "
        "and then `npm run gen:api` in frontend/"
    )
