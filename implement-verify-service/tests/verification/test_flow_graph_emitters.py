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


# ── step 6: enqueue_cli contract (D2b/I16) ───────────────────────────────────


@pytest.fixture
def cli_env(tmp_path, monkeypatch):
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    c = fg.connect()
    yield c
    c.close()


def _dispatch_payload(verifier="ci-trigger", **extra):
    repair_of = {"orchestrate_id": RUN, "task_group_id": SPEC, "repo": "app"}
    if verifier is not None:
        repair_of["verifier"] = verifier
    repair_of.update(extra)
    import json as _json
    return _json.dumps({"company": "acme", "project": "demo",
                        "spec_intents": [{"spec_name": f"{SPEC}-repair"}],
                        "repair_of": repair_of})


def _jobs_count():
    import os
    import sqlite3
    con = sqlite3.connect(os.environ["JOBS_DB_PATH"])
    try:
        return con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    except sqlite3.OperationalError:
        return 0
    finally:
        con.close()


def test_enqueue_cli_validated_repair_dispatch(cli_env, capsys):
    from src.job_queue.enqueue_cli import main
    recorder.record_verdict(cli_env, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(cli_env, RUN, SPEC, "app", "ci-trigger", 1)
    rc = main(["orchestration", "--json", _dispatch_payload()])
    out = capsys.readouterr().out
    assert rc == 0 and '"ok": true' in out
    assert _jobs_count() == 1
    import json as _json
    job_id = _json.loads(out.strip().splitlines()[-1])["job_id"]
    snap = fg.snapshot(cli_env, RUN)
    att = fg.attempt_node_id(RUN, SPEC, "app", "ci-trigger", 1)
    assert snap["states"][att]["state"] == "running"
    assert snap["evidence_summary"][att]["latest_by_kind"]["artifact"]["ref"] == \
        f"job://{job_id}"


def test_enqueue_cli_missing_verifier_exit2_nothing_enqueued(cli_env, capsys):
    from src.job_queue.enqueue_cli import main
    rc = main(["orchestration", "--json", _dispatch_payload(verifier=None)])
    assert rc == 2 and "verifier" in capsys.readouterr().out
    assert _jobs_count() == 0


def test_enqueue_cli_unvalidated_target_exit1_nothing_enqueued(cli_env, capsys):
    from src.job_queue.enqueue_cli import main
    recorder.record_verdict(cli_env, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(cli_env, RUN, SPEC, "app", "ci-trigger", 1)
    rc = main(["orchestration", "--json", _dispatch_payload(verifier="rubric")])
    assert rc == 1 and "rejected" in capsys.readouterr().out
    assert _jobs_count() == 0  # fail fast: no job, no graph attach


# ── step 7: inbound CI-correlation emission (real router) ────────────────────


def test_inbound_webhook_emits_ci_node_state(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("JOBS_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.setenv("SX_INGRESS_TOKEN_GITLAB", "tok-1")
    monkeypatch.setenv("SX_WEBHOOK_SECRET_GITLAB", "sec-1")
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    client = TestClient(app)

    conn = fg.connect()
    store.record_binding(conn, "cafe1234beef", "gitlab", RUN, SPEC, "app", "ci-trigger")
    r = client.post("/api/v2/inbound/gitlab/tok-1",
                    json={"object_attributes": {"sha": "cafe1234beef",
                                                "status": "failed"}},
                    headers={"X-Gitlab-Token": "sec-1",
                             "X-Gitlab-Event-UUID": "evt-1"})
    assert r.status_code == 202, r.text
    snap = fg.snapshot(conn, RUN)
    ci = fg.ci_node_id(RUN, SPEC, "app", "cafe1234beef")
    assert snap["states"][ci]["state"] == "fail"          # the pipeline node
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    assert snap["states"][cell]["state"] == "fail"        # via the recorder shim
    conn.close()


# ── regression (found LIVE): skeleton + lazy emitters must interleave ────────


def test_skeleton_then_lazy_emitters_no_conflict(conn):
    """The full-run sequence that broke live: rich-meta skeleton first, then
    lazy ensure_group via recorder/binding emitters — the lazy MINIMAL claim
    must be declare-if-absent, not an I5 conflict."""
    from src.job_queue.tasks import _init_run_graph
    _init_run_graph(RUN, SimpleNamespace(request_payload={}), _fake_request())
    ok, _ = recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    assert ok
    snap = fg.snapshot(conn, RUN)
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    assert snap["states"][cell]["state"] == "fail"          # emission NOT degraded
    assert snap["run"]["meta"]["spec_names"] == [SPEC]       # rich meta preserved


def test_lazy_then_skeleton_and_resume_no_regress(conn):
    """Mirror order (async re-entry roots the run before the skeleton) plus a
    resume: the skeleton must not conflict on the root NOR regress states."""
    from src.job_queue.tasks import _graph_step, _init_run_graph
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "pass")  # lazy root
    ctx = _init_run_graph(RUN, SimpleNamespace(request_payload={}), _fake_request())
    assert ctx is not None                                   # no I5 conflict
    _graph_step(ctx, 1, "Write specification")
    _graph_step(ctx, 2, "Create task list")
    # a re-init (job resume) must keep step 1-2 pass, not reset to pending
    _init_run_graph(RUN, SimpleNamespace(request_payload={}), _fake_request())
    snap = fg.snapshot(conn, RUN)
    assert snap["states"][fg.command_node_id(RUN, 1, "/write-spec")]["state"] == "pass"
    assert snap["states"][fg.command_node_id(RUN, 2, "/create-tasks")]["state"] == "pass"


# ── coverage closures (user: every process step emits) ──────────────────────


def test_verify_job_start_sets_group_running_never_regresses_pass(conn):
    fg.emit_verify_started(conn, RUN, SPEC)
    assert fg.snapshot(conn, RUN)["states"][fg.group_node_id(RUN, SPEC)]["state"] == "running"
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "pass")
    recorder.advance(conn, RUN, SPEC)  # group -> pass
    fg.emit_verify_started(conn, RUN, SPEC)  # drift re-entry must NOT regress
    assert fg.snapshot(conn, RUN)["states"][fg.group_node_id(RUN, SPEC)]["state"] == "pass"


def test_escalate_tool_stamps_park_and_graph(conn):
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    ok, reason = recorder.escalate(conn, RUN, SPEC, "app", "ci-trigger",
                                   "CI demands a deliverable outside the spec")
    assert ok, reason
    assert store.group_state(conn, RUN, SPEC) == "escalated"  # the stamped state
    snap = fg.snapshot(conn, RUN)
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    assert snap["states"][cell]["state"] == "escalated"
    assert snap["states"][fg.group_node_id(RUN, SPEC)]["state"] == "escalated"
    events = [e for e in store.events_since(conn, RUN) if e["kind"] == "escalated"]
    assert len(events) == 1


def test_escalate_refused_on_advanced_group_and_advance_after_escalate(conn):
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "pass")
    recorder.advance(conn, RUN, SPEC)
    ok, reason = recorder.escalate(conn, RUN, SPEC)
    assert not ok and "advanced" in reason  # park cannot contradict terminal pass
    # mirror: an escalated group CAN advance after the human fixes the cause
    recorder.record_verdict(conn, RUN, "spec-b", "app", "ci-trigger", "fail")
    recorder.escalate(conn, RUN, "spec-b", "app", "ci-trigger", "infra outage")
    recorder.record_verdict(conn, RUN, "spec-b", "app", "ci-trigger", "pass")
    ok, reason = recorder.advance(conn, RUN, "spec-b")
    assert ok, reason
    assert store.group_state(conn, RUN, "spec-b") == "advanced"
    # ... and a DOUBLE advance is still refused (the guard survives the upsert)
    ok, reason = recorder.advance(conn, RUN, "spec-b")
    assert not ok and "double advance" in reason


def test_open_repair_cap_refusal_emits_escalated(conn):
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    ok, _ = recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger",
                                 recorder.ATTEMPT_CAP + 1)
    assert not ok
    snap = fg.snapshot(conn, RUN)
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    assert snap["states"][cell]["state"] == "escalated"
    assert snap["states"][f"{cell}/repair"]["state"] == "escalated"


def test_job_cancelled_normal_root_and_repair_attempt(conn):
    from src.job_queue.tasks import _init_run_graph
    _init_run_graph(RUN, SimpleNamespace(request_payload={}), _fake_request())
    fg.emit_job_cancelled(conn, RUN, {})
    assert fg.snapshot(conn, RUN)["states"][f"run/{RUN}"]["state"] == "cancelled"
    # repair job cancel -> attempt cancelled on the PARENT graph
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    fg.emit_job_cancelled(conn, "repair-job-7", {"repair_of": {
        "orchestrate_id": RUN, "task_group_id": SPEC, "repo": "app",
        "verifier": "ci-trigger", "attempt": 1}})
    att = fg.attempt_node_id(RUN, SPEC, "app", "ci-trigger", 1)
    assert fg.snapshot(conn, RUN)["states"][att]["state"] == "cancelled"
    # a job that never declared structure: no-op, no error
    fg.emit_job_cancelled(conn, "ghost-job", {})


def test_normal_step_attaches_log_evidence(conn):
    from src.job_queue.tasks import _graph_step, _init_run_graph
    ctx = _init_run_graph(RUN, SimpleNamespace(request_payload={}), _fake_request())
    _graph_step(ctx, 1, "Write specification")
    nid = fg.command_node_id(RUN, 1, "/write-spec")
    summary = fg.snapshot(conn, RUN)["evidence_summary"][nid]
    assert summary["latest_by_kind"]["log"]["ref"] == f"orchlog://{RUN}/step-1"


# ── reason-run closures F1-F5 (2026-07-03) ───────────────────────────────────


def test_f1_recovery_marks_ghost_root_failed(conn):
    from src.api.recovery import _graph_mark_failed
    from src.job_queue.tasks import _init_run_graph
    _init_run_graph(RUN, SimpleNamespace(request_payload={}), _fake_request())
    assert fg.snapshot(conn, RUN)["states"][f"run/{RUN}"]["state"] == "running"
    _graph_mark_failed(SimpleNamespace(job_id=RUN, request_payload={}),
                       "recovered: no session found to resume")
    st = fg.snapshot(conn, RUN)["states"][f"run/{RUN}"]
    assert st["state"] == "fail" and st["detail"]["recovered"] is True


def test_f1_recovery_repair_job_marks_attempt_not_root(conn):
    from src.api.recovery import _graph_mark_failed
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    recorder.open_repair(conn, RUN, SPEC, "app", "ci-trigger", 1)
    job = SimpleNamespace(job_id="repair-job-x", request_payload={"repair_of": {
        "orchestrate_id": RUN, "task_group_id": SPEC, "repo": "app",
        "verifier": "ci-trigger", "attempt": 1}})
    _graph_mark_failed(job, "recovery failed: boom")
    att = fg.attempt_node_id(RUN, SPEC, "app", "ci-trigger", 1)
    assert fg.snapshot(conn, RUN)["states"][att]["state"] == "fail"
    assert fg.snapshot(conn, "repair-job-x")["nodes"] == []  # no ghost root


def test_f1_recovery_pre_skeleton_job_is_noop(conn):
    from src.api.recovery import _graph_mark_failed
    _graph_mark_failed(SimpleNamespace(job_id="never-started", request_payload={}),
                       "recovered: no orchestration step completed")
    assert fg.snapshot(conn, "never-started")["nodes"] == []  # nothing invented


def test_f4_verify_cancel_reverts_running_to_pending_with_evidence(conn):
    fg.emit_verify_started(conn, RUN, SPEC)
    fg.emit_verify_cancelled(conn, RUN, SPEC, "vjob-1")
    gid = fg.group_node_id(RUN, SPEC)
    snap = fg.snapshot(conn, RUN)
    assert snap["states"][gid]["state"] == "pending"  # honest: awaiting re-entry
    assert snap["evidence_summary"][gid]["latest_by_kind"]["log"]["ref"] == "job://vjob-1"
    # NEVER a terminal: a later re-entry must still work
    fg.emit_verify_started(conn, RUN, SPEC)
    assert fg.snapshot(conn, RUN)["states"][gid]["state"] == "running"


def test_f4_verify_cancel_never_stomps_terminalish_states(conn):
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "pass")
    recorder.advance(conn, RUN, SPEC)  # group pass
    fg.emit_verify_cancelled(conn, RUN, SPEC, "vjob-2")
    assert fg.snapshot(conn, RUN)["states"][fg.group_node_id(RUN, SPEC)]["state"] == "pass"
    fg.emit_verify_cancelled(conn, RUN, "ghost-spec", "vjob-3")  # undeclared: no-op
    assert fg.group_node_id(RUN, "ghost-spec") not in \
        {n["node_id"] for n in fg.snapshot(conn, RUN)["nodes"]}


def test_f2_finding_evidence_only_on_declared_cell(conn):
    # undeclared cell -> refuse (never mint nodes from external input)
    assert fg.emit_finding_evidence(conn, RUN, SPEC, "app", "ci-trigger",
                                    7, "bug", "t") is False
    recorder.record_verdict(conn, RUN, SPEC, "app", "ci-trigger", "fail")
    assert fg.emit_finding_evidence(conn, RUN, SPEC, "app", "ci-trigger",
                                    7, "reconciliation_diff", "drift in /orders") is True
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    ev = fg.snapshot(conn, RUN)["evidence_summary"][cell]
    assert ev["latest_by_kind"]["diff"]["ref"] == "finding://7"  # server-minted


def test_f2_reconciliation_intake_attaches_evidence(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    monkeypatch.setenv("VERIFICATION_DB_PATH", str(tmp_path / "verify.db"))
    monkeypatch.setenv("STANDARDS_API_KEY", "k")
    import src.api.routes.inbound as inbound
    app = FastAPI()
    app.include_router(inbound.router)
    client = TestClient(app)
    c = fg.connect()
    recorder.record_verdict(c, RUN, SPEC, "app", "ci-trigger", "fail")
    r = client.post("/api/v2/reconciliation",
                    json={"source": "haikai-frontend", "findings": [{
                        "kind": "bug", "title": "orders endpoint drops auth header",
                        "orchestrate_id": RUN, "task_group_id": SPEC,
                        "repo": "app", "verifier": "ci-trigger"}]},
                    headers={"Authorization": "Bearer k"})
    assert r.status_code in (200, 202), r.text
    cell = fg.cell_node_id(RUN, SPEC, "app", "ci-trigger")
    ev = fg.snapshot(c, RUN)["evidence_summary"][cell]
    assert any(v["ref"].startswith("finding://") for v in ev["latest_by_kind"].values())
    c.close()


def test_f5_bridge_binding_emits_ci_node(conn):
    from src.connectors.gitlab.verification_bridge import trigger_and_bind
    fake_gl = SimpleNamespace(projects=SimpleNamespace(get=lambda p: SimpleNamespace(
        commits=SimpleNamespace(get=lambda r: SimpleNamespace(id="feedbeef123")))))
    out = trigger_and_bind("grp/app", "main", orchestrate_id=RUN,
                           task_group_id=SPEC, repo="app", gl=fake_gl,
                           conn=conn, fire=False)
    assert out["bound"] is True
    ci = fg.ci_node_id(RUN, SPEC, "app", "feedbeef123")
    snap = fg.snapshot(conn, RUN)
    assert snap["states"][ci]["state"] == "running"  # parity with tasks path
    assert any(e["edge_kind"] == "binds" and e["target"] == ci for e in snap["edges"])


def test_f3_batch_gate_outcome_is_run_root_evidence(conn):
    from src.job_queue.tasks import _graph_gate_evidence, _init_run_graph
    ctx = _init_run_graph(RUN, SimpleNamespace(request_payload={}), _fake_request())
    _graph_gate_evidence(ctx, SPEC, "app", False, 10)
    ev = fg.snapshot(conn, RUN)["evidence_summary"][f"run/{RUN}"]
    latest = ev["latest_by_kind"]["trace"]
    assert latest["ref"] == f"batch-gate://{SPEC}/app"
    assert "FAIL-STOP" in latest["label"]
    # evidence only — no invented structure (D7a)
    kinds = {n["node_kind"] for n in fg.snapshot(conn, RUN)["nodes"]}
    assert kinds == {"run", "command"}
