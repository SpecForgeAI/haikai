"""Impact analysis (blast radius).

Given a symbol X, compute:
  - direct + transitive callers      (reverse traversal — the headline signal)
  - direct + transitive callees      (forward traversal)
  - subclass methods                  (when X is a class, fold in subclasses)
  - endpoints whose handler chain transitively reaches X

All operations are SQL-driven; no LLM.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from src.dep.db import DepGraph

DEFAULT_DEPTH = 5


@dataclass
class CallerRef:
    qualified_name: str
    file: str = ""
    line: Optional[int] = None
    confidence: float = 1.0
    depth: int = 1   # how many hops away from the seed


@dataclass
class EndpointRef:
    operation: str
    path: str
    framework: str = ""
    handler_qualified_name: str = ""


@dataclass
class ImpactReport:
    symbol: str                              # the resolved symbol qualified_name
    seed: str                                # what the user asked for
    direct_callers: list[CallerRef] = field(default_factory=list)
    transitive_callers: list[CallerRef] = field(default_factory=list)
    direct_callees: list[CallerRef] = field(default_factory=list)
    transitive_callees: list[CallerRef] = field(default_factory=list)
    subclass_methods: list[str] = field(default_factory=list)
    affected_endpoints: list[EndpointRef] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def total_callers(self) -> int:
        return len(self.direct_callers) + len(self.transitive_callers)

    def summary(self) -> str:
        ne = len(self.affected_endpoints)
        nc = self.total_callers
        return (f"{self.symbol}: {nc} caller(s) reach this symbol; "
                f"{ne} endpoint(s) affected")


# ─── public API ───────────────────────────────────────────────────────────

def impact_of(graph: DepGraph, symbol: str,
              depth: int = DEFAULT_DEPTH,
              include_endpoints: bool = True) -> ImpactReport:
    """Top-level wrapper. Resolves `symbol` (qname or bare name) and runs all
    analyses, returning a unified ImpactReport."""
    matches = graph.find_symbol(symbol)
    if not matches:
        return ImpactReport(
            symbol=symbol, seed=symbol,
            notes=[f"symbol not found: {symbol!r}"],
        )

    # If the bare name matched multiple symbols, pick the one with the most
    # callers (likely the meaningful one); record the choice in notes.
    chosen = _pick_most_referenced(graph, matches)
    qname = chosen["qualified_name"]
    report = ImpactReport(symbol=qname, seed=symbol)
    if len(matches) > 1:
        report.notes.append(
            f"{len(matches)} symbols matched {symbol!r}; chose {qname!r} (most referenced)"
        )

    # Forward / reverse callers (BFS)
    report.direct_callers, report.transitive_callers = _bfs_callers(
        graph, qname, depth)
    report.direct_callees, report.transitive_callees = _bfs_callees(
        graph, qname, depth)

    # Subclass methods (only if symbol is a class)
    if chosen["kind"] == "class":
        report.subclass_methods = _subclass_methods(graph, qname)

    # Affected endpoints
    if include_endpoints:
        report.affected_endpoints = _affected_endpoints(
            graph, qname, depth)

    if not report.direct_callers and not report.affected_endpoints:
        report.notes.append("no callers or endpoint flows reach this symbol")

    return report


# ─── traversal helpers ───────────────────────────────────────────────────

def _bfs_callers(graph: DepGraph, qname: str,
                  depth: int) -> tuple[list[CallerRef], list[CallerRef]]:
    """BFS reverse direction: who calls qname, transitively up to `depth` hops."""
    seen: set[str] = {qname}
    direct: list[CallerRef] = []
    transitive: list[CallerRef] = []
    frontier = {qname}

    for hop in range(1, depth + 1):
        if not frontier:
            break
        rows = _callers_of(graph, frontier)
        next_frontier: set[str] = set()
        for r in rows:
            caller_qname = r["caller_qname"]
            if not caller_qname or caller_qname in seen:
                continue
            seen.add(caller_qname)
            ref = CallerRef(
                qualified_name=caller_qname,
                file=r["file"] or "",
                line=r["line"],
                confidence=r["confidence"] or 1.0,
                depth=hop,
            )
            (direct if hop == 1 else transitive).append(ref)
            next_frontier.add(caller_qname)
        frontier = next_frontier
    return direct, transitive


def _bfs_callees(graph: DepGraph, qname: str,
                  depth: int) -> tuple[list[CallerRef], list[CallerRef]]:
    """BFS forward direction: what does qname call, transitively."""
    seen: set[str] = {qname}
    direct: list[CallerRef] = []
    transitive: list[CallerRef] = []
    frontier = {qname}

    for hop in range(1, depth + 1):
        if not frontier:
            break
        rows = _callees_of(graph, frontier)
        next_frontier: set[str] = set()
        for r in rows:
            callee_qname = r["callee_qname"]
            if not callee_qname or callee_qname in seen:
                continue
            seen.add(callee_qname)
            ref = CallerRef(
                qualified_name=callee_qname,
                file="",
                line=None,
                confidence=r["confidence"] or 1.0,
                depth=hop,
            )
            (direct if hop == 1 else transitive).append(ref)
            next_frontier.add(callee_qname)
        frontier = next_frontier
    return direct, transitive


def _callers_of(graph: DepGraph, callee_qnames: set[str]) -> list:
    """Single SQL hop: rows whose callee_qualified_name ∈ callee_qnames."""
    if not callee_qnames:
        return []
    placeholders = ",".join("?" * len(callee_qnames))
    sql = f"""
        SELECT
          s.qualified_name AS caller_qname,
          f.path           AS file,
          c.confidence,
          NULL             AS line
        FROM calls c
        LEFT JOIN symbols s ON c.caller_symbol_id = s.id
        LEFT JOIN files f   ON c.file_id = f.id
        WHERE c.callee_qualified_name IN ({placeholders})
    """
    return graph.query(sql, list(callee_qnames))


def _callees_of(graph: DepGraph, caller_qnames: set[str]) -> list:
    """Single SQL hop: rows whose caller's qname ∈ caller_qnames."""
    if not caller_qnames:
        return []
    placeholders = ",".join("?" * len(caller_qnames))
    sql = f"""
        SELECT
          c.callee_qualified_name AS callee_qname,
          c.confidence
        FROM calls c
        JOIN symbols s ON c.caller_symbol_id = s.id
        WHERE s.qualified_name IN ({placeholders})
    """
    return graph.query(sql, list(caller_qnames))


def _subclass_methods(graph: DepGraph, parent_qname: str) -> list[str]:
    """All methods declared on classes that inherit from `parent_qname`
    (transitive)."""
    seen_classes: set[str] = {parent_qname}
    methods: list[str] = []
    frontier = {parent_qname}
    while frontier:
        rows = graph.query(
            f"""SELECT s.qualified_name AS child_qname
                FROM inheritance i
                JOIN symbols s ON i.child_symbol_id = s.id
                WHERE i.parent_qualified_name IN ({",".join("?" * len(frontier))})""",
            list(frontier),
        )
        next_frontier: set[str] = set()
        for r in rows:
            cq = r["child_qname"]
            if cq in seen_classes:
                continue
            seen_classes.add(cq)
            next_frontier.add(cq)
            # Pull methods of this class
            for m in graph.query(
                """SELECT qualified_name FROM symbols
                   WHERE qualified_name LIKE ? AND kind = 'method'""",
                (f"{cq}.%",),
            ):
                methods.append(m["qualified_name"])
        frontier = next_frontier
    return methods


def _affected_endpoints(graph: DepGraph, qname: str,
                         depth: int) -> list[EndpointRef]:
    """Endpoints whose handler reaches `qname` via the call graph (within depth)."""
    # Collect every qname that transitively calls our seed (within depth)
    seen: set[str] = {qname}
    frontier = {qname}
    for _ in range(depth):
        if not frontier:
            break
        rows = _callers_of(graph, frontier)
        new = {r["caller_qname"] for r in rows
                if r["caller_qname"] and r["caller_qname"] not in seen}
        seen |= new
        frontier = new

    # Endpoints whose handler symbol's qname is in `seen`
    if not seen:
        return []
    placeholders = ",".join("?" * len(seen))
    rows = graph.query(
        f"""SELECT e.operation, e.path, e.framework, s.qualified_name AS handler
            FROM endpoints e
            LEFT JOIN symbols s ON e.handler_symbol_id = s.id
            WHERE s.qualified_name IN ({placeholders})""",
        list(seen),
    )
    return [EndpointRef(
        operation=r["operation"], path=r["path"],
        framework=r["framework"] or "",
        handler_qualified_name=r["handler"] or "",
    ) for r in rows]


def _pick_most_referenced(graph: DepGraph, matches: list) -> dict:
    """When a bare name matches several symbols, pick the one with the most
    callers (proxy for 'meaningful' symbol vs. helper / inner)."""
    if len(matches) == 1:
        return dict(matches[0])
    best = matches[0]
    best_n = -1
    for m in matches:
        row = graph.query_one(
            "SELECT COUNT(*) AS c FROM calls WHERE callee_qualified_name = ?",
            (m["qualified_name"],),
        )
        n = row["c"] if row else 0
        if n > best_n:
            best_n = n
            best = m
    return dict(best)
