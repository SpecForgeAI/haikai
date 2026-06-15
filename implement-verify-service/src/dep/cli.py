"""CLI for the dependency-graph engines.

Designed so V1's cli-delegated subprocess (which uses Claude CLI's Bash
tool, not our TOOLS dict) can shell out to dep-graph queries:

    python -m src.dep.cli callers <snapshot> <symbol> [--depth N]
    python -m src.dep.cli callees <snapshot> <symbol> [--depth N]
    python -m src.dep.cli context <snapshot> <symbol>
    python -m src.dep.cli trace   <snapshot> <seed>   [--format mermaid|json]
    python -m src.dep.cli processes <snapshot>        [--min-size N]
    python -m src.dep.cli rebuild <snapshot>          [--force]
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from src.dep import (
    DepGraph,
    impact_of,
    trace_from,
    context_of,
    processes_in,
)
from src.dep.flow import to_mermaid


def _open(snapshot: str) -> DepGraph:
    snap = Path(snapshot)
    if not snap.exists():
        sys.stderr.write(f"snapshot not found: {snapshot}\n")
        sys.exit(2)
    return DepGraph.open_or_build(snap)


def cmd_callers(args: argparse.Namespace) -> int:
    graph = _open(args.snapshot)
    try:
        rep = impact_of(graph, args.symbol, depth=args.depth, include_endpoints=False)
    finally:
        graph.close()
    if args.json:
        print(json.dumps(asdict(rep), indent=2, default=str))
        return 0
    if rep.notes and not rep.direct_callers and not rep.transitive_callers:
        print(" ; ".join(rep.notes))
        return 1
    print(f"# {rep.symbol} — {rep.total_callers} caller(s) (depth={args.depth})")
    for c in rep.direct_callers[:args.limit]:
        print(f"  direct: {c.qualified_name}\t{c.file or ''}:{c.line or ''}")
    for c in rep.transitive_callers[:args.limit]:
        print(f"  d={c.depth}: {c.qualified_name}")
    return 0


def cmd_callees(args: argparse.Namespace) -> int:
    graph = _open(args.snapshot)
    try:
        rep = impact_of(graph, args.symbol, depth=args.depth, include_endpoints=False)
    finally:
        graph.close()
    if args.json:
        print(json.dumps(asdict(rep), indent=2, default=str))
        return 0
    callees = rep.direct_callees + rep.transitive_callees
    if not callees:
        print(" ; ".join(rep.notes) if rep.notes else f"(no callees for {args.symbol})")
        return 1
    print(f"# {rep.symbol} calls {len(callees)} (depth={args.depth})")
    for c in callees[:args.limit]:
        print(f"  d={c.depth}: {c.qualified_name}")
    return 0


def cmd_context(args: argparse.Namespace) -> int:
    graph = _open(args.snapshot)
    try:
        ctx = context_of(graph, args.symbol)
    finally:
        graph.close()
    if args.json:
        print(json.dumps(asdict(ctx), indent=2, default=str))
        return 0
    print(ctx.as_markdown())
    return 0


def cmd_trace(args: argparse.Namespace) -> int:
    graph = _open(args.snapshot)
    try:
        fg = trace_from(graph, args.seed, max_depth=args.max_depth)
    finally:
        graph.close()
    if args.format == "mermaid":
        print(to_mermaid(fg))
    else:
        print(json.dumps({
            "seed": fg.seed,
            "nodes": [asdict(n) for n in fg.nodes],
            "edges": [asdict(e) for e in fg.edges],
            "truncated": fg.truncated,
            "notes": fg.notes,
        }, indent=2, default=str))
    return 0


def cmd_processes(args: argparse.Namespace) -> int:
    graph = _open(args.snapshot)
    try:
        procs = processes_in(graph, min_size=args.min_size,
                              framework_filter=args.framework)
    finally:
        graph.close()
    if args.json:
        print(json.dumps([asdict(p) for p in procs], indent=2, default=str))
        return 0
    if not procs:
        print("(no processes found)")
        return 0
    for i, p in enumerate(procs, 1):
        print(f"{i}. {p.name} ({len(p.endpoints)} endpoints)")
        for ep in p.endpoints[:10]:
            print(f"   - {ep['operation']} {ep['path']}")
        if p.key_symbols[:5]:
            print(f"   key: {', '.join(p.key_symbols[:5])}")
    return 0


def cmd_rebuild(args: argparse.Namespace) -> int:
    snap = Path(args.snapshot)
    if not snap.exists():
        sys.stderr.write(f"snapshot not found: {args.snapshot}\n")
        return 2
    graph = DepGraph.open_or_build(snap, force_rebuild=args.force)
    counts = {}
    for tbl in ("files", "symbols", "imports", "calls",
                "inheritance", "endpoints", "interactions"):
        counts[tbl] = graph.query_one(f"SELECT COUNT(*) AS c FROM {tbl}")["c"]
    graph.close()
    print(json.dumps({"snapshot": str(snap), "row_counts": counts,
                       "force": args.force}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m src.dep.cli")
    p.add_argument("--json", action="store_true",
                    help="emit JSON instead of human format (where supported)")
    sub = p.add_subparsers(dest="cmd", required=True)

    # callers
    s = sub.add_parser("callers", help="reverse blast radius")
    s.add_argument("snapshot")
    s.add_argument("symbol")
    s.add_argument("--depth", type=int, default=3)
    s.add_argument("--limit", type=int, default=50)
    s.set_defaults(fn=cmd_callers)

    # callees
    s = sub.add_parser("callees", help="forward blast radius")
    s.add_argument("snapshot")
    s.add_argument("symbol")
    s.add_argument("--depth", type=int, default=3)
    s.add_argument("--limit", type=int, default=50)
    s.set_defaults(fn=cmd_callees)

    # context
    s = sub.add_parser("context", help="360° symbol context")
    s.add_argument("snapshot")
    s.add_argument("symbol")
    s.set_defaults(fn=cmd_context)

    # trace
    s = sub.add_parser("trace", help="execution flow trace")
    s.add_argument("snapshot")
    s.add_argument("seed")
    s.add_argument("--format", choices=["json", "mermaid"], default="mermaid")
    s.add_argument("--max-depth", type=int, default=10, dest="max_depth")
    s.set_defaults(fn=cmd_trace)

    # processes
    s = sub.add_parser("processes", help="cluster endpoints into processes")
    s.add_argument("snapshot")
    s.add_argument("--min-size", type=int, default=1, dest="min_size")
    s.add_argument("--framework", default=None)
    s.set_defaults(fn=cmd_processes)

    # rebuild
    s = sub.add_parser("rebuild", help="rebuild SQLite from TSVs")
    s.add_argument("snapshot")
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_rebuild)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
