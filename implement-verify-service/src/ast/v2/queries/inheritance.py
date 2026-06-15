"""Query the snapshot's _inheritance.txt for class hierarchies."""
from dataclasses import dataclass
from pathlib import Path

from .cache import QueryCache


@dataclass
class InheritanceEdge:
    child: str
    rel: str       # extends, implements, includes, uses, with
    parent: str
    file: str


class InheritanceQuery:
    """Read and filter _inheritance.txt rows.

    Snapshot file format (tab-separated):
      # child<TAB>rel<TAB>parent<TAB>file
    """

    def __init__(self, snapshot_path: str | Path, cache: QueryCache | None = None):
        self._snap = Path(snapshot_path)
        self._cache = cache or QueryCache()
        self._all: list[InheritanceEdge] | None = None

    def _load(self) -> list[InheritanceEdge]:
        if self._all is not None:
            return self._all
        path = self._snap / "_inheritance.txt"
        rows: list[InheritanceEdge] = []
        if not path.exists():
            self._all = rows
            return rows
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 4:
                continue
            rows.append(InheritanceEdge(
                child=parts[0],
                rel=parts[1],
                parent=parts[2],
                file=parts[3],
            ))
        self._all = rows
        return rows

    def subclasses_of(self, parent_substrings: list[str]) -> list[InheritanceEdge]:
        """Edges where the parent contains any of the given substrings (e.g. 'Controller')."""
        key = ("subclasses_of", tuple(sorted(parent_substrings)))
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        result = [
            r for r in self._load()
            if any(p in r.parent for p in parent_substrings)
        ]
        self._cache.put(key, result)
        return result

    def all(self) -> list[InheritanceEdge]:
        return list(self._load())
