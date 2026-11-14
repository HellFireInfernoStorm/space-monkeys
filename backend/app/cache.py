"""A small two-level cache for live mode: memory in front of files on disk.

Arrays are stored as compressed NumPy files (`.npz`), everything else as JSON. Files are
written to a temporary name first and then renamed, so a crash never leaves half a file.
The folder is `settings.cache_dir` (environment variable `SM_CACHE_DIR`); it is
git-ignored and safe to delete at any time.
"""

import hashlib
import io
import json
import os
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

import numpy as np

MEMORY_ITEMS = 1024


def make_key(*parts: object) -> str:
    """A file-name-safe key from any values."""
    return hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:40]


class Cache:
    def __init__(self, root: Path, memory_items: int = MEMORY_ITEMS):
        self.root = Path(root)
        self._memory: OrderedDict[tuple[str, str], Any] = OrderedDict()
        self._limit = memory_items
        self._lock = threading.Lock()

    # --- memory ---------------------------------------------------------------------

    def _remember(self, kind: str, key: str, value: Any) -> None:
        with self._lock:
            self._memory[(kind, key)] = value
            self._memory.move_to_end((kind, key))
            while len(self._memory) > self._limit:
                self._memory.popitem(last=False)

    def _recall(self, kind: str, key: str) -> Any:
        with self._lock:
            value = self._memory.get((kind, key))
            if value is not None:
                self._memory.move_to_end((kind, key))
            return value

    def clear_memory(self) -> None:
        with self._lock:
            self._memory.clear()

    # --- disk -----------------------------------------------------------------------

    def _path(self, kind: str, key: str, suffix: str) -> Path:
        return self.root / kind / key[:2] / f"{key}{suffix}"

    def _write(self, path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(handle, "wb") as out:
                out.write(data)
            os.replace(temporary, path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise

    def get_arrays(self, kind: str, key: str) -> dict[str, np.ndarray] | None:
        value = self._recall(kind, key)
        if value is not None:
            return value
        path = self._path(kind, key, ".npz")
        try:
            with np.load(path, allow_pickle=False) as data:
                value = {name: data[name] for name in data.files}
        except (OSError, ValueError):
            return None
        self._remember(kind, key, value)
        return value

    def put_arrays(self, kind: str, key: str, arrays: dict[str, np.ndarray]) -> None:
        buffer = io.BytesIO()
        np.savez_compressed(buffer, **arrays)
        self._write(self._path(kind, key, ".npz"), buffer.getvalue())
        self._remember(kind, key, dict(arrays))

    def get_json(self, kind: str, key: str, max_age_s: float | None = None) -> Any:
        """The stored value, or None. With `max_age_s`, older entries count as missing."""
        entry = self._recall(kind, key)
        if entry is None:
            try:
                entry = json.loads(self._path(kind, key, ".json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return None
            self._remember(kind, key, entry)
        if max_age_s is not None and time.time() - entry.get("saved", 0.0) > max_age_s:
            return None
        return entry.get("value")

    def put_json(self, kind: str, key: str, value: Any) -> None:
        entry = {"saved": time.time(), "value": value}
        self._write(self._path(kind, key, ".json"), json.dumps(entry).encode("utf-8"))
        self._remember(kind, key, entry)


_caches: dict[Path, Cache] = {}
_caches_lock = threading.Lock()


def cache_for(root: Path) -> Cache:
    """One shared cache per folder."""
    root = Path(root).resolve()
    with _caches_lock:
        if root not in _caches:
            _caches[root] = Cache(root)
        return _caches[root]
