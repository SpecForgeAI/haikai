"""Option C end-to-end: the per-spec gate must block the single MR.

Drives the REAL `run_orchestration` over a 2-spec batch against a REAL git product
repo. Stubbed (true externals / the code-under-test's collaborators, per policy):
the LLM steps (`_execute_step_with_session`, `_build_chat_executor`), the repair
session (`_repair_spec`), and the push/PR boundary (`_finalize_batch_git`, spied to
record whether the MR path was even taken). The gate wiring itself runs for real.
"""
from __future__ import annotations

import types
from pathlib import Path

import src.job_queue.tasks as tasks
import src.haikai_orchestrator as orch_mod
from src.haikai_orchestrator import HaikaiOrchestrator
from src.haikai_models import StepResult, OrchestrationRequest, OrchestrationOptions
from src.job_queue.job_storage import JobStorage
from src.job_queue.job_models import Job, JobStatus, JobType
from src.chat.session_store import create_active_session
from tests._realgit import set_git_env, local_repo_with_base, run_git

SPECS = ["ui-checkout-spec", "service-checkout-spec"]


def _drive(tmp_path, monkeypatch, repair_results: dict):
    """Run a 2-spec batch; `repair_results` maps spec_name -> gate passes? Returns
    (product_repo, finalize_calls, job)."""
    set_git_env(monkeypatch, auto_push=False, auto_pr=False)
    ws = (tmp_path / "ws").resolve()
    (ws / "acme").mkdir(parents=True)
    monkeypatch.setenv("API_WORKSPACE_DIR", str(ws))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setenv("BATCH_VERIFY_GATE", "true")

    product = ws / "acme" / "shop"
    local_repo_with_base(product)                      # single-repo target (product_root/.git)
    for s in SPECS:                                    # orchestrator pre-checks need these
        planning = product / "haikai" / "specs" / s / "planning"
        planning.mkdir(parents=True)
        (planning / "requirements.md").write_text("# req\n")
        (planning / "initialization.md").write_text("# init\n")
    create_active_session(ws, "acme", "shop")

    # LLM steps: each step "succeeds"; implement-tasks writes the spec's file into the repo.
    def _step(self, chat_executor, step, command, spec_name):
        if step == 3:
            (product / f"{spec_name}.txt").write_text(f"impl for {spec_name}\n")
        return StepResult(step=step, command=command, status="success",
                          output_paths=[], execution_time_seconds=0.0, log_file="stub.log")
    monkeypatch.setattr(HaikaiOrchestrator, "_execute_step_with_session", _step)
    monkeypatch.setattr(orch_mod, "_build_chat_executor",
                        lambda **kw: types.SimpleNamespace(session_uuid="s"))

    # the gate's repair session (true external LLM) — deterministic per spec
    monkeypatch.setattr(tasks, "_repair_spec",
                        lambda repo, spec, key, **kw: (repair_results.get(spec, True), 1, "x"))
    # the push/PR boundary — spy: did the MR path get taken at all?
    finalize_calls: list = []
    monkeypatch.setattr(tasks, "_finalize_batch_git",
                        lambda gc, targets, results, batch_name, names: finalize_calls.append(batch_name))
    monkeypatch.setattr(tasks, "_restore_session", lambda *a, **k: None)

    storage = JobStorage(str(tmp_path / "jobs.db"))
    req = OrchestrationRequest(
        company="acme", project="shop", batch_name="checkout",
        spec_intents=[{"spec_name": s} for s in SPECS],
        options=OrchestrationOptions(stop_on_error=True),
    )
    job = Job(job_id="j1", type=JobType.ORCHESTRATION, status=JobStatus.QUEUED,
              company="acme", project="shop", request_payload=req.model_dump())
    storage.save_job(job)
    tasks.run_orchestration("j1", storage)
    return product, finalize_calls, storage.get_job("j1")


def _branch_files(product):
    return run_git(["ls-tree", "-r", "--name-only", "feature/checkout"], cwd=product).split()


def test_all_specs_pass_opens_one_mr(tmp_path, monkeypatch):
    product, finalize_calls, _ = _drive(
        tmp_path, monkeypatch, {"ui-checkout-spec": True, "service-checkout-spec": True})
    files = _branch_files(product)
    assert "ui-checkout-spec.txt" in files and "service-checkout-spec.txt" in files
    assert finalize_calls == ["checkout"]            # the MR path was taken, once


def test_failed_spec_blocks_the_mr(tmp_path, monkeypatch):
    product, finalize_calls, job = _drive(
        tmp_path, monkeypatch, {"ui-checkout-spec": True, "service-checkout-spec": False})
    files = _branch_files(product)
    # spec 1 committed; the failed spec is NOT committed
    assert "ui-checkout-spec.txt" in files
    assert "service-checkout-spec.txt" not in files
    # and crucially: NO MR
    assert finalize_calls == []
    errors = (job.result or {}).get("errors") or []
    assert any("did not pass" in e for e in errors), errors
