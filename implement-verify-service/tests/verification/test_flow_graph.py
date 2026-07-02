"""Run Flow Graph — flow_graph.py protocol + THE projector property test (D7).

Real sqlite (tmp file), no mocks at the seam. Covers: idempotent structure
declarations with conflict-is-error (D11/I4/I5), lifecycle transition checks
(D13/I6), evidence refs + snapshot summaries (D14/I7), per-run isolation,
from_seq resume, and the core replay invariant —
fold(events[..n]) == snapshot(run_id, at_seq=n) for EVERY prefix (I8).
"""

import pytest

from src.verification import flow_graph as fg


@pytest.fixture
def conn(tmp_path):
    c = fg.connect(str(tmp_path / "verify.db"))
    yield c
    c.close()


RUN = "orch-123"


def _declare_min(conn):
    fg.ensure_run(conn, RUN, meta={"runtime_model": "current_runtime.v1"})
    fg.ensure_node(conn, RUN, f"run/{RUN}/group/spec-a", f"run/{RUN}",
                   "group", "spec-a", {"group_model": "spec_as_group"})


# ── structure plane ──────────────────────────────────────────────────────────


def test_ensure_node_idempotent_same_payload_noop(conn):
    seq1 = fg.ensure_run(conn, RUN)
    seq2 = fg.ensure_run(conn, RUN)
    assert seq1 == seq2  # no-op returns the ORIGINAL seq (I4)
    assert len(fg.events_since(conn, RUN)) == 1  # nothing appended


def test_ensure_node_conflicting_redeclaration_is_protocol_error(conn):
    fg.ensure_run(conn, RUN)
    with pytest.raises(fg.GraphProtocolError, match="conflicting"):
        fg.ensure_node(conn, RUN, f"run/{RUN}", None, "run", "DIFFERENT LABEL")


def test_ensure_node_rejects_unknown_kind(conn):
    with pytest.raises(fg.GraphProtocolError, match="node_kind"):
        fg.ensure_node(conn, RUN, "run/x", None, "phase", "nope")  # v1 dropped 'phase'


def test_ensure_edge_requires_declared_endpoints(conn):
    fg.ensure_run(conn, RUN)
    with pytest.raises(fg.GraphProtocolError, match="undeclared node"):
        fg.ensure_edge(conn, RUN, "e1", f"run/{RUN}", "run/ghost", "sequence")


def test_ensure_edge_idempotent_and_conflict(conn):
    _declare_min(conn)
    args = (conn, RUN, "e1", f"run/{RUN}", f"run/{RUN}/group/spec-a", "spawns")
    assert fg.ensure_edge(*args) == fg.ensure_edge(*args)
    with pytest.raises(fg.GraphProtocolError, match="conflicting"):
        fg.ensure_edge(conn, RUN, "e1", f"run/{RUN}",
                       f"run/{RUN}/group/spec-a", "binds")


def test_runs_are_isolated_natural_keys(conn):
    # same node_id in two runs must NOT collide (key = run_id + node_id)
    fg.ensure_node(conn, "run-a", "run/run-a", None, "run", "A")
    fg.ensure_node(conn, "run-b", "run/run-b", None, "run", "B")
    fg.ensure_node(conn, "run-a", "shared/x", "run/run-a", "cell", "x")
    fg.ensure_node(conn, "run-b", "shared/x", "run/run-b", "cell", "x")
    assert len(fg.events_since(conn, "run-a")) == 2
    assert len(fg.events_since(conn, "run-b")) == 2


# ── lifecycle plane ──────────────────────────────────────────────────────────


def test_set_state_requires_declared_node(conn):
    with pytest.raises(fg.GraphProtocolError, match="undeclared"):
        fg.set_state(conn, RUN, "run/ghost", "running")


def test_set_state_unknown_state_rejected(conn):
    _declare_min(conn)
    with pytest.raises(fg.GraphProtocolError, match="infra_fail"):
        fg.set_state(conn, RUN, f"run/{RUN}", "infra_fail")  # D13: taxonomy != state


def test_set_state_exact_repeat_is_noop(conn):
    _declare_min(conn)
    assert fg.set_state(conn, RUN, f"run/{RUN}", "running") is not None
    assert fg.set_state(conn, RUN, f"run/{RUN}", "running") is None
    # ... but a detail change is a legitimate new event
    assert fg.set_state(conn, RUN, f"run/{RUN}", "running", {"attempt": 2}) is not None


def test_reevaluable_transitions_allowed_fail_to_pass(conn):
    # repair re-fold (fail→pass) and observer drift (pass→fail) are legal
    _declare_min(conn)
    node = f"run/{RUN}/group/spec-a"
    fg.set_state(conn, RUN, node, "fail", {"classification": "real"})
    fg.set_state(conn, RUN, node, "pass")
    fg.set_state(conn, RUN, node, "fail")
    assert fg.snapshot(conn, RUN)["states"][node]["state"] == "fail"  # latest-wins


def test_cancelled_is_terminal(conn):
    _declare_min(conn)
    fg.set_state(conn, RUN, f"run/{RUN}", "cancelled")
    with pytest.raises(fg.GraphProtocolError, match="illegal transition"):
        fg.set_state(conn, RUN, f"run/{RUN}", "running")


# ── evidence plane ───────────────────────────────────────────────────────────


def test_evidence_requires_ref_kind_and_declared_node(conn):
    _declare_min(conn)
    with pytest.raises(fg.GraphProtocolError, match="evidence_kind"):
        fg.attach_evidence(conn, RUN, f"run/{RUN}", "screenshot", "x://y")
    with pytest.raises(fg.GraphProtocolError, match="ref is required"):
        fg.attach_evidence(conn, RUN, f"run/{RUN}", "log", "")
    with pytest.raises(fg.GraphProtocolError, match="undeclared"):
        fg.attach_evidence(conn, RUN, "run/ghost", "log", "x://y")


def test_snapshot_summarises_evidence_not_history(conn):
    _declare_min(conn)
    node = f"run/{RUN}/group/spec-a"
    fg.attach_evidence(conn, RUN, node, "log", "log://1", "first")
    fg.attach_evidence(conn, RUN, node, "log", "log://2", "second")
    fg.attach_evidence(conn, RUN, node, "verdict", "event://9", "v")
    summary = fg.snapshot(conn, RUN)["evidence_summary"][node]
    assert summary["counts_by_kind"] == {"log": 2, "verdict": 1}
    assert summary["latest_by_kind"]["log"]["ref"] == "log://2"  # latest, not all


# ── a realistic synthetic run (the D7 property-test substrate) ───────────────


def _emit_full_run(conn):
    """Root → 4-command chain → group → ci → cells → gate → fail →
    repair + attempt → repair ci → re-fold pass. Mirrors the spec's v1
    shape incl. the dynamic repair mutation and the fail→pass re-fold."""
    run_root = f"run/{RUN}"
    fg.ensure_run(conn, RUN, {"runtime_model": "current_runtime.v1",
                              "spec_names": ["spec-a"]})
    commands = ["1-write-spec", "2-create-tasks",
                "3-implement-tasks", "4-git-commit-preparation"]
    prev = None
    for c in commands:
        nid = f"{run_root}/command/{c}"
        fg.ensure_node(conn, RUN, nid, run_root, "command", f"/{c[2:]}")
        if prev:
            fg.ensure_edge(conn, RUN, f"edge/{RUN}/{prev.split('/')[-1]}-to-{c}",
                           prev, nid, "sequence")
        fg.set_state(conn, RUN, nid, "running")
        fg.set_state(conn, RUN, nid, "pass")
        prev = nid

    group = f"{run_root}/group/spec-a"
    fg.ensure_node(conn, RUN, group, run_root, "group", "spec-a",
                   {"group_model": "spec_as_group"})
    fg.ensure_edge(conn, RUN, f"edge/{RUN}/commit-to-group", prev, group, "spawns")

    ci = f"{group}/ci/repo-a/abc1234"
    fg.ensure_node(conn, RUN, ci, group, "ci", "repo-a CI abc1234")
    fg.ensure_edge(conn, RUN, f"edge/{RUN}/group-to-ci", group, ci, "binds")
    fg.set_state(conn, RUN, ci, "running")

    cell = f"{group}/cell/repo-a/ci-trigger"
    fg.ensure_node(conn, RUN, cell, group, "cell", "repo-a / ci-trigger")
    fg.ensure_edge(conn, RUN, f"edge/{RUN}/ci-to-cell", ci, cell, "spawns")
    gate = f"{group}/gate"
    fg.ensure_node(conn, RUN, gate, group, "gate", "gate spec-a")
    fg.ensure_edge(conn, RUN, f"edge/{RUN}/cell-to-gate", cell, gate, "binds")

    fg.set_state(conn, RUN, ci, "fail")
    fg.set_state(conn, RUN, cell, "fail",
                 {"classification": "real", "repairable": True})
    fg.set_state(conn, RUN, gate, "fail")
    fg.attach_evidence(conn, RUN, cell, "verdict", "event://verification/1",
                       "ci-trigger fail attempt 1")

    # dynamic repair mutation — late structure is normal protocol (D5)
    repair = f"{cell}/repair"
    attempt = f"{repair}/attempt/1"
    fg.ensure_node(conn, RUN, repair, cell, "repair", "repair")
    fg.ensure_edge(conn, RUN, f"edge/{RUN}/repair-of", repair, cell, "repair_of")
    fg.ensure_node(conn, RUN, attempt, repair, "attempt", "attempt 1")
    fg.set_state(conn, RUN, attempt, "running",
                 {"repair_job_id": "job-456", "mode": "repair_orchestration"})
    fg.attach_evidence(conn, RUN, attempt, "artifact", "job://job-456",
                       "Repair orchestration job")

    repair_ci = f"{group}/ci/repo-a/def5678"
    fg.ensure_node(conn, RUN, repair_ci, group, "ci", "repo-a CI def5678",
                   {"source": "repair"})
    fg.ensure_edge(conn, RUN, f"edge/{RUN}/attempt-to-repair-ci",
                   attempt, repair_ci, "binds", {"reason": "repair_commit_ci"})
    fg.set_state(conn, RUN, repair_ci, "pass")
    fg.set_state(conn, RUN, attempt, "pass")
    fg.set_state(conn, RUN, cell, "pass", {"attempt": 2})  # the re-fold
    fg.set_state(conn, RUN, gate, "pass")
    fg.attach_evidence(conn, RUN, cell, "verdict", "event://verification/2",
                       "ci-trigger pass attempt 2")


def test_property_fold_prefix_equals_snapshot_at_seq(conn):
    """THE D7 invariant: for every prefix n of the run's event stream,
    fold(events[..n]) == snapshot(run_id, at_seq=seq_n). No out-of-band
    state may exist for this to hold at EVERY prefix, including mid-repair."""
    _emit_full_run(conn)
    events = fg.events_since(conn, RUN)
    assert len(events) > 25  # a real spread across all three planes
    for n in range(len(events) + 1):
        prefix = events[:n]
        at_seq = prefix[-1]["seq"] if prefix else 0
        assert fg.fold_events(RUN, prefix) == fg.snapshot(conn, RUN, at_seq=at_seq), (
            f"fold/snapshot divergence at prefix {n}")


def test_snapshot_latest_equals_full_fold_and_shape(conn):
    _emit_full_run(conn)
    snap = fg.snapshot(conn, RUN)
    assert snap["run"]["root_node_id"] == f"run/{RUN}"
    assert snap["run"]["meta"]["runtime_model"] == "current_runtime.v1"
    node_ids = {n["node_id"] for n in snap["nodes"]}
    assert f"run/{RUN}/group/spec-a/cell/repo-a/ci-trigger/repair/attempt/1" in node_ids
    assert snap["states"][f"run/{RUN}/group/spec-a/gate"]["state"] == "pass"
    assert snap["seq"] == fg.events_since(conn, RUN)[-1]["seq"]


def test_events_since_from_seq_resume(conn):
    _emit_full_run(conn)
    events = fg.events_since(conn, RUN)
    mid = events[len(events) // 2]["seq"]
    tail = fg.events_since(conn, RUN, from_seq=mid)
    assert [e["seq"] for e in tail] == [e["seq"] for e in events if e["seq"] > mid]
    assert all(e["protocol_version"] == fg.PROTOCOL_VERSION for e in tail)
