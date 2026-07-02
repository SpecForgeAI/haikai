"""Run Flow Graph — the sole graph-event API (run_graph.v1, D3).

Spec: haikai/specs/2026-07-02-run-flow-graph/spec.md. Three planes, one
module: STRUCTURE (`graph_node_declared` / `graph_edge_declared`,
append-only, idempotent by natural key — D1/D11), LIFECYCLE
(`graph_node_state_changed`, latest-wins by seq subject to transition
checks — D13/I6), EVIDENCE (`graph_evidence_attached`, referenced never
inlined — D14/I7).

Graph events live in a DEDICATED `graph_events` table in the SAME
verification SQLite store (grill Q4: extra kinds in `verification_events`
would leak raw into every D6 consumer via the pass-through frame mapper,
and the idempotency keys would have nowhere to carry a unique index).
The unique partial indexes below make I4/I5 (idempotent declaration /
conflicting-redeclaration-is-an-error) a DATABASE constraint.

Runtime components emit ONLY through this module (I9) — mirror of the
"only recorder writes the guarded tables" rule. Replay is a v1 invariant
(D7/I8): `snapshot(run_id, at_seq=n)` is a pure fold of graph events with
seq <= n; `fold_events` is exposed so the projector property test can pin
`fold(events[..n]) == snapshot(at_seq=n)` for every prefix.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from src.verification.store import connect as _store_connect  # noqa: F401  (re-export convenience)

PROTOCOL_VERSION = "run_graph.v1"

# D10 (grill Q1): v1 node kinds — the shipped runtime's vocabulary.
NODE_KINDS = ("run", "command", "group", "ci", "cell", "gate", "repair", "attempt")
EDGE_KINDS = ("sequence", "depends_on", "spawns", "repair_of", "binds", "contains")
EVIDENCE_KINDS = ("log", "verdict", "diff", "mr", "pipeline", "trace", "artifact")

# D13: the lifecycle state machine.
STATES = ("pending", "ready", "running", "pass", "fail",
          "skipped", "timeout", "cancelled", "escalated")
# Cells are RE-EVALUABLE (a repair re-fold flips fail→pass; observer drift
# flips pass→fail), so most transitions are legal. Only `cancelled` is
# terminal — an explicit human/system abort does not spontaneously resume.
_TERMINAL_STATES = ("cancelled",)

_KIND_NODE = "graph_node_declared"
_KIND_EDGE = "graph_edge_declared"
_KIND_STATE = "graph_node_state_changed"
_KIND_EVIDENCE = "graph_evidence_attached"

SCHEMA = """
CREATE TABLE IF NOT EXISTS graph_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    node_id TEXT NOT NULL DEFAULT '',
    edge_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    protocol_version TEXT NOT NULL DEFAULT 'run_graph.v1',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gevents_run ON graph_events(run_id, seq);
-- I4/I5 as DB constraints: one declaration per natural key. The partial
-- WHERE keeps state/evidence events (which reuse node_id) out of the index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gevents_node_decl
    ON graph_events(run_id, node_id) WHERE kind = 'graph_node_declared';
CREATE UNIQUE INDEX IF NOT EXISTS uq_gevents_edge_decl
    ON graph_events(run_id, edge_id) WHERE kind = 'graph_edge_declared';
"""


class GraphProtocolError(ValueError):
    """A protocol invariant was violated (I5 conflicting redeclaration,
    unknown kind/state, state for an undeclared node, ...)."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect(path: str | None = None) -> sqlite3.Connection:
    """Open the verification store (same db file, same pragmas) and make
    sure the graph_events schema exists."""
    conn = _store_connect(path)
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    if not conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='graph_events'"
    ).fetchone():
        conn.executescript(SCHEMA)


def _canon(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _append(conn: sqlite3.Connection, run_id: str, kind: str, payload: dict,
            node_id: str = "", edge_id: str = "") -> int:
    ensure_schema(conn)
    with conn:
        cur = conn.execute(
            "INSERT INTO graph_events (run_id, kind, node_id, edge_id, payload_json,"
            " protocol_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (run_id, kind, node_id, edge_id, _canon(payload), PROTOCOL_VERSION, _now()),
        )
    return cur.lastrowid


def _declared(conn: sqlite3.Connection, run_id: str, kind: str,
              key_col: str, key: str) -> sqlite3.Row | None:
    ensure_schema(conn)
    return conn.execute(
        f"SELECT seq, payload_json FROM graph_events"
        f" WHERE run_id = ? AND kind = ? AND {key_col} = ?",
        (run_id, kind, key),
    ).fetchone()


# ── structure plane (D1.1) — append-only, idempotent (D11) ───────────────────


def ensure_run(conn: sqlite3.Connection, run_id: str, meta: dict | None = None) -> int:
    """Declare the run root node `run/{run_id}` (D2). Idempotent."""
    return ensure_node(conn, run_id, f"run/{run_id}", None, "run",
                       f"Run {run_id}", meta)


def ensure_node(conn: sqlite3.Connection, run_id: str, node_id: str,
                parent_id: str | None, node_kind: str, label: str,
                meta: dict | None = None) -> int:
    """Declare a node. Same key + same payload = no-op (returns the original
    seq); same key + CONFLICTING payload = GraphProtocolError (I4/I5)."""
    if node_kind not in NODE_KINDS:
        raise GraphProtocolError(f"unknown node_kind {node_kind!r} (v1: {NODE_KINDS})")
    if not node_id:
        raise GraphProtocolError("node_id is required")
    payload = {"node_id": node_id, "parent_id": parent_id,
               "node_kind": node_kind, "label": label, "meta": meta or {}}
    existing = _declared(conn, run_id, _KIND_NODE, "node_id", node_id)
    if existing is None:
        try:
            return _append(conn, run_id, _KIND_NODE, payload, node_id=node_id)
        except sqlite3.IntegrityError:
            # Raced with an interleaved emitter (D11 expects this) — re-read.
            existing = _declared(conn, run_id, _KIND_NODE, "node_id", node_id)
    if existing["payload_json"] == _canon(payload):
        return existing["seq"]
    raise GraphProtocolError(
        f"conflicting redeclaration of node {node_id!r} in run {run_id!r} (I5)")


def ensure_edge(conn: sqlite3.Connection, run_id: str, edge_id: str,
                source: str, target: str, edge_kind: str,
                meta: dict | None = None) -> int:
    """Declare an edge between two ALREADY-DECLARED nodes. Idempotency and
    conflict semantics identical to ensure_node."""
    if edge_kind not in EDGE_KINDS:
        raise GraphProtocolError(f"unknown edge_kind {edge_kind!r} (v1: {EDGE_KINDS})")
    if not edge_id:
        raise GraphProtocolError("edge_id is required")
    for endpoint in (source, target):
        if _declared(conn, run_id, _KIND_NODE, "node_id", endpoint) is None:
            raise GraphProtocolError(
                f"edge {edge_id!r} references undeclared node {endpoint!r}"
                f" — emitters declare nodes before edges")
    payload = {"edge_id": edge_id, "source": source, "target": target,
               "edge_kind": edge_kind, "meta": meta or {}}
    existing = _declared(conn, run_id, _KIND_EDGE, "edge_id", edge_id)
    if existing is None:
        try:
            return _append(conn, run_id, _KIND_EDGE, payload, edge_id=edge_id)
        except sqlite3.IntegrityError:
            existing = _declared(conn, run_id, _KIND_EDGE, "edge_id", edge_id)
    if existing["payload_json"] == _canon(payload):
        return existing["seq"]
    raise GraphProtocolError(
        f"conflicting redeclaration of edge {edge_id!r} in run {run_id!r} (I5)")


# ── lifecycle plane (D1.2, D13) ──────────────────────────────────────────────


def set_state(conn: sqlite3.Connection, run_id: str, node_id: str,
              state: str, detail: dict | None = None) -> int | None:
    """Advance a node's lifecycle state. Latest-wins by seq (I6).
    Rules: node must be declared; `state` must be a D13 state; transitions
    OUT of a terminal state are protocol errors; an exact repeat
    (same state AND same detail) is a no-op returning None."""
    if state not in STATES:
        raise GraphProtocolError(f"unknown state {state!r} (D13: {STATES})")
    if _declared(conn, run_id, _KIND_NODE, "node_id", node_id) is None:
        raise GraphProtocolError(
            f"state for undeclared node {node_id!r} — declare first (D11)")
    payload = {"node_id": node_id, "state": state, "detail": detail or {}}
    row = conn.execute(
        "SELECT payload_json FROM graph_events WHERE run_id = ? AND kind = ?"
        " AND node_id = ? ORDER BY seq DESC LIMIT 1",
        (run_id, _KIND_STATE, node_id),
    ).fetchone()
    if row:
        prev = json.loads(row["payload_json"])
        if prev == payload:
            return None  # exact repeat — append-only noise suppressed
        if prev["state"] in _TERMINAL_STATES and state != prev["state"]:
            raise GraphProtocolError(
                f"illegal transition {prev['state']} -> {state} for {node_id!r}")
    return _append(conn, run_id, _KIND_STATE, payload, node_id=node_id)


# ── evidence plane (D1.3, D14) — append-only refs, never blobs ───────────────


def attach_evidence(conn: sqlite3.Connection, run_id: str, node_id: str,
                    evidence_kind: str, ref: str, label: str | None = None,
                    meta: dict | None = None) -> int:
    if evidence_kind not in EVIDENCE_KINDS:
        raise GraphProtocolError(
            f"unknown evidence_kind {evidence_kind!r} (v1: {EVIDENCE_KINDS})")
    if not ref:
        raise GraphProtocolError("evidence ref is required (I7: referenced, not inlined)")
    if _declared(conn, run_id, _KIND_NODE, "node_id", node_id) is None:
        raise GraphProtocolError(
            f"evidence for undeclared node {node_id!r} — declare first (D11)")
    payload = {"node_id": node_id, "evidence_kind": evidence_kind,
               "ref": ref, "label": label or "", "meta": meta or {}}
    return _append(conn, run_id, _KIND_EVIDENCE, payload, node_id=node_id)


# ── projection (D7/I8: snapshot == pure fold; D14: evidence summarised) ──────


def events_since(conn: sqlite3.Connection, run_id: str, from_seq: int = 0) -> list[dict]:
    """Envelope rows (D12) for the SSE stream / the property test."""
    ensure_schema(conn)
    rows = conn.execute(
        "SELECT * FROM graph_events WHERE run_id = ? AND seq > ? ORDER BY seq",
        (run_id, from_seq),
    ).fetchall()
    return [
        {"protocol_version": r["protocol_version"], "run_id": r["run_id"],
         "seq": r["seq"], "event_time": r["created_at"], "kind": r["kind"],
         "payload": json.loads(r["payload_json"])}
        for r in rows
    ]


def fold_events(run_id: str, events: list[dict]) -> dict:
    """THE pure fold (I8). `snapshot` is exactly this over the db read —
    exposed separately so the D7 property test can pin
    fold(events[..n]) == snapshot(at_seq=n) for every prefix."""
    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}
    states: dict[str, dict] = {}
    evidence: dict[str, dict] = {}
    seq = 0
    for ev in events:
        seq = max(seq, ev["seq"])
        p = ev["payload"]
        kind = ev["kind"]
        if kind == _KIND_NODE:
            nodes[p["node_id"]] = {**p, "declared_seq": ev["seq"]}
        elif kind == _KIND_EDGE:
            edges[p["edge_id"]] = {**p, "declared_seq": ev["seq"]}
        elif kind == _KIND_STATE:
            states[p["node_id"]] = {"state": p["state"], "detail": p["detail"],
                                    "seq": ev["seq"]}
        elif kind == _KIND_EVIDENCE:
            summary = evidence.setdefault(
                p["node_id"], {"counts_by_kind": {}, "latest_by_kind": {}})
            ek = p["evidence_kind"]
            summary["counts_by_kind"][ek] = summary["counts_by_kind"].get(ek, 0) + 1
            summary["latest_by_kind"][ek] = {"ref": p["ref"], "label": p["label"],
                                             "seq": ev["seq"]}
        # unknown kinds are ignored by the fold: forward-compatible readers
    root_id = f"run/{run_id}"
    root = nodes.get(root_id)
    return {
        "run": {"run_id": run_id, "root_node_id": root_id,
                "meta": (root or {}).get("meta", {})},
        "seq": seq,
        "nodes": sorted(nodes.values(), key=lambda n: n["declared_seq"]),
        "edges": sorted(edges.values(), key=lambda e: e["declared_seq"]),
        "states": states,
        "evidence_summary": evidence,
    }


def snapshot(conn: sqlite3.Connection, run_id: str, at_seq: int | None = None) -> dict:
    """Graph state at `at_seq` (default: latest) — a pure fold, no
    out-of-band state (I8)."""
    events = events_since(conn, run_id, 0)
    if at_seq is not None:
        events = [e for e in events if e["seq"] <= at_seq]
    return fold_events(run_id, events)
