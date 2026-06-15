"""Execution flow tracing.

Given a seed (symbol qualified_name OR an endpoint id / "VERB /path"), walk
callees breadth-first, fold in inheritance overrides, halt at interaction
sinks (DB write, HTTP outbound, queue publish, etc.).

Renders to Mermaid OR returns a structured FlowGraph.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

from src.dep.db import DepGraph

DEFAULT_MAX_DEPTH = 10
MERMAID_NODE_CAP = 100   # cap Mermaid output size


@dataclass(frozen=True)
class FlowNode:
    qualified_name: str
    kind: str = ""           # symbol | endpoint | interaction
    label: str = ""          # display label (e.g. "GET /owners" for endpoints)
    file: str = ""
    line: Optional[int] = None
    depth: int = 0


@dataclass(frozen=True)
class FlowEdge:
    src: str
    dst: str
    kind: str = "calls"     # calls | overrides | interaction


@dataclass
class FlowGraph:
    seed: str
    nodes: list[FlowNode] = field(default_factory=list)
    edges: list[FlowEdge] = field(default_factory=list)
    truncated: bool = False
    notes: list[str] = field(default_factory=list)


# ─── public API ───────────────────────────────────────────────────────────

def trace_from(graph: DepGraph, seed: str,
               max_depth: int = DEFAULT_MAX_DEPTH) -> FlowGraph:
    """Trace execution from `seed`. Returns a FlowGraph."""
    fg = FlowGraph(seed=seed)
    start_qname = _resolve_seed(graph, seed, fg)
    if start_qname is None:
        fg.notes.append(f"could not resolve seed: {seed!r}")
        return fg

    seen_qnames: set[str] = {start_qname}
    fg.nodes.append(FlowNode(
        qualified_name=start_qname, kind="symbol",
        label=start_qname, depth=0,
    ))
    frontier: list[tuple[str, int]] = [(start_qname, 0)]

    while frontier and len(fg.nodes) < MERMAID_NODE_CAP:
        next_frontier: list[tuple[str, int]] = []
        for qname, depth in frontier:
            if depth >= max_depth:
                continue

            # Outbound interactions on this symbol = sinks (don't recurse past)
            for sink in _interactions_of(graph, qname):
                if sink.qualified_name not in seen_qnames:
                    seen_qnames.add(sink.qualified_name)
                    fg.nodes.append(sink)
                    fg.edges.append(FlowEdge(qname, sink.qualified_name, "interaction"))

            # Callees (continue traversal)
            for callee in _callees_of(graph, qname):
                if callee in seen_qnames:
                    fg.edges.append(FlowEdge(qname, callee, "calls"))
                    continue
                seen_qnames.add(callee)
                node = _node_for(graph, callee, depth + 1)
                fg.nodes.append(node)
                fg.edges.append(FlowEdge(qname, callee, "calls"))
                next_frontier.append((callee, depth + 1))

            # Inheritance overrides — when X is a method, also follow overrides
            for ovr in _overrides_of(graph, qname):
                if ovr in seen_qnames:
                    continue
                seen_qnames.add(ovr)
                fg.nodes.append(_node_for(graph, ovr, depth + 1))
                fg.edges.append(FlowEdge(qname, ovr, "overrides"))
                next_frontier.append((ovr, depth + 1))

            if len(fg.nodes) >= MERMAID_NODE_CAP:
                break
        frontier = next_frontier

    if len(fg.nodes) >= MERMAID_NODE_CAP:
        fg.truncated = True
        fg.notes.append(f"truncated at {MERMAID_NODE_CAP} nodes")
    return fg


def to_mermaid(fg: FlowGraph) -> str:
    """Render FlowGraph as a Mermaid `flowchart LR` block."""
    if not fg.nodes:
        return f"%% empty flow for seed: {fg.seed}"
    out: list[str] = ["flowchart LR"]
    # Deterministic ID assignment
    ids: dict[str, str] = {n.qualified_name: f"n{i}" for i, n in enumerate(fg.nodes)}
    for n in fg.nodes:
        nid = ids[n.qualified_name]
        label = n.label or n.qualified_name
        if n.kind == "endpoint":
            out.append(f'    {nid}(["{label}"])')
        elif n.kind == "interaction":
            out.append(f'    {nid}[/"{label}"/]')
        else:
            out.append(f'    {nid}["{label}"]')
    for e in fg.edges:
        a = ids.get(e.src)
        b = ids.get(e.dst)
        if not (a and b):
            continue
        if e.kind == "interaction":
            out.append(f"    {a} -.->|sink| {b}")
        elif e.kind == "overrides":
            out.append(f"    {a} -.->|override| {b}")
        else:
            out.append(f"    {a} --> {b}")
    if fg.truncated:
        out.append(f'    %% TRUNCATED at {MERMAID_NODE_CAP} nodes')
    return "\n".join(out)


# ─── helpers ───────────────────────────────────────────────────────────────

def _resolve_seed(graph: DepGraph, seed: str, fg: FlowGraph) -> Optional[str]:
    """Accept either a symbol qname/name OR a "VERB /path" endpoint shorthand."""
    s = seed.strip()
    # Endpoint shorthand: "GET /owners" or just "/owners"
    if s.startswith("/") or " /" in s:
        parts = s.split(maxsplit=1)
        if len(parts) == 2 and parts[0].isalpha():
            verb, path = parts[0].upper(), parts[1]
            row = graph.query_one(
                """SELECT s.qualified_name AS qname
                   FROM endpoints e
                   LEFT JOIN symbols s ON e.handler_symbol_id = s.id
                   WHERE e.operation = ? AND e.path = ?""",
                (verb, path),
            )
        else:
            row = graph.query_one(
                """SELECT s.qualified_name AS qname
                   FROM endpoints e
                   LEFT JOIN symbols s ON e.handler_symbol_id = s.id
                   WHERE e.path = ?""",
                (s,),
            )
        if row and row["qname"]:
            return row["qname"]
        fg.notes.append(f"endpoint matched, but no handler symbol resolved: {s!r}")
        return None

    # Symbol — qname or bare name
    matches = graph.find_symbol(s)
    if matches:
        return matches[0]["qualified_name"]
    return None


def _callees_of(graph: DepGraph, caller_qname: str) -> list[str]:
    rows = graph.query(
        """SELECT DISTINCT c.callee_qualified_name AS q
           FROM calls c
           JOIN symbols s ON c.caller_symbol_id = s.id
           WHERE s.qualified_name = ?""",
        (caller_qname,),
    )
    return [r["q"] for r in rows if r["q"]]


def _overrides_of(graph: DepGraph, parent_qname: str) -> list[str]:
    """If parent_qname is `Class.method`, return same-named methods on
    subclasses."""
    if "." not in parent_qname:
        return []
    parent_class, method = parent_qname.rsplit(".", 1)
    rows = graph.query(
        """SELECT s.qualified_name AS q
           FROM inheritance i
           JOIN symbols s ON i.child_symbol_id = s.id
           JOIN symbols m ON m.qualified_name = (s.qualified_name || '.' || ?)
                          AND m.kind = 'method'
           WHERE i.parent_qualified_name = ?""",
        (method, parent_class),
    )
    return [r["q"] for r in rows]


def _interactions_of(graph: DepGraph, qname: str) -> list[FlowNode]:
    rows = graph.query(
        """SELECT i.target, i.mechanism, i.direction, f.path AS file, i.line
           FROM interactions i
           JOIN symbols s ON i.source_symbol_id = s.id
           LEFT JOIN files f ON i.file_id = f.id
           WHERE s.qualified_name = ?""",
        (qname,),
    )
    out: list[FlowNode] = []
    for r in rows:
        target = r["target"] or "(unknown)"
        synth_qname = f"interaction:{r['mechanism']}:{target}"
        label = f"{r['mechanism']} → {target}"
        out.append(FlowNode(
            qualified_name=synth_qname,
            kind="interaction",
            label=label,
            file=r["file"] or "",
            line=r["line"],
        ))
    return out


def _node_for(graph: DepGraph, qname: str, depth: int) -> FlowNode:
    """Look up file/line for a qname. Falls back gracefully if not in symbols."""
    row = graph.query_one(
        """SELECT s.kind, f.path AS file, s.line
           FROM symbols s
           LEFT JOIN files f ON s.file_id = f.id
           WHERE s.qualified_name = ?""",
        (qname,),
    )
    if row:
        return FlowNode(qualified_name=qname, kind=row["kind"] or "symbol",
                        label=qname, file=row["file"] or "",
                        line=row["line"], depth=depth)
    return FlowNode(qualified_name=qname, kind="symbol", label=qname, depth=depth)
