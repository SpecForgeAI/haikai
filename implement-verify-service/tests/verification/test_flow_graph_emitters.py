"""Run-flow-graph runtime emitters (spec steps 3-5) — recorder shims,
_record_ci_binding, and run_orchestration's mode-aware graph context.

Real sqlite; the REAL emitter code paths (no raw graph inserts). Also carries
the I9 guard: zero graph_events writers outside flow_graph.py (count==0 per
the CLAUDE.md helper-exists-sibling-missed rule).
"""

from pathlib import Path
from types import SimpleNamespace

import pytest

from src.verification import flow_graph as fg
from src.verification import recorder, store

RUN = "orch-e2e"
SPEC = "add-numbers"


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    c = fg.connect()
    yield c
    c.close()


# ── step 5: recorder guarded-write shims ─────────────────────────────────────


def test_record_verdict_emits_cell_and_reddens_gate(conn):
    ok, _ = recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    assert ok
    snap = fg.snapshot(conn, RUN)
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    assert snap["states"][cell]["state"] == "fail"
    assert snap["states"][fg.gate_node_id(RUN, SPEC)]["state"] == "fail"
    kinds = {n["node_id"]: n["node_kind"] for n in snap["nodes"]}
    assert kinds[fg.group_node_id(RUN, SPEC)] == "group"  # lazy group + root
    assert kinds[f"run/{RUN}"] == "run"


def test_record_verdict_with_delivery_emits(conn):
    status, _ = recorder.record_verdict_with_delivery(
        conn, RUN, SPEC, "app", "ci-trigger", "pass",
        provider="gitlab", delivery="d-1")
    assert status == "recorded"
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    assert fg.snapshot(conn, RUN)["states"][cell]["state"] == "pass"


def test_advance_emits_green_gate_and_group(conn):
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "pass")
    ok, _ = recorder.advance(conn, RUN, SPEC)
    assert ok
    snap = fg.snapshot(conn, RUN)
    assert snap["states"][fg.gate_node_id(RUN, SPEC)]["state"] == "pass"
    assert snap["states"][fg.group_node_id(RUN, SPEC)]["state"] == "pass"


def test_open_repair_emits_authoritative_repair_and_attempt(conn):
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    ok, _ = recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    assert ok
    snap = fg.snapshot(conn, RUN)
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    att = fg.attempt_node_id(RUN, SPEC, "app", "ci-trigger", 1)
    kinds = {n["node_id"]: n["node_kind"] for n in snap["nodes"]}
    assert kinds[f"{cell}/repair"] == "repair"
    assert kinds[att] == "attempt"
    edge_kinds = {e["edge_id"]: e["edge_kind"] for e in snap["edges"]}
    assert "repair_of" in edge_kinds.values()
    assert snap["states"][att]["state"] == "pending"


def test_refold_verdict_advances_linked_attempt(conn):
    """fail(1) -> open_repair(1) -> pass(attempt 2) re-folds attempt/1 to pass."""
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "pass")  # attempt 2
    snap = fg.snapshot(conn, RUN)
    att = fg.attempt_node_id(RUN, SPEC, "app", "ci-trigger", 1)
    assert snap["states"][att]["state"] == "pass"
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    assert snap["states"][cell]["state"] == "pass"


# ── step 4: _record_ci_binding emission ──────────────────────────────────────


def _bind(monkeypatch, sha, source="orchestrate"):
    from src.job_queue.tasks import _record_ci_binding
    monkeypatch.setenv("ORCHESTRATE_CI_BIND", "true")
    _record_ci_binding(SimpleNamespace(provider="gitlab"), RUN, SPEC, "app",
                       sha, source=source)


def test_ci_binding_emits_ci_node_and_edge(conn, monkeypatch):
    _bind(monkeypatch, "abc1234def")
    snap = fg.snapshot(conn, RUN)
    ci = fg.ci_node_id(RUN, SPEC, "app", "abc1234def")
    assert snap["states"][ci]["state"] == "running"
    assert any(e["edge_kind"] == "binds" and e["target"] == ci for e in snap["edges"])
    assert snap["evidence_summary"][ci]["counts_by_kind"]["pipeline"] == 1


def test_repair_ci_binding_marks_source_repair(conn, monkeypatch):
    _bind(monkeypatch, "def5678abc", source="repair")
    snap = fg.snapshot(conn, RUN)
    ci_meta = {n["node_id"]: n["meta"] for n in snap["nodes"]}
    assert ci_meta[fg.ci_node_id(RUN, SPEC, "app", "def5678abc")]["source"] == "repair"


# ── step 3: run_orchestration mode-aware context ─────────────────────────────


def _fake_request():
    return SimpleNamespace(company="acme", project="demo",
                           spec_intents=[SimpleNamespace(spec_name=SPEC)])


def test_init_run_graph_normal_emits_skeleton(conn):
    from src.job_queue.tasks import _graph_completed, _graph_step, _init_run_graph
    job = SimpleNamespace(request_payload={})
    ctx = _init_run_graph(RUN, job, _fake_request())
    assert ctx == {"mode": "normal", "run_id": RUN, "commands": ctx["commands"]}
    snap = fg.snapshot(conn, RUN)
    commands = [n for n in snap["nodes"] if n["node_kind"] == "command"]
    assert len(commands) == 4  # the REAL chain (grill Q1), sequence-edged
    assert sum(1 for e in snap["edges"] if e["edge_kind"] == "sequence") == 3
    assert snap["run"]["meta"]["runtime_model"] == "current_runtime.v1"
    first = fg.command_node_id(RUN, 1, "/write-spec")
    assert snap["states"][first]["state"] == "running"

    _graph_step(ctx, 1, "Write specification")
    snap = fg.snapshot(conn, RUN)
    assert snap["states"][first]["state"] == "pass"
    second = fg.command_node_id(RUN, 2, "/create-tasks")
    assert snap["states"][second]["state"] == "running"

    _graph_completed(ctx, True)
    assert fg.snapshot(conn, RUN)["states"][f"run/{RUN}"]["state"] == "pass"


def test_init_run_graph_repair_mode_attaches_no_new_root(conn):
    """D2c: a validated repair job attaches to the PARENT graph; the repair
    job id NEVER becomes a visible run root."""
    from src.job_queue.tasks import _graph_step, _init_run_graph
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    repair_job = "repair-job-999"
    job = SimpleNamespace(request_payload={"repair_of": {
        "orchestrate_id": RUN, "task_group_id": SPEC,
        "repo": "app", "verifier": "ci-trigger"}})
    ctx = _init_run_graph(repair_job, job, _fake_request())
    assert ctx["mode"] == "repair" and ctx["attempt"] == 1
    assert fg.snapshot(conn, repair_job)["nodes"] == []  # NO new root graph
    snap = fg.snapshot(conn, RUN)
    att = fg.attempt_node_id(RUN, SPEC, "app", "ci-trigger", 1)
    assert snap["states"][att]["state"] == "running"
    assert snap["evidence_summary"][att]["latest_by_kind"]["artifact"]["ref"] == \
        f"job://{repair_job}"
    _graph_step(ctx, 3, "Implement all tasks")  # repair steps = evidence (D10a)
    summary = fg.snapshot(conn, RUN)["evidence_summary"][att]
    assert summary["counts_by_kind"]["trace"] == 1


def test_init_run_graph_invalid_repair_of_rejected_never_guesses(conn):
    """I16: unknown verifier -> reject; no attach, no new root, no guessing."""
    from src.job_queue.tasks import _init_run_graph
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    before = len(fg.events_since(conn, RUN))
    job = SimpleNamespace(request_payload={"repair_of": {
        "orchestrate_id": RUN, "task_group_id": SPEC,
        "repo": "app", "verifier": "rubric"}})  # WRONG verifier
    assert _init_run_graph("repair-job-x", job, _fake_request()) is None
    assert len(fg.events_since(conn, RUN)) == before  # nothing attached
    assert fg.snapshot(conn, "repair-job-x")["nodes"] == []


def test_validate_repair_target_rules(conn):
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    ok, _, att = fg.validate_repair_target(conn, {
        "orchestrate_id": RUN, "task_group_id": SPEC,
        "repo": "app", "verifier": "ci-trigger"})
    assert ok and att == 1
    ok, reason, _ = fg.validate_repair_target(conn, {
        "orchestrate_id": RUN, "task_group_id": SPEC, "repo": "app"})
    assert not ok and "missing" in reason
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 2)
    ok, reason, _ = fg.validate_repair_target(conn, {
        "orchestrate_id": RUN, "task_group_id": SPEC,
        "repo": "app", "verifier": "ci-trigger"})
    assert not ok and "ambiguous" in reason  # two attempts, none named
    ok, _, att = fg.validate_repair_target(conn, {
        "orchestrate_id": RUN, "task_group_id": SPEC,
        "repo": "app", "verifier": "ci-trigger", "attempt": 2})
    assert ok and att == 2


# ── I9 guard: flow_graph.py is the ONLY graph_events writer ─────────────────


def test_guard_zero_graph_event_writers_outside_flow_graph():
    src = Path(__file__).resolve().parents[2] / "src"
    offenders = []
    for py in src.rglob("*.py"):
        if py.name == "flow_graph.py":
            continue
        text = py.read_text(encoding="utf-8", errors="replace")
        if "INSERT INTO graph_events" in text or "graph_events (" in text:
            offenders.append(str(py))
    assert offenders == []  # count==0, never >=N (CLAUDE.md guard rule)
