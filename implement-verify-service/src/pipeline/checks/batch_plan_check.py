"""batch_plan_check — refuse impossible batches (orchestrator Step 5.1).

stdin: one batch object {"id", "kind", "scope": {"files": [...]}, "candidate_count"}
exit 0 = proceed, exit 1 = refuse (reason on stdout).
"""

from __future__ import annotations

import sys

from src.pipeline.checks._io import emit, read_stdin_json
from src.pipeline.tools.plan_batches import MAX_CANDIDATES, VALID_KINDS


def run(batch: dict) -> tuple[int, dict]:
    reasons: list[str] = []
    if not batch.get("id"):
        reasons.append("batch has no id")
    if batch.get("kind") not in VALID_KINDS:
        reasons.append(f"unknown kind '{batch.get('kind')}'")
    files = (batch.get("scope") or {}).get("files") or []
    if not files:
        reasons.append("batch has no files")
    count = batch.get("candidate_count", 0)
    if not isinstance(count, int) or count < 1:
        reasons.append("batch has no candidates")
    # Multi-file oversize is refused: plan_batches should have split it, so the
    # plan is stale or hand-edited. A single-file batch CANNOT be split — the
    # planner marks it oversize:true and it proceeds (C5; the extractor pays
    # the budget overrun rather than the file being unextractable forever).
    elif count > MAX_CANDIDATES * 2 and not (len(files) == 1 and batch.get("oversize") is True):
        reasons.append(f"candidate_count {count} far exceeds cap {MAX_CANDIDATES} — re-run plan_batches")

    if reasons:
        return 1, {"verdict": "refused", "reasons": reasons}
    return 0, {"verdict": "proceed"}


def main() -> int:
    code, payload = run(read_stdin_json())
    emit(payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
