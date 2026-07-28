"""Executor-aware credential gates on the job/orchestration path (2026-07-28).

Live failure: with CHAT_EXECUTOR=kiro (SSO — no ANTHROPIC_API_KEY in the
env), the kiro-driven shaping turn succeeded, the V2 orchestration job was
created and dispatched 200 — and then `run_orchestration` died immediately
in `_resolve_request_context` on a bare "ANTHROPIC_API_KEY not configured"
raise. The gate must consult `_credentials_satisfied` (backend_registry),
exactly like the API-layer `require_credentials()` gate the start-up check
already uses.
"""
from __future__ import annotations

import types

import pytest

from src.job_queue.tasks import _resolve_request_context


def _job(company: str = "acme", project: str = "proj"):
    return types.SimpleNamespace(
        request_payload={
            "company": company,
            "project": project,
            "spec_intents": [
                {"spec_name": "2026-07-28-first-spec", "session_id": "sess-1"}
            ],
        }
    )


@pytest.fixture()
def base_env(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("API_WORKSPACE_DIR", str(tmp_path))
    monkeypatch.setattr(
        "src.job_queue.tasks.get_active_session", lambda *a, **k: "sess-1"
    )
    return monkeypatch


def test_kiro_backend_needs_no_anthropic_key(base_env):
    base_env.setenv("CHAT_EXECUTOR", "kiro")

    request, key, workspace_dir, session_id = _resolve_request_context(_job())

    assert request.company == "acme"
    # The empty key is deliberate — the kiro executor factories ignore it.
    assert key == ""
    assert session_id == "sess-1"


def test_claude_backend_still_requires_key(base_env):
    base_env.setenv("CHAT_EXECUTOR", "claude")

    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        _resolve_request_context(_job())


def test_key_still_flows_through_when_present(base_env):
    base_env.setenv("CHAT_EXECUTOR", "claude")
    base_env.setenv("ANTHROPIC_API_KEY", "sk-test")

    _request, key, _ws, _sid = _resolve_request_context(_job())
    assert key == "sk-test"


def test_placeholder_spec_name_fails_at_the_prologue(base_env):
    # 2026-07-28 live: a spec folder literally named '<date>-<slug>' (an
    # echoed instruction placeholder) reached `git worktree add` and died as
    # "cannot lock ref: Invalid argument". The prologue now validates every
    # spec name BEFORE worktree allocation builds branch names from them.
    base_env.setenv("CHAT_EXECUTOR", "kiro")
    job = types.SimpleNamespace(
        request_payload={
            "company": "acme",
            "project": "proj",
            "spec_intents": [{"spec_name": "<date>-<slug>", "session_id": "sess-1"}],
        }
    )

    with pytest.raises(ValueError, match="spec_name"):
        _resolve_request_context(job)


def test_get_haikai_service_is_executor_aware(base_env):
    # The sibling inline gate: every specs route resolves the service through
    # get_haikai_service, which 503'd without a key even for kiro.
    base_env.setenv("CHAT_EXECUTOR", "kiro")
    from src import api

    service = api.get_haikai_service()
    assert service.anthropic_api_key == ""
