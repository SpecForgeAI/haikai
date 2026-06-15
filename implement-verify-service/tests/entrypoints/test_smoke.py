"""Import-smoke guard for the relocated entrypoints (src/entrypoints/).

Before the restructure these launchers lived at the repo root and were never
exercised by the test suite, so a move that broke their `src.*` imports or their
repo-root path anchors (.env.local, api_server.log, api_workspace/) would have
gone unnoticed. Each module is imported in a SUBPROCESS with cwd=repo root —
isolated so debug_*'s module-level os.environ defaults don't leak into other
tests, and realistic because it's how the shims / `python -m` actually load them.
The matching root shim (python <name>.py) is asserted to delegate here.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

# Force a cp1252 console in the child — the WORST case on Windows. Several
# launchers print status glyphs (✓ ✗ ℹ ⚠) at module load / in their banners;
# under cp1252 those would raise UnicodeEncodeError and crash the launcher
# before the server starts. src/entrypoints/__init__.py reconfigures stdout to
# UTF-8 for the whole package, so these imports MUST survive cp1252. This env
# turns the test into a regression guard for that fix (drop PYTHONUTF8, pin the
# legacy Windows codepage) instead of papering over it.
_CP1252_ENV = {**os.environ, "PYTHONIOENCODING": "cp1252"}
_CP1252_ENV.pop("PYTHONUTF8", None)

ENTRYPOINTS = [
    "run", "run_api", "run_simple", "main", "mock_server", "debug_api", "debug_worker",
]


@pytest.mark.parametrize("name", ENTRYPOINTS)
def test_entrypoint_imports_cleanly(name):
    """`import src.entrypoints.<name>` succeeds under a cp1252 console (no broken
    src.* imports, no repo-root path anchor blowing up, no non-ASCII print
    crashing at module load)."""
    proc = subprocess.run(
        [sys.executable, "-c", f"import src.entrypoints.{name}"],
        cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=120, env=_CP1252_ENV,
    )
    assert proc.returncode == 0, f"import src.entrypoints.{name} failed:\n{proc.stderr[-2000:]}"


@pytest.mark.parametrize("name", ENTRYPOINTS)
def test_no_root_shim(name):
    """Clean break: the entrypoint lives ONLY at src/entrypoints/<name>.py — no
    root shim. Invoke via `python -m src.entrypoints.<name>` (see the startup
    scripts). A reintroduced root shim would re-clutter the repo root."""
    assert not (REPO_ROOT / f"{name}.py").exists(), (
        f"root {name}.py should not exist — call `python -m src.entrypoints.{name}` instead")


def test_real_logic_lives_in_src():
    """The relocated modules carry the real code."""
    src_dir = REPO_ROOT / "src" / "entrypoints"
    for name in ENTRYPOINTS:
        f = src_dir / f"{name}.py"
        assert f.exists(), f"src/entrypoints/{name}.py missing"
        assert len(f.read_text(encoding="utf-8").splitlines()) > 15, f"{name} looks like a stub, not the real module"
