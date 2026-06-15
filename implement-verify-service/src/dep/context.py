"""360° symbol context.

Given a symbol, gather definition + 1-hop callers/callees + class hierarchy
+ endpoints handled + outbound interactions + relevant imports. Aggregation
only — no traversal beyond 1 hop.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from src.dep.db import DepGraph


@dataclass
class SymbolContext:
    symbol: str
    qualified_name: str = ""
    kind: str = ""
    file: str = ""
    line: Optional[int] = None
    language: str = ""
    direct_callers: list[str] = field(default_factory=list)
    direct_callees: list[str] = field(default_factory=list)
    parents: list[str] = field(default_factory=list)
    children: list[str] = field(default_factory=list)
    endpoints_handled: list[dict] = field(default_factory=list)
    outbound_interactions: list[dict] = field(default_factory=list)
    file_imports: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_markdown(self) -> str:
        out: list[str] = [f"## {self.qualified_name or self.symbol}"]
        if self.kind:
            out.append(f"**kind:** `{self.kind}` &nbsp; "
                       f"**file:** `{self.file}:{self.line or ''}` &nbsp; "
                       f"**lang:** `{self.language or '?'}`")
        if self.parents:
            out.append(f"\n### Parents ({len(self.parents)})\n" +
                       "\n".join(f"- `{p}`" for p in self.parents))
        if self.children:
            out.append(f"\n### Children ({len(self.children)})\n" +
                       "\n".join(f"- `{c}`" for c in self.children))
        if self.direct_callers:
            head = self.direct_callers[:20]
            out.append(f"\n### Direct callers ({len(self.direct_callers)})\n" +
                       "\n".join(f"- `{c}`" for c in head))
            if len(self.direct_callers) > 20:
                out.append(f"  - … and {len(self.direct_callers) - 20} more")
        if self.direct_callees:
            head = self.direct_callees[:20]
            out.append(f"\n### Direct callees ({len(self.direct_callees)})\n" +
                       "\n".join(f"- `{c}`" for c in head))
            if len(self.direct_callees) > 20:
                out.append(f"  - … and {len(self.direct_callees) - 20} more")
        if self.endpoints_handled:
            out.append(f"\n### Endpoints handled ({len(self.endpoints_handled)})\n" +
                       "\n".join(f"- `{e['operation']} {e['path']}`"
                                  for e in self.endpoints_handled))
        if self.outbound_interactions:
            out.append(f"\n### Outbound interactions ({len(self.outbound_interactions)})\n" +
                       "\n".join(f"- `{i['mechanism']}` → `{i['target']}`"
                                  for i in self.outbound_interactions))
        if self.file_imports:
            head = self.file_imports[:15]
            out.append(f"\n### Imports in same file ({len(self.file_imports)})\n" +
                       "\n".join(f"- `{p}`" for p in head))
            if len(self.file_imports) > 15:
                out.append(f"  - … and {len(self.file_imports) - 15} more")
        if self.notes:
            out.append("\n### Notes\n" + "\n".join(f"- {n}" for n in self.notes))
        return "\n".join(out)


def context_of(graph: DepGraph, symbol: str) -> SymbolContext:
    """Build a 360° view for `symbol` (qualified_name or bare name)."""
    ctx = SymbolContext(symbol=symbol)
    matches = graph.find_symbol(symbol)
    if not matches:
        ctx.notes.append(f"symbol not found: {symbol!r}")
        return ctx

    if len(matches) > 1:
        ctx.notes.append(f"{len(matches)} matches; using first: "
                          f"{matches[0]['qualified_name']!r}")
    s = matches[0]
    ctx.qualified_name = s["qualified_name"]
    ctx.kind = s["kind"]
    ctx.line = s["line"]
    ctx.language = s["language"] or ""

    file_row = graph.query_one(
        "SELECT path FROM files WHERE id = ?", (s["file_id"],))
    if file_row:
        ctx.file = file_row["path"]

    # Direct callers
    ctx.direct_callers = [
        r["qname"] for r in graph.query(
            """SELECT DISTINCT s2.qualified_name AS qname
               FROM calls c
               JOIN symbols s2 ON c.caller_symbol_id = s2.id
               WHERE c.callee_qualified_name = ?""",
            (ctx.qualified_name,),
        ) if r["qname"]
    ]

    # Direct callees
    ctx.direct_callees = [
        r["q"] for r in graph.query(
            """SELECT DISTINCT c.callee_qualified_name AS q
               FROM calls c
               WHERE c.caller_symbol_id = ?""",
            (s["id"],),
        ) if r["q"]
    ]

    # Inheritance
    ctx.parents = [
        r["q"] for r in graph.query(
            """SELECT parent_qualified_name AS q
               FROM inheritance WHERE child_symbol_id = ?""",
            (s["id"],),
        )
    ]
    ctx.children = [
        r["q"] for r in graph.query(
            """SELECT s2.qualified_name AS q
               FROM inheritance i
               JOIN symbols s2 ON i.child_symbol_id = s2.id
               WHERE i.parent_qualified_name = ?""",
            (ctx.qualified_name,),
        )
    ]

    # Endpoints handled by this symbol
    ctx.endpoints_handled = [
        {"operation": r["operation"], "path": r["path"],
         "framework": r["framework"] or ""}
        for r in graph.query(
            """SELECT operation, path, framework
               FROM endpoints WHERE handler_symbol_id = ?""",
            (s["id"],),
        )
    ]

    # Outbound interactions sourced from this symbol
    ctx.outbound_interactions = [
        {"mechanism": r["mechanism"], "target": r["target"] or "",
         "direction": r["direction"]}
        for r in graph.query(
            """SELECT mechanism, target, direction
               FROM interactions WHERE source_symbol_id = ?""",
            (s["id"],),
        )
    ]

    # File-level imports
    if ctx.file:
        ctx.file_imports = [
            r["package"] for r in graph.query(
                """SELECT DISTINCT package FROM imports
                   WHERE file_id = ? ORDER BY package""",
                (s["file_id"],),
            )
        ]

    return ctx
