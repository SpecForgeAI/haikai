"""Query the snapshot's _index.txt for symbols (classes, methods, etc.)."""
import re
from dataclasses import dataclass
from pathlib import Path

from .cache import QueryCache


@dataclass
class IndexRow:
    file: str
    kind: str       # class, method, function, variable, module
    name: str
    scope: str      # parent class for methods, '-' for top-level
    signature: str
    line: int
    flags: str      # e.g. 'extends:Foo'


class IndexQuery:
    """Read and filter _index.txt rows.

    Snapshot file format (tab-separated):
      # file<TAB>kind<TAB>name<TAB>scope<TAB>signature<TAB>line<TAB>flags
    """

    def __init__(self, snapshot_path: str | Path, cache: QueryCache | None = None):
        self._snap = Path(snapshot_path)
        self._cache = cache or QueryCache()
        self._all: list[IndexRow] | None = None

    def _load(self) -> list[IndexRow]:
        if self._all is not None:
            return self._all
        path = self._snap / "_index.txt"
        rows: list[IndexRow] = []
        if not path.exists():
            self._all = rows
            return rows
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 6:
                continue
            try:
                line_no = int(parts[5])
            except ValueError:
                line_no = 0
            rows.append(IndexRow(
                file=parts[0],
                kind=parts[1],
                name=parts[2],
                scope=parts[3] if len(parts) > 3 else "-",
                signature=parts[4] if len(parts) > 4 else "-",
                line=line_no,
                flags=parts[6] if len(parts) > 6 else "-",
            ))
        self._all = rows
        return rows

    def methods_in(self, files: set[str]) -> list[IndexRow]:
        """Methods/functions whose file is in the given set."""
        key = ("methods_in", tuple(sorted(files)))
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        result = [r for r in self._load() if r.kind in ("method", "function") and r.file in files]
        self._cache.put(key, result)
        return result

    def methods_matching(self, files: set[str], name_pattern: str) -> list[IndexRow]:
        """Methods in `files` whose name matches a regex."""
        rx = re.compile(name_pattern)
        return [r for r in self.methods_in(files) if rx.search(r.name)]

    def classes_in(self, files: set[str]) -> list[IndexRow]:
        """Class declarations whose file is in the given set."""
        return [r for r in self._load() if r.kind == "class" and r.file in files]

    def all(self) -> list[IndexRow]:
        return list(self._load())
