"""Create or update the GitHub issue labels listed in .github/labels.json.

Run from anywhere inside the repository, after the GitHub repository exists and
the GitHub command-line tool is signed in (`gh auth status`):

    python scripts/sync_labels.py

It only adds and updates labels. It never deletes one.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

LABELS_FILE = Path(__file__).resolve().parent.parent / ".github" / "labels.json"


def main() -> int:
    if shutil.which("gh") is None:
        print("The GitHub command-line tool (gh) is not installed. See https://cli.github.com")
        return 1

    labels = json.loads(LABELS_FILE.read_text(encoding="utf-8"))
    failed = 0
    for label in labels:
        result = subprocess.run(
            [
                "gh", "label", "create", label["name"],
                "--color", label["color"],
                "--description", label["description"],
                "--force",
            ],
            cwd=LABELS_FILE.parent.parent,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            print(f"ok      {label['name']}")
        else:
            failed += 1
            print(f"FAILED  {label['name']}: {result.stderr.strip()}")

    if failed:
        print(f"{failed} of {len(labels)} labels could not be written.")
        return 1
    print(f"All {len(labels)} labels are in place.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
