"""Reload watch-scope pins for the dev entrypoint (src/entrypoints/run_api.py).

2026-08-04 live incident: the default uvicorn reloader watched the whole
tree, so every agent write under api_workspace/ reloaded the server and
SIGTERM'd the in-flight kiro-cli run (exit 0xC000013A — a kill, not a
crash). 2026-08-05 follow-up finding: the first exclude attempt
("api_workspace/*") was SILENTLY INERT — uvicorn treats non-directory
entries as globs matched with Path.match, which cannot span directory
separators, so a deep path never matched. The rules pinned here:

  * reload_dirs = source dirs only (src/templates/config) — the actual fix;
  * directory excludes are ABSOLUTE EXISTING-DIRECTORY paths, never
    directory-spanning globs;
  * the only glob is the single-segment "*.log".
"""
from __future__ import annotations

from pathlib import Path

from src.entrypoints.run_api import build_reload_watch_config


def _make_project(tmp_path: Path) -> Path:
    for d in ("src", "templates", "config", "api_workspace", "workspace", "sessions", "haikai"):
        (tmp_path / d).mkdir()
    return tmp_path


def test_watch_dirs_are_source_only(tmp_path):
    root = _make_project(tmp_path)
    reload_dirs, _ = build_reload_watch_config(root)
    assert reload_dirs == [str(root / "src"), str(root / "templates"), str(root / "config")]
    # The workspaces are NOT watched — this is what stops agent writes
    # from reloading the server mid-run.
    assert str(root / "api_workspace") not in reload_dirs
    assert str(root / "workspace") not in reload_dirs


def test_excludes_are_absolute_dirs_plus_log_glob_never_spanning_globs(tmp_path):
    root = _make_project(tmp_path)
    _, excludes = build_reload_watch_config(root)
    assert "*.log" in excludes
    for entry in excludes:
        if entry == "*.log":
            continue
        # Directory excludes must be real absolute directories — the inert
        # "api_workspace/*" deep-glob shape must never come back.
        assert Path(entry).is_absolute(), entry
        assert Path(entry).is_dir(), entry
        assert "*" not in entry, entry
    assert str(root / "api_workspace") in excludes
    assert str(root / "sessions") in excludes


def test_missing_dirs_are_simply_omitted(tmp_path):
    (tmp_path / "src").mkdir()
    reload_dirs, excludes = build_reload_watch_config(tmp_path)
    assert reload_dirs == [str(tmp_path / "src")]
    assert excludes == ["*.log"]
