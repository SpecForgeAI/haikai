"""read_span — bounded source read for the batch-extractor (D11).

Thin CLI over `enrichment_tools.read_source` with the spec's 200-line cap
ENFORCED here (not honor-system prose): a span wider than the cap exits 2.
The ≤5-calls-per-batch budget is the orchestrator's to police (it sees the
agent's tool calls; this process sees one).

Usage:
    python -m src.pipeline.tools.read_span --project-root <repo> --file <rel> --start N --end M
"""

from __future__ import annotations

import argparse
import json
import sys

from src.ast.enrichment_tools import read_source

MAX_LINES = 200


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Bounded source span read")
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    args = parser.parse_args(argv)

    if args.end < args.start:
        print(json.dumps({"error": "end < start"}), file=sys.stderr)
        return 2
    if args.end - args.start + 1 > MAX_LINES:
        print(
            json.dumps({"error": f"span {args.end - args.start + 1} lines exceeds the {MAX_LINES}-line cap (D11)"}),
            file=sys.stderr,
        )
        return 2

    # read_source carries the scope protection ('..' rejection) — reused, not reimplemented.
    text = read_source(args.project_root, args.file, start_line=args.start, end_line=args.end)
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
