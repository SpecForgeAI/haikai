"""Option A deterministic spec materialisation (2026-07-30).

The migration driver already HOLDS the full requirements (generated spec
text). Sending them as ``spec_intents[].requirements_text`` makes IVS write
the agent-os spec structure itself — no LLM shaping turn, no wrong-path
requirements.md, no folder detection, no active-session requirement.

Also pins the step-4 (/git-commit-preparation) cost control: the ~10-minute
prep turn runs ONCE per request, on the final spec — and not at all when
``commit_preparation`` is False.
"""
from __future__ import annotations

import types
from pathlib import Path

import pytest

import src.haikai_orchestrator as orch_mod
from src.haikai_models import (
    OrchestrationOptions,
    OrchestrationRequest,
    SpecIntent,
)
from src.haikai_orchestrator import HaikaiOrchestrator
from src.haikai_models import StepResult
from src.job_queue.tasks import (
    _materialize_spec_folders,
    _resolve_request_context,
)


# ---------------------------------------------------------------------------
# _materialize_spec_folders
# ---------------------------------------------------------------------------


def test_materialises_the_agent_os_structure(tmp_path):
    ws = tmp_path / "ws"
    product = ws / "acme" / "proj"
    product.mkdir(parents=True)
    (product / "coordination.yaml").write_text(
        'backend: "https://example.com/b.git"\n', encoding="utf-8"
    )
    request = OrchestrationRequest(
        company="acme",
        project="proj",
        spec_intents=[
            SpecIntent(
                spec_name="2026-07-30-seed-schema",
                requirements_text="# Seed schema\n\nLand the pack files.\n",
            )
        ],
    )

    _materialize_spec_folders(request, str(ws))

    spec = product / "haikai" / "specs" / "2026-07-30-seed-schema"
    assert (spec / "planning" / "requirements.md").read_text(encoding="utf-8").startswith(
        "# Seed schema"
    )
    assert "Initial Idea" in (spec / "planning" / "initialization.md").read_text(
        encoding="utf-8"
    )
    # Single-repo coordination -> the target repo is unambiguous.
    assert (spec / "planning" / "target-repo.md").read_text(encoding="utf-8") == (
        "target_folder: backend\n"
    )
    assert (spec / "planning" / "visuals").is_dir()
    assert (spec / "implementation").is_dir()


def test_intents_without_requirements_are_untouched(tmp_path):
    ws = tmp_path / "ws"
    (ws / "acme" / "proj").mkdir(parents=True)
    request = OrchestrationRequest(
        company="acme",
        project="proj",
        spec_intents=[SpecIntent(spec_name="2026-07-30-classic-spec")],
    )

    _materialize_spec_folders(request, str(ws))

    assert not (ws / "acme" / "proj" / "haikai").exists()


def test_rematerialisation_overwrites_planning_files(tmp_path):
    # Stable folder names are the point: a re-run refreshes the payload.
    ws = tmp_path / "ws"
    (ws / "acme" / "proj").mkdir(parents=True)
    intent = SpecIntent(spec_name="2026-07-30-seed-schema", requirements_text="v1")
    request = OrchestrationRequest(
        company="acme", project="proj", spec_intents=[intent]
    )
    _materialize_spec_folders(request, str(ws))

    request.spec_intents[0].requirements_text = "v2"
    _materialize_spec_folders(request, str(ws))

    spec = ws / "acme" / "proj" / "haikai" / "specs" / "2026-07-30-seed-schema"
    assert (spec / "planning" / "requirements.md").read_text(encoding="utf-8") == "v2"


# ---------------------------------------------------------------------------
# Session requirement relaxation (materialised intents need no shape session)
# ---------------------------------------------------------------------------


@pytest.fixture()
def prologue_env(monkeypatch, tmp_path):
    monkeypatch.setenv("CHAT_EXECUTOR", "kiro")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setattr("src.job_queue.tasks.get_active_session", lambda *a: None)
    return monkeypatch


def _job(spec_intents):
    return types.SimpleNamespace(
        request_payload={
            "company": "acme",
            "project": "proj",
            "spec_intents": spec_intents,
        }
    )


def test_materialised_intents_need_no_active_session(prologue_env):
    _req, _key, _ws, session_id = _resolve_request_context(
        _job([{"spec_name": "2026-07-30-seed-schema", "requirements_text": "# req"}])
    )
    assert len(session_id) == 36  # a freshly generated uuid


def test_classic_intents_still_require_a_session(prologue_env):
    with pytest.raises(ValueError, match="No active session"):
        _resolve_request_context(_job([{"spec_name": "2026-07-30-classic-spec"}]))


# ---------------------------------------------------------------------------
# Step 4 (/git-commit-preparation): once per request, on the final spec only
# ---------------------------------------------------------------------------


def _run_workflow_recording_steps(tmp_path, monkeypatch, *, commit_preparation):
    ws = tmp_path / "ws"
    product = ws / "acme" / "proj"
    specs = ["2026-07-30-spec-a", "2026-07-30-spec-b"]
    for s in specs:
        planning = product / "haikai" / "specs" / s / "planning"
        planning.mkdir(parents=True)
        (planning / "requirements.md").write_text("# req\n", encoding="utf-8")
        (planning / "initialization.md").write_text("# init\n", encoding="utf-8")

    executed: list = []

    def _step(self, chat_executor, step, command, spec_name, is_new_session=False):
        executed.append((spec_name, step))
        return StepResult(
            step=step, command=command, status="success",
            output_paths=[], execution_time_seconds=0.0, log_file="stub.log",
        )

    monkeypatch.setattr(HaikaiOrchestrator, "_execute_step_with_session", _step)
    monkeypatch.setattr(
        orch_mod, "_build_chat_executor",
        lambda **kw: types.SimpleNamespace(session_uuid="s"),
    )

    request = OrchestrationRequest(
        company="acme",
        project="proj",
        spec_intents=[SpecIntent(spec_name=s) for s in specs],
        options=OrchestrationOptions(stop_on_error=True),
        commit_preparation=commit_preparation,
    )
    orchestrator = HaikaiOrchestrator(
        request=request,
        anthropic_api_key="",
        workspace_dir=str(ws),
        logs_dir=str(tmp_path / "logs"),
    )
    orchestrator.run_workflow()
    return specs, executed


def test_step4_runs_once_on_the_final_spec_only(tmp_path, monkeypatch):
    specs, executed = _run_workflow_recording_steps(
        tmp_path, monkeypatch, commit_preparation=None
    )
    assert [s for (n, s) in executed if n == specs[0]] == [1, 2, 3]
    assert [s for (n, s) in executed if n == specs[1]] == [1, 2, 3, 4]


def test_step4_skipped_entirely_when_disabled(tmp_path, monkeypatch):
    specs, executed = _run_workflow_recording_steps(
        tmp_path, monkeypatch, commit_preparation=False
    )
    assert [s for (n, s) in executed if n == specs[0]] == [1, 2, 3]
    assert [s for (n, s) in executed if n == specs[1]] == [1, 2, 3]
