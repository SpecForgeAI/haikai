"""ast_query — mechanical candidate lookup over a snapshot (code path A).

Usage:
    python -m src.pipeline.tools.ast_query --index <snapshot_dir> --filter '<json>'

Filter keys (all optional, all MECHANICAL — D1):
    node_kinds: ["function", "method", "class", ...]
    name_regex: "save|persist"
    file_glob:  "src/services/*.py"
    has_decorator: true

Semantic filter values (endpoint/route/handler/...) exit 2.
Output: JSON array of candidate rows on stdout.
"""

from __future__ import annotations

import argparse
import json
import sys

from src.pipeline.index import AstIndex, SemanticFilterError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Mechanical AST query")
    parser.add_argument("--index", required=True, help="snapshot directory")
    parser.add_argument("--filter", default="{}", help="JSON filter object")
    args = parser.parse_args(argv)

    try:
        flt = json.loads(args.filter)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"bad filter json: {exc}"}), file=sys.stderr)
        return 2

    index = AstIndex(args.index)
    if not index.exists():
        print(json.dumps({"error": f"no snapshot at {args.index}"}), file=sys.stderr)
        return 2

    try:
        rows = index.query(
            node_kinds=flt.get("node_kinds"),
            name_regex=flt.get("name_regex"),
            file_glob=flt.get("file_glob"),
            has_decorator=flt.get("has_decorator"),
        )
    except SemanticFilterError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2

    json.dump(rows, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
