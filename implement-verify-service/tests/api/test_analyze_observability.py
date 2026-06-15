"""Observability/hygiene tests for POST /api/v1/structural/analyze.

Targets the 9 findings from the autoresearch:debug pass on the e2e analyze
flow. Each test exercises a single failure mode so that a regression points
straight at the specific finding it covers.
"""
import logging
import os
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


# --- Fixtures ----------------------------------------------------------------


@pytest.fixture(autouse=True)
def set_api_key():
    """Set STANDARDS_API_KEY for the test, restore the prior value on
    teardown. Previously this fixture pop()ed unconditionally, leaving
    subsequent test files (e.g. test_git_v2_endpoints) with no key — so
    their `Authorization: Bearer test-key` calls 401'd and tests that
    expected 200 saw a 400/401 instead. Track in
    fix/260504-1127-full-repo-green."""
    prior = os.environ.get("STANDARDS_API_KEY")
    os.environ["STANDARDS_API_KEY"] = "test-key"
    try:
        yield
    finally:
        if prior is None:
            os.environ.pop("STANDARDS_API_KEY", None)
        else:
            os.environ["STANDARDS_API_KEY"] = prior


@pytest.fixture
def client():
    from src.api import app
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"Authorization": "Bearer test-key"}


@pytest.fixture
def fake_repo(tmp_path):
    """A directory with one Python file so source-discovery passes."""
    repo = tmp_path / "fake-repo"
    repo.mkdir()
    (repo / "thing.py").write_text("def hello(): return 1\n", encoding="utf-8")
    return repo


# --- M1: ctags missing -> 503 ------------------------------------------------


class TestCtagsMissing:
    def test_returns_503_when_ctags_unavailable(self, client, auth_headers, fake_repo):
        with patch("src.ast.ctags_provider.CtagsProvider.is_available",
                   return_value=False):
            response = client.post(
                "/api/v1/structural/analyze",
                json={"local_path": str(fake_repo)},
                headers=auth_headers,
            )
        assert response.status_code == 503
        assert "ctags" in response.json()["detail"].lower()


# --- M2: _get_llm_client logs misconfig at ERROR -----------------------------


class TestLlmClientLogging:
    def test_missing_api_key_logs_error_and_returns_none(self, caplog):
        """When provider/model ARE set but the API key is missing,
        LLMClient raises ValueError inside build_llm_client. _get_llm_client
        must surface that at ERROR (not silently swallow)."""
        from src.structural_endpoints import _get_llm_client

        caplog.set_level(logging.ERROR, logger="src.structural_endpoints")
        with patch.dict(os.environ, {
            "LLM_PROVIDER": "openai",
            "LLM_MODEL": "gpt-5.4-mini",
        }, clear=False):
            os.environ.pop("OPENAI_API_KEY", None)
            os.environ.pop("ANTHROPIC_API_KEY", None)
            client = _get_llm_client()
        assert client is None
        # The factory's error chain raises a ValueError that mentions
        # OPENAI_API_KEY by name. We don't pin the exact phrasing.
        assert any(
            "OPENAI_API_KEY" in r.message and r.levelname == "ERROR"
            for r in caplog.records
        ), f"expected ERROR log mentioning OPENAI_API_KEY, got: {[r.message for r in caplog.records]}"

    def test_unconfigured_returns_none_silently(self, caplog):
        """No LLM_PROVIDER set is the documented "no LLM" path — must not log."""
        from src.structural_endpoints import _get_llm_client

        caplog.set_level(logging.ERROR, logger="src.structural_endpoints")
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LLM_PROVIDER", None)
            os.environ.pop("LLM_MODEL", None)
            client = _get_llm_client()
        assert client is None
        assert not any(r.levelname == "ERROR" for r in caplog.records)

    def test_value_error_from_llm_client_logged_loudly(self, caplog):
        """Bad LLMClient kwargs surface in the log instead of being swallowed."""
        from src import structural_endpoints

        caplog.set_level(logging.ERROR, logger="src.structural_endpoints")
        with patch.dict(os.environ, {
            "LLM_PROVIDER": "openai",
            "LLM_MODEL": "whatever",
            "OPENAI_API_KEY": "x",
        }, clear=False):
            with patch("src.llm_client.LLMClient",
                       side_effect=ValueError("unknown provider thing")):
                client = structural_endpoints._get_llm_client()
        assert client is None
        assert any(
            "unknown provider thing" in r.message and r.levelname == "ERROR"
            for r in caplog.records
        )

    def test_custom_provider_requires_base_url(self, caplog):
        """provider=custom must surface the missing-LLM_BASE_URL error
        rather than silently falling back to env-key lookup (the original
        bug from autoresearch:debug 260504-0823 finding #4)."""
        from src.structural_endpoints import _get_llm_client

        caplog.set_level(logging.ERROR, logger="src.structural_endpoints")
        with patch.dict(os.environ, {
            "LLM_PROVIDER": "custom",
            "LLM_MODEL": "claude-sonnet-4-6",
        }, clear=False):
            os.environ.pop("LLM_BASE_URL", None)
            client = _get_llm_client()
        assert client is None
        assert any(
            "LLM_BASE_URL" in r.message and r.levelname == "ERROR"
            for r in caplog.records
        ), f"expected ERROR mentioning LLM_BASE_URL, got: {[r.message for r in caplog.records]}"

    def test_custom_provider_with_base_url_constructs(self):
        """Round-trip the user's preferred config:
        LLM_PROVIDER=custom + LLM_MODEL=... + LLM_BASE_URL=http://localhost:3456/v1
        actually returns an LLMClient (no longer silently disabled)."""
        from src.structural_endpoints import _get_llm_client

        with patch.dict(os.environ, {
            "LLM_PROVIDER": "custom",
            "LLM_MODEL": "claude-sonnet-4-6",
            "LLM_BASE_URL": "http://localhost:3456/v1",
        }, clear=False):
            os.environ.pop("CUSTOM_API_KEY", None)
            client = _get_llm_client()
        assert client is not None
        assert client.provider == "custom"
        assert client.model == "claude-sonnet-4-6"


# --- M3: snapshot-not-written -> 500 ----------------------------------------


class TestSnapshotNotWritten:
    def test_returns_500_when_pipeline_succeeds_but_no_snapshot(
        self, client, auth_headers, fake_repo
    ):
        with patch("src.ast.ctags_provider.CtagsProvider.is_available",
                   return_value=True), \
             patch("src.ast.provider.ProviderRegistry.analyze_batch",
                   return_value={"x": MagicMock(symbols=[])}), \
             patch("src.ast.pipeline.run_structural_pipeline",
                   return_value={"x": MagicMock(symbols=[])}), \
             patch("src.ast.store.FileStore.get_latest_path",
                   return_value=None):
            response = client.post(
                "/api/v1/structural/analyze",
                json={"local_path": str(fake_repo)},
                headers=auth_headers,
            )
        assert response.status_code == 500
        assert "snapshot was not written" in response.json()["detail"]


# --- M4 + L9: AnalyzeResponse exposes failed_stages and input_file_count ----


class TestAnalyzeResponseShape:
    def test_failed_stages_field_present(self):
        from src.structural_endpoints import AnalyzeResponse
        r = AnalyzeResponse(
            snapshot_id="s", repo="r", branch="main",
            file_count=1, symbol_count=2, store_path="/x",
        )
        assert r.failed_stages == []
        assert r.input_file_count == 0

    def test_failed_stages_round_trips(self):
        from src.structural_endpoints import AnalyzeResponse
        r = AnalyzeResponse(
            snapshot_id="s", repo="r", branch="main",
            file_count=1, symbol_count=2, store_path="/x",
            input_file_count=10,
            failed_stages=["agentic_endpoints", "treesitter_enrichment"],
        )
        assert r.input_file_count == 10
        assert r.failed_stages == ["agentic_endpoints", "treesitter_enrichment"]


class TestPipelineFailedStages:
    def test_pipeline_records_failed_stage_in_caller_dict(self, tmp_path):
        """Pipeline mutates the caller's discovery_stats dict so partial
        failures are visible to the API surface — the core of M4."""
        from src.ast.pipeline import run_structural_pipeline
        from src.ast.models import StructuralAnalysis
        from src.ast.provider import ProviderRegistry
        from src.ast.store import FileStore

        store = FileStore(base_path=str(tmp_path))
        registry = ProviderRegistry()
        analysis = StructuralAnalysis(
            file_path="x.py", language="python", symbols=[], provider_used="ctags",
        )
        stats: dict = {}

        # Force interaction classification to fail by patching its import target.
        with patch("src.ast.interaction_classifier.InteractionClassifier",
                   side_effect=RuntimeError("boom")):
            run_structural_pipeline(
                file_paths=["x.py"],
                ctags_results={"x.py": analysis},
                store=store,
                registry=registry,
                repo_name="r",
                commit_sha="dead",
                branch="main",
                project_root=str(tmp_path),
                llm_client=None,
                discovery_stats=stats,
            )

        assert "interaction_classification" in stats.get("failed_stages", []), (
            f"expected interaction_classification in failed_stages, got: {stats}"
        )


# --- L7: _get_store anchors to project root ---------------------------------


class TestStorePathAnchoring:
    def test_default_is_project_root_relative_not_cwd(self, tmp_path):
        """When AST_STORE_PATH is unset, the store path lives under the
        project root (not whatever the cwd happened to be when uvicorn
        launched). Otherwise concurrent tests / cwd-changing servers see
        different stores."""
        from src.structural_endpoints import _get_store

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AST_STORE_PATH", None)
            cwd_before = os.getcwd()
            try:
                os.chdir(str(tmp_path))
                store = _get_store()
            finally:
                os.chdir(cwd_before)

        # The base_path must NOT be a child of tmp_path (the bogus cwd).
        bp = Path(store.base_path).resolve()
        assert tmp_path.resolve() not in bp.parents, (
            f"store anchored to cwd ({tmp_path}) instead of project root: {bp}"
        )
        # And it should end in the conventional .specforge/structural suffix.
        assert bp.parts[-2:] == (".specforge", "structural")

    def test_env_override_wins(self, tmp_path):
        from src.structural_endpoints import _get_store

        override = tmp_path / "custom-store"
        with patch.dict(os.environ, {"AST_STORE_PATH": str(override)}):
            store = _get_store()
        assert Path(store.base_path).resolve() == override.resolve()
