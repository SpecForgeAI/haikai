"""Tests for S1/S2/S3 fixes (standards endpoints + orchestrator hygiene).

- S1 (HIGH): create_product_standards used to swallow exceptions and
  return [] — caller saw success=True with empty outputs. Now re-raises.
- S2 (MEDIUM): standards_orchestrator no longer uses print() or
  traceback.print_exc(); all output goes through logger.
- S3 (LOW): tech-stack.md and sister files are written atomically via
  the _atomic_write_text helper (mkstemp + os.replace).
"""
from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import patch

import pytest


REPO_ROOT = Path(__file__).parent.parent.parent


# ─── S1: synthesis failure surfaces as success=False ────────────────────────


class TestSynthesisFailurePropagates:
    """The OperationExecutor must report success=False when the
    underlying synthesis raises. Previously the orchestrator swallowed
    the exception and returned [], producing success=True/outputs=[]."""

    def test_synthesis_exception_re_raises_from_orchestrator(self, tmp_path):
        from src.standards_orchestrator import StandardsOrchestrator
        # Construct a minimally-valid orchestrator
        config = {
            "mode": "generate_product_standards",
            "output_dir": str(tmp_path),
            "global_dir": str(tmp_path / "global"),
            "llm_provider": "custom",
            "llm_model": "claude-sonnet-4-6",
            "llm_base_url": "http://fake-proxy.local/v1",
            "llm_api_key": "dummy",
        }
        orch = StandardsOrchestrator(config=config)

        # Force the inner synthesis to raise
        with patch.object(
            orch, "_synthesize_standards",
            side_effect=RuntimeError("synthesis blew up"),
        ):
            with pytest.raises(RuntimeError, match="synthesis blew up"):
                orch.create_product_standards(sources=[], recursive=False)

    def test_operation_executor_marks_success_false_on_synthesis_failure(
        self, tmp_path
    ):
        """End-to-end: when create_product_standards raises, the
        OperationExecutor's wrapping try/except sets success=False with
        the error string."""
        from src.operation_executor import OperationExecutor
        from src.models import GenerateProductStandardsRequest, OperationMode

        req = GenerateProductStandardsRequest(
            company="acme",
            project="backend",
            sources=[],
            recursive=False,
            mode=OperationMode.GENERATE_PRODUCT_STANDARDS,
        )
        # Minimal LLM config so StandardsOrchestrator.__init__ succeeds —
        # we'll patch the actual synthesis call out below.
        env_config = {
            "llm_provider": "custom",
            "llm_model": "claude-sonnet-4-6",
            "llm_base_url": "http://fake-proxy.local/v1",
            "llm_api_key": "dummy",
        }
        executor = OperationExecutor(env_config, workspace_dir=tmp_path)

        with patch(
            "src.standards_orchestrator.StandardsOrchestrator.create_product_standards",
            side_effect=RuntimeError("synthesis blew up"),
        ):
            resp = executor._generate_product_standards(req)

        assert resp.success is False, (
            "OperationExecutor must surface synthesis failures as success=False, "
            "not silently as success=True with empty outputs"
        )
        assert resp.outputs == []
        assert any("synthesis blew up" in str(e) for e in resp.errors)


# ─── S2: no print() / traceback.print_exc() in standards_orchestrator ────────


class TestNoPrintInStandardsOrchestrator:
    """standards_orchestrator must use logger, not print."""

    def test_no_print_calls(self):
        text = (REPO_ROOT / "src" / "standards_orchestrator.py").read_text(
            encoding="utf-8"
        )
        offenders = [
            f"line {i+1}: {l.strip()}"
            for i, l in enumerate(text.split("\n"))
            if re.search(r"\bprint\(", l) and not l.lstrip().startswith("#")
        ]
        assert offenders == [], (
            "Found print() in standards_orchestrator.py — use logger:\n"
            + "\n".join(f"  {o}" for o in offenders)
        )

    def test_no_traceback_print_exc(self):
        text = (REPO_ROOT / "src" / "standards_orchestrator.py").read_text(
            encoding="utf-8"
        )
        # Skip docstring/comment mentions
        offenders = [
            f"line {i+1}"
            for i, l in enumerate(text.split("\n"))
            if "traceback.print_exc()" in l and not l.lstrip().startswith("#")
        ]
        assert offenders == [], (
            "Found traceback.print_exc() in standards_orchestrator.py — "
            "use logger.error(..., exc_info=True):\n"
            + "\n".join(f"  {o}" for o in offenders)
        )

    def test_colorama_import_removed(self):
        text = (REPO_ROOT / "src" / "standards_orchestrator.py").read_text(
            encoding="utf-8"
        )
        assert "from colorama import" not in text, (
            "colorama no longer needed after print→logger migration"
        )


# ─── S3: atomic write helper ─────────────────────────────────────────────────


class TestAtomicWriteHelper:
    """_atomic_write_text writes via temp + os.replace so concurrent
    readers never see a half-written file."""

    def test_writes_content_to_target_path(self, tmp_path):
        from src.standards_orchestrator import StandardsOrchestrator
        target = tmp_path / "subdir" / "output.md"
        StandardsOrchestrator._atomic_write_text(target, "hello world")
        assert target.read_text(encoding="utf-8") == "hello world"

    def test_overwrites_existing(self, tmp_path):
        from src.standards_orchestrator import StandardsOrchestrator
        target = tmp_path / "out.md"
        target.write_text("old", encoding="utf-8")
        StandardsOrchestrator._atomic_write_text(target, "new")
        assert target.read_text(encoding="utf-8") == "new"

    def test_no_temp_file_left_behind_on_success(self, tmp_path):
        from src.standards_orchestrator import StandardsOrchestrator
        target = tmp_path / "out.md"
        StandardsOrchestrator._atomic_write_text(target, "hi")
        # Only the target should exist, no .tmp leftovers
        files = sorted(p.name for p in tmp_path.iterdir())
        assert files == ["out.md"], (
            f"Expected only out.md, found leftover temp files: {files}"
        )

    def test_temp_cleaned_up_on_write_failure(self, tmp_path, monkeypatch):
        """If the os.replace step fails, no .tmp file should remain."""
        from src import standards_orchestrator as so

        target = tmp_path / "out.md"

        def _raise_replace(*a, **kw):
            raise OSError("simulated replace failure")

        monkeypatch.setattr(so.os, "replace", _raise_replace, raising=False)
        # The fdopen+write succeeds but os.replace raises; helper should
        # unlink the temp before re-raising.
        with pytest.raises(OSError, match="simulated replace failure"):
            so.StandardsOrchestrator._atomic_write_text(target, "data")
        # No .tmp leftovers
        leftovers = list(tmp_path.glob(".out.md.*.tmp"))
        assert leftovers == [], f"temp file leaked on failure: {leftovers}"
