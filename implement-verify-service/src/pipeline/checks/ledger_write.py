"""ledger_write — append the per-batch ledger row (orchestrator Step 5.6).

The ledger is the only source of truth for batch status. This check REFUSES
a duplicate batch_id row (D12 — the one guarded write the design pre-empts;
see verification spec D10.1 for the pattern).

stdin: {"out_dir", "batch_id", "status", "records": [...], "attempts", "cost_usd", "duration_ms"}
exit 0 = row written; exit 1 = refused (duplicate or invalid).
"""

from __future__ import annotations

import json
import os
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from src.pipeline.checks._io import OutDirError, emit, read_stdin_json, safe_out_dir

VALID_STATUSES = ("done", "gave_up", "refused", "no_candidates")
LOCK_TIMEOUT_S = 30


@contextmanager
def _exclusive_lock(ledger_path: Path):
    """Inter-process exclusive lock spanning the duplicate-check AND the
    append (C3 — read-then-append raced under parallel batch dispatch).
    Sidecar .lock file; msvcrt on Windows, fcntl elsewhere."""
    lock_path = ledger_path.with_suffix(".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR)
    try:
        if os.name == "nt":
            import msvcrt

            deadline = time.monotonic() + LOCK_TIMEOUT_S
            while True:
                try:
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise TimeoutError(f"ledger lock timeout: {lock_path}")
                    time.sleep(0.05)
        else:
            import fcntl

            fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def run(payload: dict) -> tuple[int, dict]:
    out_dir = payload.get("out_dir", "")
    batch_id = payload.get("batch_id", "")
    status = payload.get("status", "")

    if not out_dir or not batch_id:
        return 1, {"verdict": "refused", "reason": "out_dir and batch_id required"}
    if status not in VALID_STATUSES:
        return 1, {"verdict": "refused", "reason": f"status must be one of {VALID_STATUSES}"}
    try:
        out_path = safe_out_dir(out_dir)
    except OutDirError as exc:
        return 1, {"verdict": "refused", "reason": f"out_dir refused (P3a): {exc}"}

    ledger_path = out_path / "batch_ledger.jsonl"
    with _exclusive_lock(ledger_path):
        if ledger_path.exists():
            for line in ledger_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("batch_id") == batch_id:
                    return 1, {
                        "verdict": "refused",
                        "reason": f"duplicate ledger row for batch_id {batch_id} — "
                        "exactly one row per batch (D12)",
                    }

        row = {
            "batch_id": batch_id,
            "status": status,
            "records": payload.get("records", []),
            "attempts": payload.get("attempts", 0),
            "cost_usd": payload.get("cost_usd"),
            "duration_ms": payload.get("duration_ms"),
            "written_at": datetime.now(timezone.utc).isoformat(),
        }
        with ledger_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row) + "\n")
    return 0, {"verdict": "written", "ledger": str(ledger_path)}


def main() -> int:
    code, payload = run(read_stdin_json())
    emit(payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
