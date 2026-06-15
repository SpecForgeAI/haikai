"""AstIndex — mechanical read surface over a structural store snapshot (D9).

The snapshot is the existing FileStore layout
(.specforge/structural/{repo}/{sha}/ with _index.txt / _calls.txt / _meta.yaml).
This module adds the two capabilities the pipeline checks need:

- ``has(file, line)``    — ground-truth location check (post_check, final_gate)
- ``query(...)``         — mechanical node filters ONLY (D1): node_kinds,
                           name_regex, file_glob, has_decorator. Semantic
                           values (endpoint/route/handler/...) are rejected.

Designed for grep, not SQL — flat TSV reads, no database.
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass
from pathlib import Path

# Semantic concepts that MUST NOT appear as filter values (D1 guard).
# Framework interpretation lives in the LLM, never in this layer.
FORBIDDEN_FILTER_VALUES = frozenset(
    {
        "endpoint",
        "endpoints",
        "route",
        "routes",
        "handler",
        "handlers",
        "controller",
        "controllers",
        "query",
        "queries",
        "data_movement",
        "data_movements",
        "interaction",
        "interactions",
    }
)


class SemanticFilterError(ValueError):
    """Raised when a filter value names a semantic concept instead of a node kind."""


@dataclass
class SymbolRow:
    file: str
    kind: str
    name: str
    scope: str
    signature: str
    line_start: int
    line_end: int
    flags: str


@dataclass
class CallRow:
    caller_file: str
    caller: str
    callee_file: str
    callee: str
    line: int
    confidence: float


def _norm(path: str) -> str:
    """Normalise separators and strip a leading './' PREFIX (not a charset —
    lstrip('./') would corrupt dot-prefixed paths like '.github/wf.yml')."""
    out = path.replace("\\", "/")
    while out.startswith("./"):
        out = out[2:]
    return out


class AstIndex:
    """Read-only view over one snapshot directory."""

    def __init__(self, snapshot_path: str | Path) -> None:
        self.snapshot_path = Path(snapshot_path)
        self._symbols: list[SymbolRow] | None = None
        self._calls: list[CallRow] | None = None

    # -- loading ---------------------------------------------------------

    def exists(self) -> bool:
        return (self.snapshot_path / "_index.txt").exists()

    @property
    def symbols(self) -> list[SymbolRow]:
        if self._symbols is None:
            self._symbols = self._load_symbols()
        return self._symbols

    @property
    def calls(self) -> list[CallRow]:
        if self._calls is None:
            self._calls = self._load_calls()
        return self._calls

    def _load_symbols(self) -> list[SymbolRow]:
        rows: list[SymbolRow] = []
        path = self.snapshot_path / "_index.txt"
        if not path.exists():
            return rows
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) < 7:
                continue
            try:
                line_no = int(cols[5])
            except ValueError:
                continue
            # _index.txt stores line_start; line_end is not a column, so a
            # symbol's range is approximated as its start line only. has()
            # therefore matches symbol start lines and call lines exactly.
            rows.append(
                SymbolRow(
                    file=_norm(cols[0]),
                    kind=cols[1],
                    name=cols[2],
                    scope=cols[3],
                    signature=cols[4],
                    line_start=line_no,
                    line_end=line_no,
                    flags=cols[6] if len(cols) > 6 else "-",
                )
            )
        return rows

    def _load_calls(self) -> list[CallRow]:
        rows: list[CallRow] = []
        path = self.snapshot_path / "_calls.txt"
        if not path.exists():
            return rows
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) < 6:
                continue
            try:
                line_no = int(cols[4])
                conf = float(cols[5])
            except ValueError:
                continue
            rows.append(
                CallRow(
                    caller_file=_norm(cols[0]),
                    caller=cols[1],
                    callee_file=_norm(cols[2]),
                    callee=cols[3],
                    line=line_no,
                    confidence=conf,
                )
            )
        return rows

    # -- ground truth ----------------------------------------------------

    def has(self, file: str, line: int) -> bool:
        """True iff (file, line) anchors a known symbol or call site.

        This is the post_check / final_gate ground-truth round-trip:
        a record whose location is not in the index is a hallucination.
        """
        f = _norm(file)
        for sym in self.symbols:
            if sym.file == f and sym.line_start == line:
                return True
        for call in self.calls:
            if call.caller_file == f and call.line == line:
                return True
        return False

    def symbol_at(self, file: str, line: int) -> SymbolRow | None:
        """The symbol whose start line is exactly (file, line), if any.

        Record-level grounding (C1): for endpoints the symbol at the anchor
        must BE the claimed handler — location-only has() let fabricated
        semantics ride on any real anchor.
        """
        f = _norm(file)
        for sym in self.symbols:
            if sym.file == f and sym.line_start == line:
                return sym
        return None

    def files(self) -> set[str]:
        out = {s.file for s in self.symbols}
        out.update(c.caller_file for c in self.calls)
        return out

    def candidate_count(self, file: str) -> int:
        """Symbols + calls rows for one file (D13 batch sizing)."""
        f = _norm(file)
        return sum(1 for s in self.symbols if s.file == f) + sum(
            1 for c in self.calls if c.caller_file == f
        )

    # -- mechanical query (D1) --------------------------------------------

    def query(
        self,
        node_kinds: list[str] | None = None,
        name_regex: str | None = None,
        file_glob: str | None = None,
        has_decorator: bool | str | None = None,
    ) -> list[dict]:
        """Mechanical symbol filter. Rejects semantic filter values (D1).

        has_decorator: True/False = any decorator present/absent;
        a STRING is a regex over decorator NAMES (the LLM supplies the
        framework pattern, e.g. "(Get|Post).*Mapping" — this layer just
        matches it). Names come from the store's "decorated:Name1|Name2" flag;
        old snapshots with a bare "decorated" flag degrade to boolean.
        """
        for value in node_kinds or []:
            if value.lower() in FORBIDDEN_FILTER_VALUES:
                raise SemanticFilterError(
                    f"'{value}' is a semantic concept, not a node kind — "
                    "framework interpretation belongs to the agent layer (D1)"
                )
        pattern = re.compile(name_regex) if name_regex else None
        out: list[dict] = []
        for sym in self.symbols:
            if node_kinds and sym.kind not in node_kinds:
                continue
            if pattern and not pattern.search(sym.name):
                continue
            if file_glob and not fnmatch.fnmatch(sym.file, file_glob):
                continue
            if has_decorator is not None:
                # The store writes "decorated" or "decorated:Name1|Name2" (P1d/#4)
                # — flags also carry async/abstract/extends:, so non-empty != decorated.
                deco_flag = next(
                    (f for f in sym.flags.split(",") if f == "decorated" or f.startswith("decorated:")),
                    None,
                )
                if isinstance(has_decorator, str):
                    if deco_flag is None or ":" not in deco_flag:
                        continue  # no names recorded — can't match a name pattern
                    names = deco_flag.split(":", 1)[1].split("|")
                    pat = re.compile(has_decorator)
                    if not any(pat.search(n) for n in names):
                        continue
                else:
                    if (deco_flag is not None) != has_decorator:
                        continue
            out.append(
                {
                    "file": sym.file,
                    "kind": sym.kind,
                    "name": sym.name,
                    "scope": sym.scope,
                    "signature": sym.signature,
                    "line": sym.line_start,
                    "flags": sym.flags,
                }
            )
        return out
