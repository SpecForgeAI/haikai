"""In-process LRU cache for query results, keyed by snapshot + query signature."""
from collections import OrderedDict
from typing import Any, Hashable


class QueryCache:
    """Minimal LRU cache. Cleared per-snapshot."""

    def __init__(self, max_entries: int = 256):
        self._data: OrderedDict[Hashable, Any] = OrderedDict()
        self._max = max_entries

    def get(self, key: Hashable) -> Any | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key: Hashable, value: Any) -> None:
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = value
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def clear(self) -> None:
        self._data.clear()
