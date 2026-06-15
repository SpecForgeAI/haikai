"""Path-traversal regression for the orchestration layer.

Findings from autoresearch:debug on src/haikai_orchestrator.py +
src/operation_executor.py + src/haikai_service.py:

CRITICAL: HaikaiService.delete_spec did `shutil.rmtree(spec_path)` on
a path built from 3 unsanitized user segments (company/project/spec_id).
The pre-existence check at line 403 wasn't a security check — for
`company=".."`, the resolved path is the parent of workspace, which
typically exists. This test verifies the new `safe_segment` validation
fires BEFORE rmtree.

HIGH: 14 path-join sites across the 3 files used `request.company` /
`request.project` raw, bypassing the `_safe_project_dir` helper that
already exists in src/api/__init__.py. Now centralized in
src/path_safety.py.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from src.path_safety import safe_segment, check_no_traversal


# ─── safe_segment ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad,kind", [
    (".",            "company"),
    ("..",           "project"),
    ("../etc",       "spec_id"),
    ("",             "company"),
    ("foo/bar",      "project"),
    (r"foo\bar",     "company"),
    ("my company",   "company"),    # space rejected
    (None,           "company"),
    (123,            "company"),    # non-str rejected
])
def test_safe_segment_rejects_unsafe(bad, kind):
    with pytest.raises(ValueError, match=kind):
        safe_segment(bad, kind)


@pytest.mark.parametrize("good", ["acme", "acme.io", "acme-prod", "v1.2.3", "Acme123"])
def test_safe_segment_accepts_normal(good):
    assert safe_segment(good, "x") == good


# ─── check_no_traversal (used for source paths) ──────────────────────────────


@pytest.mark.parametrize("bad", ["..", "../etc", "foo/../bar", "../../etc/passwd"])
def test_check_no_traversal_rejects(bad):
    with pytest.raises(ValueError, match="source"):
        check_no_traversal(bad, "source")


@pytest.mark.parametrize("good", ["alfresco/repo/src", "subdir/file.md", "/abs/path", "."])
def test_check_no_traversal_accepts(good):
    check_no_traversal(good, "source")  # no raise


# ─── HaikaiService.delete_spec — the CRITICAL ───────────────────────────────


def _make_service(tmp_path):
    from src.haikai_service import HaikaiService
    return HaikaiService(workspace_dir=tmp_path, anthropic_api_key="test-key")


@pytest.mark.parametrize("kwargs,bad_field", [
    ({"company": "..", "project": "p", "spec_id": "s"},     "company"),
    ({"company": "c",  "project": "..", "spec_id": "s"},    "project"),
    ({"company": "c",  "project": "p", "spec_id": ".."},    "spec_id"),
    ({"company": "../etc", "project": "p", "spec_id": "s"}, "company"),
])
def test_delete_spec_rejects_traversal_BEFORE_rmtree(tmp_path, kwargs, bad_field):
    """Critical safety property: rmtree must NOT be reached for hostile input."""
    svc = _make_service(tmp_path)
    with patch("src.haikai_service.shutil.rmtree") as mock_rmtree:
        with pytest.raises(ValueError, match=bad_field):
            svc.delete_spec(**kwargs)
        mock_rmtree.assert_not_called()


def test_get_spec_path_rejects_unsafe_segments(tmp_path):
    svc = _make_service(tmp_path)
    with pytest.raises(ValueError, match="company"):
        svc._get_spec_path("..", "p", "s")
    with pytest.raises(ValueError, match="project"):
        svc._get_spec_path("c", "..", "s")
    with pytest.raises(ValueError, match="spec_id"):
        svc._get_spec_path("c", "p", "..")


def test_get_project_path_rejects_unsafe_segments(tmp_path):
    svc = _make_service(tmp_path)
    with pytest.raises(ValueError, match="company"):
        svc._get_project_path("..", "p")


# ─── HaikaiOrchestrator.__init__ — HIGH #2 ──────────────────────────────────


def _make_orch_request(monkeypatch, company="acme", project="backend"):
    """Build an OrchestrationRequest mock with the right shape."""
    req = MagicMock()
    req.company = company
    req.project = project
    req.spec_intents = []
    return req


def test_orchestrator_init_rejects_traversal_in_company(tmp_path, monkeypatch):
    from src.haikai_orchestrator import HaikaiOrchestrator
    req = _make_orch_request(monkeypatch, company="..", project="backend")
    with pytest.raises(ValueError, match="company"):
        HaikaiOrchestrator(
            request=req, anthropic_api_key="test",
            workspace_dir=str(tmp_path), logs_dir=str(tmp_path / "logs"),
        )


def test_orchestrator_init_rejects_traversal_in_project(tmp_path, monkeypatch):
    from src.haikai_orchestrator import HaikaiOrchestrator
    req = _make_orch_request(monkeypatch, company="acme", project="..")
    with pytest.raises(ValueError, match="project"):
        HaikaiOrchestrator(
            request=req, anthropic_api_key="test",
            workspace_dir=str(tmp_path), logs_dir=str(tmp_path / "logs"),
        )


# ─── OperationExecutor source-field traversal — HIGH #4 ──────────────────────


def _make_executor(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    from src.operation_executor import OperationExecutor
    config = {
        "anthropic_api_key": "test-key",
        "llm_provider": "anthropic",
        "llm_model": "claude-3-opus",
    }
    return OperationExecutor(config=config, workspace_dir=tmp_path)


def test_generate_product_standards_rejects_traversal_in_source(monkeypatch, tmp_path):
    from src.models import GenerateProductStandardsRequest, OperationMode
    executor = _make_executor(monkeypatch, tmp_path)
    request = GenerateProductStandardsRequest(
        company="acme", project="backend",
        sources=["../../etc/passwd"],     # hostile source
        recursive=False,
        mode=OperationMode.GENERATE_PRODUCT_STANDARDS,
    )
    response = executor._generate_product_standards(request)
    # The validation raises ValueError; the executor catches and returns
    # a failure response with the error in `errors`.
    assert response.success is False
    assert any("source" in str(e).lower() and ".." in str(e) for e in (response.errors or []))


def test_generate_product_standards_rejects_traversal_in_company(monkeypatch, tmp_path):
    from src.models import GenerateProductStandardsRequest, OperationMode
    executor = _make_executor(monkeypatch, tmp_path)
    request = GenerateProductStandardsRequest(
        company="..", project="backend", sources=[], recursive=False,
        mode=OperationMode.GENERATE_PRODUCT_STANDARDS,
    )
    response = executor._generate_product_standards(request)
    assert response.success is False
    assert any("company" in str(e).lower() for e in (response.errors or []))
