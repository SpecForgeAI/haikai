"""Verification state store — the D2 jobs.db extension.

Append-only events + projection tables, keyed by the D1 correlation triple
`(orchestrate_id, task_group_id, repo)` with the verifier dimension added
(a CELL = (task_group, repo, verifier)). SQLite, same file as the job queue
by default (env `VERIFICATION_DB_PATH` / `JOBS_DB_PATH` override).

ONLY `src/verification/recorder.py` may WRITE the guarded tables
(verdicts, task_group_state, repairs) — enforced by a count==0 guard test.
This module owns schema + reads + the non-guarded write surface the
gateway needs (bindings, deliveries, events).
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

VERDICTS = ("pass", "fail", "pending", "timeout", "skipped")

SCHEMA = """
CREATE TABLE IF NOT EXISTS verification_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orchestrate_id TEXT NOT NULL,
    task_group_id TEXT NOT NULL,
    repo TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vevents_orch ON verification_events(orchestrate_id, id);

CREATE TABLE IF NOT EXISTS verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orchestrate_id TEXT NOT NULL,
    task_group_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    verifier TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    verdict TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(orchestrate_id, task_group_id, repo, verifier, attempt)
);

CREATE TABLE IF NOT EXISTS ci_bindings (
    head_sha TEXT NOT NULL,
    provider TEXT NOT NULL,
    orchestrate_id TEXT NOT NULL,
    task_group_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    verifier TEXT NOT NULL DEFAULT 'ci-trigger',
    created_at TEXT NOT NULL,
    UNIQUE(head_sha, provider)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    provider TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(provider, delivery_id)
);

CREATE TABLE IF NOT EXISTS task_group_state (
    orchestrate_id TEXT NOT NULL,
    task_group_id TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(orchestrate_id, task_group_id)
);

CREATE TABLE IF NOT EXISTS repairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orchestrate_id TEXT NOT NULL,
    task_group_id TEXT NOT NULL,
    repo TEXT NOT NULL,
    verifier TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    opened_at TEXT NOT NULL,
    UNIQUE(orchestrate_id, task_group_id, repo, verifier, attempt)
);

CREATE TABLE IF NOT EXISTS dispatched (
    orchestrate_id TEXT NOT NULL,
    child_group_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(orchestrate_id, child_group_id)
);

CREATE TABLE IF NOT EXISTS checklist (
    orchestrate_id TEXT NOT NULL,
    task_group_id TEXT NOT NULL,
    item TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(orchestrate_id, task_group_id, item)
);

-- Inbound bug reports / reconciliation diffs from an external source (e.g.
-- the Haikai frontend). Untrusted external text (D10.7): stored as data,
-- delimited/escaped before any agent consumes it. Optional correlation keys
-- tie a finding to a (orchestrate_id, task_group_id, repo) cell so the repair
-- loop can act; external_id (when given) dedups replays.
-- Inbound bugs (Gary's POST /api/v2/bugs/). The worker investigates each and
-- POSTs the outcome to callback_url. Description/attachments are untrusted
-- external text (D10.7).
CREATE TABLE IF NOT EXISTS bug_reports (
    bug_id TEXT PRIMARY KEY,
    bug_type TEXT NOT NULL,
    description TEXT NOT NULL,
    callback_url TEXT NOT NULL,
    attachments_json TEXT NOT NULL DEFAULT '[]',
    company TEXT NOT NULL DEFAULT '',
    project TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'accepted',
    result_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    external_id TEXT,
    orchestrate_id TEXT NOT NULL DEFAULT '',
    task_group_id TEXT NOT NULL DEFAULT '',
    repo TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'bug',
    title TEXT NOT NULL DEFAULT '',
    detail_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    UNIQUE(source, external_id)
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def db_path() -> str:
    return os.environ.get("VERIFICATION_DB_PATH") or os.environ.get("JOBS_DB_PATH", "jobs.db")


# The LAST table created by SCHEMA — used as the "schema present" sentinel.
# It must be the final CREATE in SCHEMA: if it exists, every earlier table does.
_SCHEMA_SENTINEL = "reconciliation_findings"


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or db_path(), isolation_level="IMMEDIATE")
    conn.row_factory = sqlite3.Row
    # R0: without a busy_timeout, two concurrent IMMEDIATE writers fail INSTANTLY
    # with "database is locked" (an OperationalError that escapes the dedup/guard
    # excepts and 500s the webhook). Make them WAIT for the lock instead.
    # (R5: WAL was dropped — busy_timeout alone fixes the instant-lock, and WAL's
    # persistent -wal/-shm sidecars + Windows mmap-lock + unbounded growth from the
    # per-second SSE long-poll connects weren't worth the marginal read concurrency.)
    conn.execute("PRAGMA busy_timeout=5000")
    # Schema is idempotent (CREATE TABLE IF NOT EXISTS); skip the DDL batch when it's
    # already present to avoid churn. R6: the sentinel is the LAST table, not the
    # 2nd — gating on an early table let a concurrent first-connect observe it
    # mid-`executescript` and skip the rest, then hit "no such table" on a later
    # one. With the last table as sentinel, a racing connection simply re-runs the
    # idempotent DDL (CREATE IF NOT EXISTS, serialized by busy_timeout) — no gap.
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (_SCHEMA_SENTINEL,)
    ).fetchone():
        conn.executescript(SCHEMA)
    return conn


# ── non-guarded write surface (gateway bookkeeping) ─────────────────────────


def record_binding(conn: sqlite3.Connection, head_sha: str, provider: str,
                   orchestrate_id: str, task_group_id: str, repo: str,
                   verifier: str = "ci-trigger") -> bool:
    """D10.4 authenticated SHA→cell binding, recorded at trigger time.
    Returns False if the (sha, provider) binding already exists."""
    try:
        with conn:
            conn.execute(
                "INSERT INTO ci_bindings (head_sha, provider, orchestrate_id, task_group_id, repo, verifier, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (head_sha, provider, orchestrate_id, task_group_id, repo, verifier, _now()),
            )
        return True
    except sqlite3.IntegrityError:
        return False


def lookup_binding(conn: sqlite3.Connection, head_sha: str, provider: str) -> dict | None:
    row = conn.execute(
        "SELECT * FROM ci_bindings WHERE head_sha = ? AND provider = ?", (head_sha, provider)
    ).fetchone()
    return dict(row) if row else None


def delivery_seen(conn: sqlite3.Connection, provider: str, delivery_id: str) -> bool:
    """Read-only check: has this (provider, delivery_id) already been processed?
    The durable mark is made ATOMICALLY with the verdict (R7,
    recorder.record_verdict_with_delivery); this is just the common-case
    short-circuit so a true replay doesn't redo the work."""
    return conn.execute(
        "SELECT 1 FROM webhook_deliveries WHERE provider = ? AND delivery_id = ?",
        (provider, delivery_id),
    ).fetchone() is not None


def record_delivery(conn: sqlite3.Connection, provider: str, delivery_id: str) -> bool:
    """Webhook dedup. Returns False on a replayed delivery id."""
    try:
        with conn:
            conn.execute(
                "INSERT INTO webhook_deliveries (provider, delivery_id, created_at) VALUES (?, ?, ?)",
                (provider, delivery_id, _now()),
            )
        return True
    except sqlite3.IntegrityError:
        return False


def append_event(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str,
                 kind: str, payload: dict | None = None, repo: str = "") -> int:
    with conn:
        cur = conn.execute(
            "INSERT INTO verification_events (orchestrate_id, task_group_id, repo, kind, payload_json, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (orchestrate_id, task_group_id, repo, kind, json.dumps(payload or {}), _now()),
        )
    return cur.lastrowid


# ── reads (the loop reconstructs from these — D10.2 always-fresh) ────────────


def latest_verdicts(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str) -> dict[tuple, dict]:
    """Latest verdict per cell (repo, verifier) — last-writer projection (D10.6)."""
    rows = conn.execute(
        "SELECT * FROM verdicts WHERE orchestrate_id = ? AND task_group_id = ? ORDER BY id",
        (orchestrate_id, task_group_id),
    ).fetchall()
    out: dict[tuple, dict] = {}
    for row in rows:
        out[(row["repo"], row["verifier"])] = dict(row)
    return out


def events_since(conn: sqlite3.Connection, orchestrate_id: str, after_id: int = 0) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM verification_events WHERE orchestrate_id = ? AND id > ? ORDER BY id",
        (orchestrate_id, after_id),
    ).fetchall()
    return [dict(r) for r in rows]


def group_state(conn: sqlite3.Connection, orchestrate_id: str, task_group_id: str) -> str | None:
    row = conn.execute(
        "SELECT state FROM task_group_state WHERE orchestrate_id = ? AND task_group_id = ?",
        (orchestrate_id, task_group_id),
    ).fetchone()
    return row["state"] if row else None


def record_bug(conn: sqlite3.Connection, bug_id: str, bug_type: str, description: str,
               callback_url: str, attachments: list | None = None,
               company: str = "", project: str = "") -> None:
    now = _now()
    with conn:
        conn.execute(
            "INSERT INTO bug_reports (bug_id, bug_type, description, callback_url, attachments_json,"
            " company, project, status, result_json, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', '{}', ?, ?)",
            (bug_id, bug_type, description, callback_url, json.dumps(attachments or []),
             company, project, now, now),
        )


def get_bug(conn: sqlite3.Connection, bug_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM bug_reports WHERE bug_id = ?", (bug_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["attachments"] = json.loads(d.pop("attachments_json") or "[]")
    d["result"] = json.loads(d.pop("result_json") or "{}")
    return d


def update_bug_result(conn: sqlite3.Connection, bug_id: str, status: str, result: dict) -> None:
    with conn:
        conn.execute(
            "UPDATE bug_reports SET status = ?, result_json = ?, updated_at = ? WHERE bug_id = ?",
            (status, json.dumps(result), _now(), bug_id),
        )


def _content_external_id(finding: dict) -> str:
    """R2: a deterministic idempotency key for a finding that carries no
    external_id, so an at-least-once RETRY of the same finding dedups via
    UNIQUE(source, external_id) instead of inserting a duplicate row. Hashes the
    content fields a retry would repeat verbatim."""
    import hashlib

    basis = json.dumps({
        "orchestrate_id": finding.get("orchestrate_id", ""),
        "task_group_id": finding.get("task_group_id", ""),
        "repo": finding.get("repo", ""),
        "kind": finding.get("kind", "bug"),
        "title": str(finding.get("title", "")),
        "detail": finding.get("detail", finding.get("diff", {})),
    }, sort_keys=True, default=str)
    return "sha256:" + hashlib.sha256(basis.encode()).hexdigest()[:32]


def record_finding(conn: sqlite3.Connection, source: str, finding: dict) -> tuple[bool, int | None]:
    """Record one inbound bug/diff. Returns (recorded, row_id|None).
    (False, None) on a duplicate external_id for the source (replay).

    R2: when the caller supplies no external_id, we synthesize a content-hash one
    so a retried identical finding dedups (the reconciliation path's delivery_id is
    optional). Genuinely-distinct findings differ in content and get distinct keys;
    bare/malformed items still record."""
    external_id = finding.get("external_id") or _content_external_id(finding)
    try:
        with conn:
            cur = conn.execute(
                "INSERT INTO reconciliation_findings "
                "(source, external_id, orchestrate_id, task_group_id, repo, kind, title, detail_json, status, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
                (
                    source, external_id,
                    finding.get("orchestrate_id", ""), finding.get("task_group_id", ""),
                    finding.get("repo", ""), finding.get("kind", "bug"),
                    str(finding.get("title", ""))[:500],
                    json.dumps(finding.get("detail", finding.get("diff", {}))),
                    _now(),
                ),
            )
        return True, cur.lastrowid
    except sqlite3.IntegrityError:
        return False, None


def list_findings(conn: sqlite3.Connection, orchestrate_id: str | None = None,
                  status: str | None = None) -> list[dict]:
    sql = "SELECT * FROM reconciliation_findings WHERE 1=1"
    params: list = []
    if orchestrate_id:
        sql += " AND orchestrate_id = ?"
        params.append(orchestrate_id)
    if status:
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY id"
    rows = conn.execute(sql, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["detail"] = json.loads(d.pop("detail_json") or "{}")
        out.append(d)
    return out


def pending_cells_older_than(conn: sqlite3.Connection, cutoff_iso: str) -> list[dict]:
    """Cells whose LATEST verdict is pending and older than the cutoff (D10.5)."""
    rows = conn.execute(
        """
        SELECT v.* FROM verdicts v
        JOIN (SELECT orchestrate_id, task_group_id, repo, verifier, MAX(id) AS mid
              FROM verdicts GROUP BY orchestrate_id, task_group_id, repo, verifier) last
          ON v.id = last.mid
        WHERE v.verdict = 'pending' AND v.created_at < ?
        """,
        (cutoff_iso,),
    ).fetchall()
    return [dict(r) for r in rows]


def pending_cells(conn: sqlite3.Connection) -> list[dict]:
    """Every cell whose LATEST verdict is `pending`, any age — the poll-fallback's
    work-list (D9.1). Same projection as `pending_cells_older_than` without the
    age cutoff."""
    rows = conn.execute(
        """
        SELECT v.* FROM verdicts v
        JOIN (SELECT orchestrate_id, task_group_id, repo, verifier, MAX(id) AS mid
              FROM verdicts GROUP BY orchestrate_id, task_group_id, repo, verifier) last
          ON v.id = last.mid
        WHERE v.verdict = 'pending'
        """,
    ).fetchall()
    return [dict(r) for r in rows]


def binding_for_cell(conn: sqlite3.Connection, orchestrate_id: str,
                     task_group_id: str, repo: str) -> dict | None:
    """The most recent ci_binding recorded for a cell's repo, or None. Lets the
    poll-fallback recover the (provider, head_sha) it needs to query CI."""
    row = conn.execute(
        "SELECT * FROM ci_bindings WHERE orchestrate_id = ? AND task_group_id = ? AND repo = ?"
        " ORDER BY rowid DESC LIMIT 1",
        (orchestrate_id, task_group_id, repo),
    ).fetchone()
    return dict(row) if row else None
