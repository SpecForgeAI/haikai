"""Regression: FileStore._normalize_path must always return relative paths.

Prior behavior returned absolute paths verbatim if they didn't start with
the configured project_root. That made `snapshot_path / normalized`
escape the snapshot via Path's "absolute right side wins" semantics:
on POSIX, `Path("/snap") / "/etc/passwd"` becomes `/etc/passwd`.
"""
from __future__ import annotations

import pytest

from src.ast.store import FileStore


@pytest.fixture
def store(tmp_path):
    return FileStore(base_path=str(tmp_path / "snapshots"))


def test_normalize_strips_leading_slash_when_outside_project(store):
    """An absolute path that doesn't match project_root gets its leading slash removed."""
    store._project_root = "/some/proj/"
    assert store._normalize_path("/etc/passwd") == "etc/passwd"
    # Verify the join no longer escapes
    from pathlib import Path
    snap = Path("/snap")
    normalized = store._normalize_path("/etc/passwd")
    joined = snap / normalized
    # On POSIX: should be /snap/etc/passwd, NOT /etc/passwd
    assert "snap" in str(joined.as_posix()).split("/")


def test_normalize_strips_drive_letter_on_windows_path(store):
    """Windows drive letters like 'C:/foo' get the colon stripped to stay relative."""
    store._project_root = "/some/proj/"
    out = store._normalize_path("C:/foo/bar.py")
    assert ":" not in out
    assert out.startswith("C/") or "foo/bar.py" in out


def test_normalize_within_project_root(store, tmp_path):
    """Paths within project_root get the prefix stripped normally."""
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "src").mkdir()
    target = proj / "src" / "x.py"
    target.write_text("")
    store._project_root = str(proj.resolve()).replace("\\", "/").rstrip("/") + "/"
    out = store._normalize_path(str(target))
    assert out in ("src/x.py", "src\\x.py".replace("\\", "/"))


def test_normalize_strips_dot_slash(store):
    """Backwards-compat: ./foo → foo."""
    # No project_root configured → falls through to common-prefix stripping
    if hasattr(store, "_project_root"):
        delattr(store, "_project_root")
    assert store._normalize_path("./foo/bar.py") == "foo/bar.py"


def test_normalize_relative_passthrough(store):
    """Relative paths without ./ prefix pass through unchanged."""
    if hasattr(store, "_project_root"):
        delattr(store, "_project_root")
    assert store._normalize_path("foo/bar.py") == "foo/bar.py"
