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


def list_runs(conn: sqlite3.Connection) -> list[dict]:
    """Runs with graph events, newest first — the client's run picker."""
    ensure_schema(conn)
    rows = conn.execute(
        "SELECT run_id, MAX(seq) AS last_seq, MAX(created_at) AS last_at,"
        " COUNT(*) AS events FROM graph_events GROUP BY run_id ORDER BY last_seq DESC"
    ).fetchall()
    return [dict(r) for r in rows]


# ── node-ID scheme (spec §Node ID scheme, v1) ────────────────────────────────


def run_root_id(run_id: str) -> str:
    return f"run/{run_id}"


def command_node_id(run_id: str, step: int, command: str) -> str:
    return f"run/{run_id}/command/{step}-{command.strip('/')}"


def group_node_id(run_id: str, spec_name: str) -> str:
    return f"run/{run_id}/group/{spec_name}"


def ci_node_id(run_id: str, spec_name: str, repo: str, sha: str) -> str:
    return f"{group_node_id(run_id, spec_name)}/ci/{repo}/{str(sha)[:7]}"


def cell_node_id(run_id: str, spec_name: str, repo: str, verifier: str) -> str:
    return f"{group_node_id(run_id, spec_name)}/cell/{repo}/{verifier}"


def gate_node_id(run_id: str, spec_name: str) -> str:
    return f"{group_node_id(run_id, spec_name)}/gate"


def attempt_node_id(run_id: str, spec_name: str, repo: str, verifier: str, n: int) -> str:
    return f"{cell_node_id(run_id, spec_name, repo, verifier)}/repair/attempt/{n}"


# ── runtime emitters (D4) — domain-aware helpers over the primitives ─────────
# EVERY graph write in the codebase goes through these (I9). Call sites wrap
# them in try/except-log: the graph is a projection — a failed emission must
# never sink the domain write it mirrors. A missed frame self-heals: structure
# is lazily re-declared (idempotent) and lifecycle is latest-wins.

_VERDICT_TO_STATE = {"pass": "pass", "fail": "fail", "pending": "running",
                     "timeout": "timeout", "skipped": "skipped"}


def emit_run_skeleton(conn: sqlite3.Connection, run_id: str,
                      commands: list[dict], meta: dict | None = None) -> None:
    """Normal-mode run_orchestration start (D4): root + the REAL command
    chain + sequence edges; command 1 running, the rest pending."""
    root = run_root_id(run_id)
    run_meta = {"runtime_model": "current_runtime.v1", **(meta or {})}
    ensure_node(conn, run_id, root, None, "run", f"Run {run_id}", run_meta)
    prev = None
    for c in commands:
        nid = command_node_id(run_id, c["step"], c["command"])
        ensure_node(conn, run_id, nid, root, "command", c["command"],
                    {"step": c["step"], "description": c.get("description", "")})
        if prev:
            ensure_edge(conn, run_id, f"edge/{run_id}/seq-{c['step']}",
                        prev, nid, "sequence")
        set_state(conn, run_id, nid, "running" if c["step"] == 1 else "pending")
        prev = nid
    set_state(conn, run_id, root, "running")


def emit_command_progress(conn: sqlite3.Connection, run_id: str,
                          commands: list[dict], completed_step: int) -> None:
    for c in commands:
        nid = command_node_id(run_id, c["step"], c["command"])
        if c["step"] == completed_step:
            set_state(conn, run_id, nid, "pass")
        elif c["step"] == completed_step + 1:
            set_state(conn, run_id, nid, "running")


def emit_run_completed(conn: sqlite3.Connection, run_id: str, success: bool,
                       detail: dict | None = None) -> None:
    set_state(conn, run_id, run_root_id(run_id), "pass" if success else "fail",
              detail)


def ensure_group(conn: sqlite3.Connection, run_id: str, spec_name: str,
                 meta: dict | None = None) -> str:
    """Lazy group declaration (D2a: spec_as_group). Also lazily roots the run
    (an async re-entry may reach the graph before/without the skeleton)."""
    root = run_root_id(run_id)
    ensure_node(conn, run_id, root, None, "run", f"Run {run_id}",
                {"runtime_model": "current_runtime.v1"})
    gid = group_node_id(run_id, spec_name)
    ensure_node(conn, run_id, gid, root, "group", spec_name,
                {"group_model": "spec_as_group", "spec_name": spec_name,
                 "task_group_id": spec_name, **(meta or {})})
    return gid


def emit_ci_bound(conn: sqlite3.Connection, run_id: str, spec_name: str,
                  repo: str, head_sha: str, source: str = "orchestrate") -> str:
    """_record_ci_binding emission (D4): ci node under the group + binds edge
    + binding evidence. `source="repair"` marks a repair commit's pipeline;
    for repairs run_id/spec are the PARENT's (D2c). Declare-if-absent: a
    later caller (e.g. the inbound webhook lazily rooting the ci node) must
    neither conflict with the original meta nor flip a terminal state back
    to running."""
    gid = ensure_group(conn, run_id, spec_name)
    cid = ci_node_id(run_id, spec_name, repo, head_sha)
    if _declared(conn, run_id, _KIND_NODE, "node_id", cid) is None:
        ensure_node(conn, run_id, cid, gid, "ci", f"{repo} CI {str(head_sha)[:7]}",
                    {"repo": repo, "sha": str(head_sha), "source": source})
        ensure_edge(conn, run_id,
                    f"edge/{run_id}/{spec_name}-to-{cid.split('/ci/')[1]}",
                    gid, cid, "binds")
        set_state(conn, run_id, cid, "running")
        attach_evidence(conn, run_id, cid, "pipeline", f"sha://{head_sha}",
                        "CI binding recorded", {"source": source})
    return cid


def emit_ci_state(conn: sqlite3.Connection, run_id: str, spec_name: str,
                  repo: str, head_sha: str, state: str,
                  detail: dict | None = None) -> None:
    """Inbound CI correlation (D4): the pipeline's terminal state. Declares
    the ci node lazily — a verdict can arrive for a binding recorded before
    graph emission existed."""
    emit_ci_bound(conn, run_id, spec_name, repo, head_sha,
                  (detail or {}).get("source", "orchestrate"))
    set_state(conn, run_id, ci_node_id(run_id, spec_name, repo, head_sha),
              state, detail)


def emit_cell_verdict(conn: sqlite3.Connection, run_id: str, spec_name: str,
                      repo: str, verifier: str, verdict: str, attempt: int,
                      detail: dict | None = None,
                      linked_repair_attempt: int | None = None) -> None:
    """Recorder verdict shim (D4): cell (lazy) + cell─binds→gate + cell state;
    a red verdict also reddens the gate (a green gate is only ever set by
    `advance`, the guarded fold). `linked_repair_attempt` (verdict attempt
    R+1 re-folding open repair attempt R) also advances that attempt node."""
    gid = ensure_group(conn, run_id, spec_name)
    cell = cell_node_id(run_id, spec_name, repo, verifier)
    ensure_node(conn, run_id, cell, gid, "cell", f"{repo} / {verifier}",
                {"repo": repo, "verifier": verifier})
    gate = gate_node_id(run_id, spec_name)
    ensure_node(conn, run_id, gate, gid, "gate", f"gate {spec_name}")
    ensure_edge(conn, run_id, f"edge/{run_id}/{spec_name}-{repo}-{verifier}-gate",
                cell, gate, "binds")
    state = _VERDICT_TO_STATE.get(verdict, "running")
    set_state(conn, run_id, cell, state, {"attempt": attempt, **(detail or {})})
    if state in ("fail", "timeout"):
        set_state(conn, run_id, gate, "fail", {"cell": f"{repo}/{verifier}"})
    if linked_repair_attempt is not None and state in ("pass", "fail", "timeout"):
        att = attempt_node_id(run_id, spec_name, repo, verifier, linked_repair_attempt)
        ensure_node(conn, run_id, att,
                    f"{cell}/repair", "attempt", f"attempt {linked_repair_attempt}")
        set_state(conn, run_id, att, state, {"refolded_by_verdict_attempt": attempt})


def emit_gate_advanced(conn: sqlite3.Connection, run_id: str, spec_name: str,
                       cells: list) -> None:
    """`advance` shim: the guarded green fold — gate AND group go pass."""
    ensure_group(conn, run_id, spec_name)
    gate = gate_node_id(run_id, spec_name)
    ensure_node(conn, run_id, gate, group_node_id(run_id, spec_name),
                "gate", f"gate {spec_name}")
    set_state(conn, run_id, gate, "pass", {"cells": cells})
    set_state(conn, run_id, group_node_id(run_id, spec_name), "pass")


def emit_repair_opened(conn: sqlite3.Connection, run_id: str, spec_name: str,
                       repo: str, verifier: str, attempt: int) -> None:
    """open_repair shim (D4/D6): the AUTHORITATIVE repair-intent declaration —
    it alone has the full cell key. repair node + repair_of edge + attempt
    node (pending, until dispatch marks it running)."""
    gid = ensure_group(conn, run_id, spec_name)
    cell = cell_node_id(run_id, spec_name, repo, verifier)
    ensure_node(conn, run_id, cell, gid, "cell", f"{repo} / {verifier}",
                {"repo": repo, "verifier": verifier})
    repair = f"{cell}/repair"
    ensure_node(conn, run_id, repair, cell, "repair", "repair")
    ensure_edge(conn, run_id, f"edge/{run_id}/{spec_name}-{repo}-{verifier}-repairof",
                repair, cell, "repair_of")
    att = attempt_node_id(run_id, spec_name, repo, verifier, attempt)
    ensure_node(conn, run_id, att, repair, "attempt", f"attempt {attempt}")
    set_state(conn, run_id, att, "pending")


def emit_repair_dispatched(conn: sqlite3.Connection, run_id: str, spec_name: str,
                           repo: str, verifier: str, attempt: int,
                           job_id: str) -> None:
    """Validated enqueue_cli dispatch (D4): attempt running + job evidence."""
    att = attempt_node_id(run_id, spec_name, repo, verifier, attempt)
    set_state(conn, run_id, att, "running",
              {"repair_job_id": job_id, "mode": "repair_orchestration"})
    attach_evidence(conn, run_id, att, "artifact", f"job://{job_id}",
                    "Repair orchestration job", {"job_id": job_id})


def emit_repair_step_evidence(conn: sqlite3.Connection, run_id: str,
                              spec_name: str, repo: str, verifier: str,
                              attempt: int, command: str, state: str) -> None:
    """Repair-mode command progress is EVIDENCE, not command nodes (D10a)."""
    att = attempt_node_id(run_id, spec_name, repo, verifier, attempt)
    attach_evidence(conn, run_id, att, "trace",
                    f"job-step://{command.strip('/')}",
                    f"{command} {state}", {"command": command, "state": state})


def validate_repair_target(conn: sqlite3.Connection,
                           repair_of: dict) -> tuple[bool, str, int | None]:
    """I16/D2b: a repair_of payload may drive cell-scoped emission ONLY if it
    resolves against the authoritative open_repair record. NEVER guess:
    missing keys, no matching repair, or ambiguity (several open attempts,
    none named) all reject. Returns (ok, reason, resolved_attempt)."""
    required = ("orchestrate_id", "task_group_id", "repo", "verifier")
    missing = [k for k in required if not repair_of.get(k)]
    if missing:
        return False, f"repair_of missing keys: {missing}", None
    params = [repair_of["orchestrate_id"], repair_of["task_group_id"],
              repair_of["repo"], repair_of["verifier"]]
    q = ("SELECT attempt FROM repairs WHERE orchestrate_id=? AND task_group_id=?"
         " AND repo=? AND verifier=?")
    if repair_of.get("attempt") is not None:
        q += " AND attempt=?"
        params.append(int(repair_of["attempt"]))
    rows = conn.execute(q + " ORDER BY attempt", params).fetchall()
    if not rows:
        return False, ("no open repair record matches this repair_of target"
                       " — refusing to attach to a guessed cell"), None
    if len(rows) > 1:
        return False, ("ambiguous repair target: several open attempts and"
                       " none named — pass repair_of.attempt"), None
    return True, "validated", rows[0]["attempt"]
