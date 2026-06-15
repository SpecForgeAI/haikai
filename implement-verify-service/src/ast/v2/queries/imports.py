"""Query the snapshot's _imports.txt for files importing routing frameworks."""
from dataclasses import dataclass
from pathlib import Path

from .cache import QueryCache


@dataclass
class ImportRow:
    file: str
    package: str
    name: str  # imported symbol if available, '' otherwise


class ImportsQuery:
    """Read and filter _imports.txt rows.

    Snapshot file format (tab-separated):
      # file<TAB>imports<TAB>names
      src/Foo.java<TAB>org.springframework.web.bind.annotation<TAB>GetMapping
    """

    def __init__(self, snapshot_path: str | Path, cache: QueryCache | None = None):
        self._snap = Path(snapshot_path)
        self._cache = cache or QueryCache()
        self._all: list[ImportRow] | None = None

    def _load(self) -> list[ImportRow]:
        if self._all is not None:
            return self._all
        path = self._snap / "_imports.txt"
        rows: list[ImportRow] = []
        if not path.exists():
            self._all = rows
            return rows
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            rows.append(ImportRow(
                file=parts[0],
                package=parts[1],
                name=parts[2] if len(parts) > 2 else "",
            ))
        self._all = rows
        return rows

    def files_importing(self, packages: list[str]) -> set[str]:
        """Set of files that import any of the given packages.

        Match is package-or-subpath, NOT substring:
          'express' matches 'express' and 'express/router'
          'express' does NOT match '@kbn/expressions-plugin' or 'fast-express'
        Substring matches were the source of express false-positives on
        Kibana / TS repos with similarly-named deps.
        """
        key = ("files_importing", tuple(sorted(packages)))
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        result = set()
        for row in self._load():
            for p in packages:
                if (row.package == p
                        or row.package.startswith(p + "/")
                        or row.package.startswith(p + ".")):
                    result.add(row.file)
                    break
        self._cache.put(key, result)
        return result

    def all(self) -> list[ImportRow]:
        return list(self._load())
