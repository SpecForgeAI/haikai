"""TTL sweeper (D10.5) — a pending cell is never a permanent hold.

Any cell whose LATEST verdict is `pending` and older than the TTL gets a
synthetic `timeout` verdict (terminal: it fails the D5 gate as infra).
Recorded through the guarded recorder like every other verdict.

Usage:
    python -m src.verification.sweeper --ttl-hours 24 [--db <path>]
Exit 0 always; stdout reports swept cells.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

from src.verification import recorder, store

DEFAULT_TTL_HOURS = 24


def sweep(conn, ttl_hours: float = DEFAULT_TTL_HOURS, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=ttl_hours)).isoformat()
    swept = []
    for cell in store.pending_cells_older_than(conn, cutoff):
        ok, reason = recorder.record_verdict(
            conn,
            cell["orchestrate_id"], cell["task_group_id"], cell["repo"], cell["verifier"],
            "timeout",  # attempt derived atomically by the recorder (R3)
            detail={"swept": True, "ttl_hours": ttl_hours, "pending_since": cell["created_at"]},
        )
        # L6: a serve-only cell carries the box haibox left up for Haikai to replay.
        # If we're timing the cell out, Haikai never reconciled — release that box
        # now (best-effort) so it's reclaimed at cell-timeout, not haibox's 7200s TTL.
        released = _release_cell_box(cell) if ok else None
        swept.append({"cell": [cell["repo"], cell["verifier"]],
                      "orchestrate_id": cell["orchestrate_id"],
                      "task_group_id": cell["task_group_id"],
                      "ok": ok, "reason": reason, "released_box": released})
    return swept


def _release_cell_box(cell: dict) -> str | None:
    """Read the box_id from a (pending) cell's recorded detail and release it.
    Best-effort: a release failure (haiboxd down) is non-fatal — the box's own TTL
    is the ultimate backstop. Returns the released box_id or None."""
    try:
        box_id = json.loads(cell.get("detail_json") or "{}").get("box_id")
    except (TypeError, ValueError):
        box_id = None
    if not box_id:
        return None
    try:
        from src.haibox.client import HaiboxClient
        HaiboxClient().release(box_id)
        return box_id
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TTL sweeper (D10.5)")
    parser.add_argument("--ttl-hours", type=float, default=DEFAULT_TTL_HOURS)
    parser.add_argument("--db", default=None)
    args = parser.parse_args(argv)
    conn = store.connect(args.db)
    try:
        swept = sweep(conn, args.ttl_hours)
    finally:
        conn.close()
    json.dump({"swept": swept}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
