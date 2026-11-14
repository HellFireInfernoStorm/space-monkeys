"""Cutting a long list down to a cap without losing its spread in time."""

from typing import TypeVar

import numpy as np

T = TypeVar("T")


def sample_evenly(items: list[T], cap: int) -> list[T]:
    """At most `cap` items, evenly spaced through the list, always keeping the first and last."""
    if cap <= 0:
        return []
    if len(items) <= cap:
        return list(items)
    if cap == 1:
        return [items[len(items) // 2]]
    picks = np.unique(np.linspace(0, len(items) - 1, cap).round().astype(int))
    return [items[int(i)] for i in picks]
