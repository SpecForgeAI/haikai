"""Parallel-worktrees S4/S5 â€” run_orchestration in worktree mode.

Real git repos + real allocator; only the LLM step and session plumbing are
stubbed (same harness pattern as the batch gate e2e). Covers: W1 (live tree
untouched), overlay-workspace allocation, F10 guard (durable logs outside the
worktree), reclamation (zero leftovers), the WORKTREE_RUNS=off escape, and
D1 per-spec parallel mode with independent failure semantics.
"""
from __future__ import annotations

import os
import types
from pathlib import Path

import src.haikai_orchestrator as orch_mod
import src.job_queue.tasks as tasks
from src.git.worktree_runs import run_key as wr_run_key
from src.chat.session_store import create_active_session
from src.haikai_models import (OrchestrationOptions, OrchestrationRequest,
                               StepResult)
from src.haikai_orchestrator import HaikaiOrchestrator
from src.job_queue.job_models import Job, JobStatus, JobType
from src.job_queue.job_storage import JobStorage
from tests._realgit import local_repo_with_base, run_git, set_git_env


def _harness(tmp_path, monkeypatch, specs, fail_specs=()):
    """Workspace + single-repo product + stubbed LLM steps. The step stub
    writes into self.project_dir â€” exactly where the real CLI session (cwd)
    writes â€” so worktree mode is exercised for real."""
    set_git_env(monkeypatch, auto_push=False, auto_pr=False)
    ws = (tmp_path / "ws").resolve()
    (ws / "acme").mkdir(parents=True)
    monkeypatch.setenv("API_WORKSPACE_DIR", str(ws))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.delenv("ORCHESTRATION_LOG_DIR", raising=False)

    product = ws / "acme" / "shop"
    local_repo_with_base(product)
    for s in specs:
        planning = product / "haikai" / "specs" / s / "planning"
        planning.mkdir(parents=True)
        (planning / "requirements.md").write_text("# req\n")
        (planning / "initialization.md").write_text("# init\n")
    create_active_session(ws, "acme", "shop")

    def _step(self, chat_executor, step, command, spec_name, is_new_session=False):
        # Worktree runs must start step 1 FRESH in the worktree (a resumed
        # shape-spec session is anchored to the live tree). Legacy live-tree
        # runs (no "/wt/" in the workspace) keep resuming, so gate the check on
        # actually being in a worktree.
        if step == 1 and "/wt/" in str(self.workspace_dir).replace("\\", "/"):
            assert is_new_session, (
                "worktree run did not start /write-spec fresh "
                "(is_new_session=False) — it would resume the live-tree session")
        if spec_name in fail_specs and step == 3:
            raise RuntimeError(f"injected failure for {spec_name}")
        if step == 3:
            (Path(self.project_dir) / f"{spec_name}.txt").write_text(f"impl {spec_name}\n")
        return StepResult(step=step, command=command, status="success",
                          output_paths=[], execution_time_seconds=0.0,
                          log_file="stub.log")

    monkeypatch.setattr(HaikaiOrchestrator, "_execute_step_with_session", _step)
    monkeypatch.setattr(orch_mod, "_build_chat_executor",
                        lambda **kw: types.SimpleNamespace(session_uuid="s"))
    monkeypatch.setattr(tasks, "_restore_session", lambda *a, **k: None)

    storage = JobStorage(str(tmp_path / "jobs.db"))
    req = OrchestrationRequest(
        company="acme", project="shop",
        spec_intents=[{"spec_name": s} for s in specs],
        options=OrchestrationOptions(stop_on_error=False),
    )
    job = Job(job_id="wt-job-1", type=JobType.ORCHESTRATION,
              status=JobStatus.QUEUED, company="acme", project="shop",
              request_payload=req.model_dump())
    storage.save_job(job)
    return ws, product, storage, job


def _worktree_registrations(repo):
    out = run_git(["worktree", "list", "--porcelain"], cwd=repo)
    return [l for l in out.splitlines() if l.startswith("worktree ")]


def test_single_spec_run_isolated_and_reclaimed(tmp_path, monkeypatch):
    ws, product, storage, job = _harness(tmp_path, monkeypatch, ["spec-a"])
    tasks.run_orchestration(job.job_id, storage)
    got = storage.get_job(job.job_id)
    assert got.status == JobStatus.COMPLETED, got.error

    # W1: the LIVE tree never left default and never saw the generated file.
    assert run_git(["branch", "--show-current"], cwd=product).strip() == "main"
    assert not (product / "spec-a.txt").exists()
    # ...but the run's branch carries it (shared refs).
    files = run_git(["ls-tree", "-r", "--name-only", "feature/spec-a"],
                    cwd=product).split()
    assert "spec-a.txt" in files

    # W3/L1: the run worktree is fully reclaimed â€” no dir, no registration.
    assert got.worktree_root and got.worktree_root.startswith(str(ws))
    assert not Path(got.worktree_root).exists()
    assert len(_worktree_registrations(product)) == 1  # live checkout only

    # F10/W12 guard: durable logs live OUTSIDE the worktree root.
    assert got.logs_path
    assert not Path(got.logs_path).resolve().is_relative_to(
        Path(got.worktree_root).resolve())
    assert Path(got.logs_path).exists()  # survived reclamation

    # W7: bookkeeping persisted.
    assert got.run_branch == "feature/spec-a"


def test_worktree_runs_off_restores_legacy_live_tree(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKTREE_RUNS", "off")
    ws, product, storage, job = _harness(tmp_path, monkeypatch, ["spec-a"])
    tasks.run_orchestration(job.job_id, storage)
    got = storage.get_job(job.job_id)
    assert got.status == JobStatus.COMPLETED, got.error
    assert not (ws / "wt").exists()            # no allocation
    assert got.worktree_root is None
    files = run_git(["ls-tree", "-r", "--name-only", "feature/spec-a"],
                    cwd=product).split()
    assert "spec-a.txt" in files               # legacy path still works


def test_branch_collision_fails_fast_with_clear_error(tmp_path, monkeypatch):
    ws, product, storage, job = _harness(tmp_path, monkeypatch, ["spec-a"])
    # Simulate another run holding the branch: check it out in a 2nd worktree.
    other = tmp_path / "other-run"
    run_git(["worktree", "add", "-b", "feature/spec-a", str(other), "main"],
            cwd=product)
    import pytest
    with pytest.raises(ValueError, match="active in another worktree"):
        tasks.run_orchestration(job.job_id, storage)  # worker catches this
    got = storage.get_job(job.job_id)
    assert got.status == JobStatus.FAILED
    assert "active in another worktree" in (got.error or "")


def test_per_spec_parallel_mode_three_specs_three_branches(tmp_path, monkeypatch):
    monkeypatch.setenv("RUN_SPEC_CONCURRENCY", "3")
    specs = ["spec-a", "spec-b", "spec-c"]
    ws, product, storage, job = _harness(tmp_path, monkeypatch, specs)
    tasks.run_orchestration(job.job_id, storage)
    got = storage.get_job(job.job_id)
    assert got.status == JobStatus.COMPLETED, got.error
    assert got.result["mode"] == "per_spec_parallel"
    assert got.result["succeeded"] == specs and got.result["failed"] == []

    # N branches, each carrying ONLY its own spec's file (D1).
    for s in specs:
        files = run_git(["ls-tree", "-r", "--name-only", f"feature/{s}"],
                        cwd=product).split()
        assert f"{s}.txt" in files
        for other in specs:
            if other != s:
                assert f"{other}.txt" not in files
    # Live tree untouched; all spec worktrees reclaimed.
    assert run_git(["branch", "--show-current"], cwd=product).strip() == "main"
    assert len(_worktree_registrations(product)) == 1
    assert not (ws / "wt" / wr_run_key(job.job_id)).exists()


def test_per_spec_failure_is_independent(tmp_path, monkeypatch):
    monkeypatch.setenv("RUN_SPEC_CONCURRENCY", "2")
    specs = ["spec-a", "spec-b", "spec-c"]
    ws, product, storage, job = _harness(tmp_path, monkeypatch, specs,
                                         fail_specs=("spec-b",))
    tasks.run_orchestration(job.job_id, storage)
    got = storage.get_job(job.job_id)
    # Independent semantics: the run COMPLETES; the failed spec is reported.
    assert got.status == JobStatus.COMPLETED
    assert got.result["failed"] == ["spec-b"]
    assert sorted(got.result["succeeded"]) == ["spec-a", "spec-c"]
    assert "spec-b" in (got.error or "")
    # Survivors' branches exist; the failed spec's file is nowhere.
    for s in ("spec-a", "spec-c"):
        assert f"{s}.txt" in run_git(
            ["ls-tree", "-r", "--name-only", f"feature/{s}"], cwd=product).split()
    assert len(_worktree_registrations(product)) == 1  # everything reclaimed

