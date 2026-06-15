"""Regression tests for _resolve_repo_targets — polyrepo gm routing fix.

Surfaced empirically by the OD-2 multi-trial 2026-05-27. Prior to the fix,
``_run_git_operations`` built a single ``GitManager`` at the product root
unconditionally; polyrepo product roots have ``coordination.yaml`` but no
``.git/``, so every git op failed with ``fatal: not a git repository``.

See haikai/specs/2026-05-27-od2-empirical-test/findings-multi-trial.md
(bug B-4).
"""

import tempfile
from pathlib import Path

import pytest

from src.job_queue.tasks import _resolve_repo_targets


@pytest.fixture
def tmp_root():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


def test_legacy_single_repo_returns_product_root(tmp_root):
    """Product root IS the cloned repo (.git/ present)."""
    (tmp_root / ".git").mkdir()
    targets = _resolve_repo_targets(tmp_root)
    assert targets == [(None, tmp_root)]


def test_polyrepo_returns_each_repo_subdir(tmp_root):
    """coordination.yaml at root + per-repo .git/ in each subdir."""
    (tmp_root / "coordination.yaml").write_text(
        "backend: https://example.com/be.git\n"
        "frontend: https://example.com/fe.git\n",
        encoding="utf-8",
    )
    (tmp_root / "backend").mkdir()
    (tmp_root / "backend" / ".git").mkdir()
    (tmp_root / "frontend").mkdir()
    (tmp_root / "frontend" / ".git").mkdir()

    targets = _resolve_repo_targets(tmp_root)

    # Order follows coordination.yaml; dict iteration is preserved (Py3.7+).
    assert targets == [
        ("backend", tmp_root / "backend"),
        ("frontend", tmp_root / "frontend"),
    ]


def test_polyrepo_skips_subdir_missing_git(tmp_root):
    """If init aborted mid-clone, a subdir may exist without .git/ —
    that repo is not git-ready and must be skipped, not failed-on."""
    (tmp_root / "coordination.yaml").write_text(
        "backend: https://example.com/be.git\n"
        "frontend: https://example.com/fe.git\n",
        encoding="utf-8",
    )
    (tmp_root / "backend").mkdir()
    (tmp_root / "backend" / ".git").mkdir()
    (tmp_root / "frontend").mkdir()
    # NO .git/ in frontend — partial init state

    targets = _resolve_repo_targets(tmp_root)

    assert targets == [("backend", tmp_root / "backend")]


def test_bare_product_root_returns_empty(tmp_root):
    """Neither .git/ nor coordination.yaml — caller must handle as no-op,
    not silently iterate a wrong path. The empty result surfaces the
    misconfiguration to upstream logging."""
    targets = _resolve_repo_targets(tmp_root)
    assert targets == []


def test_polyrepo_with_corrupt_coordination_yaml_returns_empty(tmp_root):
    """Malformed yaml falls back to empty list — surfaces the corrupt
    state to upstream rather than crashing the job."""
    (tmp_root / "coordination.yaml").write_text(
        ":::not yaml:::", encoding="utf-8",
    )
    targets = _resolve_repo_targets(tmp_root)
    assert targets == []
