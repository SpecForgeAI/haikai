"""The 5 guarded recorder tools (D10.1) — the ONLY write path for the
guarded tables (verdicts, task_group_state, repairs).

The verification-loop agent decides; these tools record exactly what it
decides UNLESS the write violates a mechanical invariant, in which case it
REFUSES — the agent cannot narrate past a guard:

- record_verdict   refuses an unknown verdict and a duplicate (cell, attempt)
- record_hook      side-effect log only — hooks NEVER gate
- advance          refuses a red-gate advance (any expected cell's latest
                   verdict ∉ {pass, skipped}) and a double advance
- open_repair      refuses past the attempt cap (default 3)
- update_checklist upsert, unguarded content

CLI (for the agent via Bash, D10/D12 idiom):
    python -m src.verification.recorder <tool> --json '<payload>'
Exit 0 = recorded; 1 = REFUSED (reason on stdout); 2 = bad input.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone

from src.verification.store import VERDICTS, append_event, connect, latest_verdicts

ATTEMPT_CAP = 3


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_verdict(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
                   repo: str, verifier: str, verdict: str, attempt: int | None = None,
                   detail: dict | None = None, return_attempt: bool = False):
    """Record one verdict for a cell. The attempt ordinal is derived ATOMICALLY
    (R3): callers MUST NOT read latest_verdicts then pass attempt=prev+1 — that
    read-modify-write loses updates under concurrent deliveries, with the UNIQUE
    constraint turning a second *legitimate* verdict into a false 'duplicate'
    409 that drops it. Leave attempt=None and the MAX(attempt)+1 is computed
    inside the same IMMEDIATE write txn, so concurrent writers serialize and each
    gets the next ordinal. An explicit attempt is still honoured (repair flows).

    Returns (ok, reason). With return_attempt=True returns (ok, reason, attempt)
    — the EXACT attempt assigned to this write — so a caller that needs to report
    it doesn't re-read latest_verdicts (last-writer; misreports a concurrent
    writer's attempt under interleave, R3)."""
    def _ret(ok, reason, att=None):
        return (ok, reason, att) if return_attempt else (ok, reason)

    if verdict not in VERDICTS:
        return _ret(False, f"refused: verdict '{verdict}' not in {VERDICTS}")
    if not all([orchestrate_id, task_group_id, repo, verifier]):
        return _ret(False, "refused: orchestrate_id/task_group_id/repo/verifier all required (D1 cell key)")
    try:
        with conn:
            if attempt is None:
                cur = conn.execute(
                    "INSERT INTO verdicts (orchestrate_id, task_group_id, repo, verifier, attempt, verdict, detail_json, created_at)"
                    " VALUES (?, ?, ?, ?,"
                    "   (SELECT COALESCE(MAX(attempt), 0) + 1 FROM verdicts"
                    "    WHERE orchestrate_id=? AND task_group_id=? AND repo=? AND verifier=?),"
                    "   ?, ?, ?)",
                    (orchestrate_id, task_group_id, repo, verifier,
                     orchestrate_id, task_group_id, repo, verifier,
                     verdict, json.dumps(detail or {}), _now()),
                )
                attempt = conn.execute(
                    "SELECT attempt FROM verdicts WHERE rowid=?", (cur.lastrowid,)
                ).fetchone()[0]
            else:
                conn.execute(
                    "INSERT INTO verdicts (orchestrate_id, task_group_id, repo, verifier, attempt, verdict, detail_json, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (orchestrate_id, task_group_id, repo, verifier, attempt, verdict,
                     json.dumps(detail or {}), _now()),
                )
    except sqlite3.IntegrityError:
        return _ret(False, f"refused: duplicate verdict for cell ({repo}, {verifier}) attempt {attempt}")
    append_event(conn, orchestrate_id, task_group_id, "verdict_recorded",
                 {"repo": repo, "verifier": verifier, "verdict": verdict, "attempt": attempt}, repo)
    return _ret(True, "recorded", attempt)


def record_verdict_with_delivery(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
                                 repo: str, verifier: str, verdict: str, *,
                                 provider: str, delivery: str,
                                 detail: dict | None = None) -> tuple[str, str]:
    """R7: mark the webhook delivery (dedup) AND record the verdict in ONE
    transaction, so a crash BETWEEN them can't happen — previously the delivery
    was committed first, and a crash before the verdict left the delivery marked
    'seen' with no verdict, so the provider's retry was rejected as a duplicate and
    the verdict was lost forever. Now either both commit or neither.

    Returns (status, reason): status in {'recorded', 'duplicate', 'refused'}.
    'duplicate' means the delivery was already marked (a concurrent webhook won the
    race) — the verdict is NOT double-recorded."""
    if verdict not in VERDICTS:
        return "refused", f"refused: verdict '{verdict}' not in {VERDICTS}"
    if not all([orchestrate_id, task_group_id, repo, verifier]):
        return "refused", "refused: orchestrate_id/task_group_id/repo/verifier all required (D1 cell key)"
    try:
        with conn:
            # delivery dedup mark — UNIQUE(provider, delivery_id) raises on replay
            conn.execute(
                "INSERT INTO webhook_deliveries (provider, delivery_id, created_at) VALUES (?, ?, ?)",
                (provider, delivery, _now()),
            )
            # verdict (atomic attempt) in the SAME txn — both commit together
            cur = conn.execute(
                "INSERT INTO verdicts (orchestrate_id, task_group_id, repo, verifier, attempt, verdict, detail_json, created_at)"
                " VALUES (?, ?, ?, ?,"
                "   (SELECT COALESCE(MAX(attempt), 0) + 1 FROM verdicts"
                "    WHERE orchestrate_id=? AND task_group_id=? AND repo=? AND verifier=?),"
                "   ?, ?, ?)",
                (orchestrate_id, task_group_id, repo, verifier,
                 orchestrate_id, task_group_id, repo, verifier,
                 verdict, json.dumps(detail or {}), _now()),
            )
            attempt = conn.execute(
                "SELECT attempt FROM verdicts WHERE rowid=?", (cur.lastrowid,)
            ).fetchone()[0]
    except sqlite3.IntegrityError:
        # Auto-attempt can't collide the verdict UNIQUE, so this is the delivery
        # dedup row — a replay / concurrent duplicate. Nothing was committed.
        return "duplicate", "duplicate delivery — already processed"
    append_event(conn, orchestrate_id, task_group_id, "verdict_recorded",
                 {"repo": repo, "verifier": verifier, "verdict": verdict, "attempt": attempt}, repo)
    return "recorded", "recorded"


def supersede_pending(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
                         repo: str, verifier: str, verdict: str,
                         detail: dict | None = None) -> tuple[bool, str | None]:
    """R1: record ``verdict`` for the cell ONLY IF its latest verdict is ``pending``
    (or there is none). The pending-check and the insert are ONE statement run
    under BEGIN IMMEDIATE, so two CONCURRENT supersedes can't both win — the second
    waits for the first's commit, then re-evaluates the WHERE against the now-
    terminal state and inserts nothing.

    This replaces the read-then-write gate (read latest_verdicts, then a separate
    record_verdict): that gate raced because the atomic MAX(attempt)+1 hands each
    concurrent writer a DISTINCT attempt, so the UNIQUE constraint no longer
    collides to drop the duplicate — both would supersede and both would release
    the box.

    Returns ``(recorded, owned_box_id)``. ``recorded=False`` means the cell already
    settled (caller treats it as an idempotent no-op). ``owned_box_id`` is the
    box_id recorded on the superseded ``pending`` verdict (for release), or None.
    """
    if verdict not in VERDICTS:
        return False, None
    if not all([orchestrate_id, task_group_id, repo, verifier]):
        return False, None
    p = {"oid": orchestrate_id, "tgid": task_group_id, "repo": repo, "verifier": verifier,
         "verdict": verdict, "detail": json.dumps(detail or {}), "now": _now()}
    cell_where = ("orchestrate_id=:oid AND task_group_id=:tgid AND repo=:repo AND verifier=:verifier")
    with conn:
        cur = conn.execute(
            "INSERT INTO verdicts (orchestrate_id, task_group_id, repo, verifier, attempt, verdict, detail_json, created_at) "
            "SELECT :oid, :tgid, :repo, :verifier, "
            f"  (SELECT COALESCE(MAX(attempt), 0) + 1 FROM verdicts WHERE {cell_where}), "
            "  :verdict, :detail, :now "
            f"WHERE COALESCE((SELECT verdict FROM verdicts WHERE {cell_where} ORDER BY id DESC LIMIT 1), 'pending') = 'pending'",
            p,
        )
        recorded = cur.rowcount == 1
        owned_box = None
        if recorded:
            row = conn.execute(
                f"SELECT detail_json FROM verdicts WHERE {cell_where} AND verdict='pending' ORDER BY id DESC LIMIT 1",
                p,
            ).fetchone()
            if row:
                try:
                    owned_box = json.loads(row[0] or "{}").get("box_id")
                except (TypeError, ValueError):
                    owned_box = None
    if recorded:
        append_event(conn, orchestrate_id, task_group_id, "verdict_recorded",
                     {"repo": repo, "verifier": verifier, "verdict": verdict, "superseded_pending": True}, repo)
    else:
        # C8: don't drop the no-op silently — leave a breadcrumb on the event store.
        append_event(conn, orchestrate_id, task_group_id, "verdict_superseded",
                     {"repo": repo, "verifier": verifier, "verdict": verdict,
                      "reason": "cell already terminal"}, repo)
    return recorded, owned_box


def record_hook(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
                transition: str, handler: str, result: str = "ok") -> tuple[bool, str]:
    """Hooks are side-effect-only and NEVER gate — this is an append, no guard."""
    append_event(conn, orchestrate_id, task_group_id, "hook_fired",
                 {"transition": transition, "handler": handler, "result": result})
    return True, "recorded"


def advance(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
            expected_cells: list[list[str]] | None = None) -> tuple[bool, str]:
    """Record the group as advanced. GUARDS (D10.1):
    1. red gate — every expected cell's LATEST verdict must be pass|skipped.
       expected_cells = [[repo, verifier], ...] from orchestration.yml (the
       loop's judgement input); None = all cells with recorded verdicts.
    2. double advance — UNIQUE(orchestrate, group) state row.
    """
    latest = latest_verdicts(conn, orchestrate_id, task_group_id)
    if not latest:
        return False, "refused: no verdicts recorded for this group — nothing to gate (red-gate advance)"
    cells = [tuple(c) for c in expected_cells] if expected_cells else list(latest.keys())
    red = []
    for cell in cells:
        row = latest.get(cell)
        if row is None:
            red.append(f"{cell}: no verdict")
        elif row["verdict"] not in ("pass", "skipped"):
            red.append(f"{cell}: {row['verdict']}")
    if red:
        return False, f"refused: red-gate advance (D5) — {'; '.join(red)}"
    try:
        with conn:
            conn.execute(
                "INSERT INTO task_group_state (orchestrate_id, task_group_id, state, updated_at)"
                " VALUES (?, ?, 'advanced', ?)",
                (orchestrate_id, task_group_id, _now()),
            )
    except sqlite3.IntegrityError:
        return False, "refused: double advance — group already advanced (D10.6)"
    append_event(conn, orchestrate_id, task_group_id, "advanced", {"cells": [list(c) for c in cells]})
    return True, "advanced"


def open_repair(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
                repo: str, verifier: str, attempt: int) -> tuple[bool, str]:
    if attempt > ATTEMPT_CAP:
        return False, f"refused: attempt {attempt} exceeds the cap ({ATTEMPT_CAP}) — escalate to a human (D4)"
    try:
        with conn:
            conn.execute(
                "INSERT INTO repairs (orchestrate_id, task_group_id, repo, verifier, attempt, opened_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (orchestrate_id, task_group_id, repo, verifier, attempt, _now()),
            )
    except sqlite3.IntegrityError:
        return False, f"refused: repair attempt {attempt} already open for cell ({repo}, {verifier})"
    append_event(conn, orchestrate_id, task_group_id, "repair_opened",
                 {"repo": repo, "verifier": verifier, "attempt": attempt}, repo)
    return True, "opened"


def update_checklist(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
                     item: str, status: str) -> tuple[bool, str]:
    with conn:
        conn.execute(
            "INSERT INTO checklist (orchestrate_id, task_group_id, item, status, updated_at)"
            " VALUES (?, ?, ?, ?, ?)"
            " ON CONFLICT(orchestrate_id, task_group_id, item) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
            (orchestrate_id, task_group_id, item, status, _now()),
        )
    append_event(conn, orchestrate_id, task_group_id, "checklist_updated", {"item": item, "status": status})
    return True, "updated"


TOOLS = {
    "record_verdict": (record_verdict, ["orchestrate_id", "task_group_id", "repo", "verifier", "verdict"]),
    "record_hook": (record_hook, ["orchestrate_id", "task_group_id", "transition", "handler"]),
    "advance": (advance, ["orchestrate_id", "task_group_id"]),
    "open_repair": (open_repair, ["orchestrate_id", "task_group_id", "repo", "verifier", "attempt"]),
    "update_checklist": (update_checklist, ["orchestrate_id", "task_group_id", "item", "status"]),
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Guarded verification recorder tools (D10.1)")
    parser.add_argument("tool", choices=sorted(TOOLS))
    parser.add_argument("--json", required=True, help="payload object")
    parser.add_argument("--db", default=None, help="db path override")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.json)
        assert isinstance(payload, dict)
    except (json.JSONDecodeError, AssertionError):
        print(json.dumps({"error": "--json must be an object"}))
        return 2
    fn, required = TOOLS[args.tool]
    missing = [k for k in required if k not in payload]
    if missing:
        print(json.dumps({"error": f"missing keys: {missing}"}))
        return 2
    conn = connect(args.db)
    try:
        ok, reason = fn(conn, **payload)
    except TypeError as exc:
        print(json.dumps({"error": f"bad payload: {exc}"}))
        return 2
    finally:
        conn.close()
    print(json.dumps({"ok": ok, "reason": reason}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
