"""cross_ref — cross-file resolution for the batch-extractor (D11).

Thin CLI over the dep-graph blast-radius helpers (`query_callers` /
`query_callees`) plus the symbol's own index rows. Mechanical only — names
and locations, no interpretation.

Usage:
    python -m src.pipeline.tools.cross_ref --snapshot <dir> --symbol <name> [--direction callers|callees] [--depth N]
"""

from __future__ import annotations

import argparse
import json
import sys

from src.ast.enrichment_tools import query_callees, query_callers
from src.pipeline.index import AstIndex


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cross-file symbol resolution")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--direction", choices=["callers", "callees"], default="callers")
    parser.add_argument("--depth", type=int, default=2)
    args = parser.parse_args(argv)

    index = AstIndex(args.snapshot)
    if not index.exists():
        print(json.dumps({"error": f"no snapshot at {args.snapshot}"}), file=sys.stderr)
        return 2

    definitions = [
        {"file": s.file, "kind": s.kind, "name": s.name, "scope": s.scope, "line": s.line_start}
        for s in index.symbols
        if s.name == args.symbol
    ]
    refs_fn = query_callers if args.direction == "callers" else query_callees
    refs = refs_fn(args.snapshot, args.symbol, depth=args.depth)

    json.dump({"symbol": args.symbol, "definitions": definitions, args.direction: refs}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
