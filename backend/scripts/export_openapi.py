"""Write the API contract to docs/openapi.json.

Run from the backend folder after changing any route or model:

    python scripts/export_openapi.py

Then run `npm run gen:api` in the frontend folder. A test fails while the file is stale.
"""

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402

TARGET = BACKEND.parent / "docs" / "openapi.json"


def main() -> None:
    text = json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"
    with open(TARGET, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    print(f"Wrote {TARGET}")


if __name__ == "__main__":
    main()
