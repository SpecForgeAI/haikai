"""pre_check — skip a batch with nothing to extract (orchestrator Step 5.3).

stdin: {"batch": {...}, "candidates": [...]}
exit 0 = proceed to agent.invoke, exit 2 = skip (ledger status no_candidates).
"""

from __future__ import annotations

import sys

from src.pipeline.checks._io import emit, read_stdin_json


def run(payload: dict) -> tuple[int, dict]:
    candidates = payload.get("candidates") or []
    if not candidates:
        return 2, {"verdict": "no_candidates"}
    return 0, {"verdict": "proceed", "candidate_count": len(candidates)}


def main() -> int:
    code, payload = run(read_stdin_json())
    emit(payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
