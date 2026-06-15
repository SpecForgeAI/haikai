"""Deep Dependency Analysis — public API.

Spec: haikai/specs/2026-04-25-deep-dependency-analysis/spec.md

Usage:
    from src.dep import DepGraph, impact_of, trace_from, context_of, processes_in

    graph = DepGraph.open_or_build(snapshot_path)
    report = impact_of(graph, "OwnerController.list")
    flow   = trace_from(graph, "GET /owners")
    ctx    = context_of(graph, "OwnerController.list")
    procs  = processes_in(graph)
"""
from src.dep.db import DepGraph

# Engines (lazy re-exports — only imported when used so cold-start is cheap)
def impact_of(graph: DepGraph, symbol: str, **kwargs):
    from src.dep.impact import impact_of as _impl
    return _impl(graph, symbol, **kwargs)


def trace_from(graph: DepGraph, seed: str, **kwargs):
    from src.dep.flow import trace_from as _impl
    return _impl(graph, seed, **kwargs)


def context_of(graph: DepGraph, symbol: str, **kwargs):
    from src.dep.context import context_of as _impl
    return _impl(graph, symbol, **kwargs)


def processes_in(graph: DepGraph, **kwargs):
    from src.dep.processes import processes_in as _impl
    return _impl(graph, **kwargs)


__all__ = [
    "DepGraph",
    "impact_of",
    "trace_from",
    "context_of",
    "processes_in",
]
