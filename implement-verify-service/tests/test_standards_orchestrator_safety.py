"""Path-safety regression for src/standards_orchestrator.py.

Two findings from autoresearch:debug on src/standards_*.py:

1. (MEDIUM) `_scan_remote_repository` joins regex-parsed `owner`/`repo`
   directly into `staging_dir/temp/<platform>/<owner>/<repo>` and then
   runs `shutil.rmtree(temp_dir)`. parse_repo_url's `[^/]+` regex allows
   `..`, so a URL with a URL-encoded `..` in owner could delete adjacent
   directories under `staging_dir/temp/`.

2. (LOW) `__init__` reads `output_dir` / `global_dir` from the config
   dict without validation. `..` segments would let mkdir + writes
   escape the workspace.
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from src.standards_orchestrator import (
    StandardsOrchestrator,
    _safe_segment,
    _check_no_traversal,
)


# ─── _safe_segment ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad,kind", [
    (".",            "platform"),
    ("..",           "owner"),
    ("../etc",       "repo"),
    ("",             "owner"),
    ("foo/bar",      "repo"),
    (r"foo\bar",     "owner"),
    ("my owner",     "owner"),     # space rejected
    (None,           "platform"),
    (123,            "owner"),     # non-str rejected
])
def test_safe_segment_rejects_unsafe_values(bad, kind):
    with pytest.raises(ValueError, match=kind):
        _safe_segment(bad, kind)


@pytest.mark.parametrize("good", [
    "github",
    "acme",
    "acme-org",
    "user_name",
    "v1.2.3",
    "Acme123",
])
def test_safe_segment_accepts_normal_values(good):
    assert _safe_segment(good, "platform") == good


# ─── _check_no_traversal ─────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", ["..", "../etc", "foo/../bar", "../../etc/passwd"])
def test_check_no_traversal_rejects(bad):
    with pytest.raises(ValueError, match="output_dir"):
        _check_no_traversal(Path(bad), "output_dir")


@pytest.mark.parametrize("good", ["standards", "foo/bar/baz", "/abs/path", "."])
def test_check_no_traversal_accepts(good):
    # Absolute paths and `.` are allowed; only `..` is rejected.
    _check_no_traversal(Path(good), "output_dir")  # no raise


# ─── __init__ rejects traversal in config-supplied dirs ──────────────────────


def test_init_rejects_traversal_in_output_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    config = {
        "output_dir": "../../etc",
        "llm_provider": "anthropic",
        "llm_model": "claude-3-opus",
        "anthropic_api_key": "test-key",
    }
    config["mode"] = "generate_global_standards"
    with pytest.raises(ValueError, match="output_dir"):
        StandardsOrchestrator(config)


def test_init_rejects_traversal_in_global_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    config = {
        "output_dir": str(tmp_path),
        "global_dir": "../../etc",
        "llm_provider": "anthropic",
        "llm_model": "claude-3-opus",
        "anthropic_api_key": "test-key",
    }
    config["mode"] = "generate_global_standards"
    with pytest.raises(ValueError, match="global_dir"):
        StandardsOrchestrator(config)


# ─── _scan_remote_repository rejects traversal BEFORE rmtree runs ────────────


def _make_orchestrator(monkeypatch, tmp_path) -> StandardsOrchestrator:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    config = {
        "output_dir": str(tmp_path / "out"),
        "llm_provider": "anthropic",
        "llm_model": "claude-3-opus",
        "anthropic_api_key": "test-key",
    }
    config["mode"] = "generate_global_standards"
    return StandardsOrchestrator(config)


@pytest.mark.parametrize("bad_field,values", [
    ("owner",    ("github", "..", "repo")),
    ("repo",     ("github", "owner", "..")),
    ("platform", ("..", "owner", "repo")),
])
def test_scan_remote_rejects_traversal_segment_before_rmtree(
    monkeypatch, tmp_path, bad_field, values
):
    """A hostile parse_repo_url result must be rejected BEFORE rmtree fires."""
    orch = _make_orchestrator(monkeypatch, tmp_path)
    platform, owner, repo = values

    with patch.object(orch.repo_fetcher, "parse_repo_url",
                      return_value=(platform, owner, repo, None, None, False)), \
         patch("src.standards_orchestrator.shutil.rmtree") as mock_rmtree:
        with pytest.raises(ValueError, match=bad_field):
            orch._scan_remote_repository("https://github.com/x/y", recursive=True)
        # Critical: rmtree must NOT have been called on the bogus path
        mock_rmtree.assert_not_called()


def test_scan_remote_rejects_traversal_in_path_segment(monkeypatch, tmp_path):
    """The optional path-within-repo also gets the .. check."""
    orch = _make_orchestrator(monkeypatch, tmp_path)
    with patch.object(orch.repo_fetcher, "parse_repo_url",
                      return_value=("github", "owner", "repo", None, "../etc", False)), \
         patch("src.standards_orchestrator.shutil.rmtree") as mock_rmtree:
        with pytest.raises(ValueError, match="path"):
            orch._scan_remote_repository("https://github.com/x/y", recursive=True)
        mock_rmtree.assert_not_called()


# ─── _clone_repository: argv `--` separator + encoding + timeout ─────────────


def test_clone_repository_uses_dash_dash_separator(monkeypatch, tmp_path):
    """Verify subprocess argv has `--` immediately before the clone_url so a
    URL starting with `-` can't be smuggled as a git option."""
    orch = _make_orchestrator(monkeypatch, tmp_path)
    captured = {}

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        # Return a fake CompletedProcess
        from subprocess import CompletedProcess
        return CompletedProcess(args, 0, stdout="", stderr="")

    with patch("src.standards_orchestrator.subprocess.run", side_effect=fake_run):
        orch._clone_repository(
            platform="github", owner="x", repo="y",
            branch=None, path=None,
            temp_dir=tmp_path / "clone",
        )

    args = captured["args"]
    # The clone_url must be preceded by `--`
    assert "--" in args, f"missing -- in argv: {args}"
    dash_idx = args.index("--")
    # And what comes immediately after must be the URL, not another option
    assert args[dash_idx + 1].startswith("https://"), f"not a URL after --: {args}"


def test_clone_repository_passes_encoding_and_timeout(monkeypatch, tmp_path):
    """Subprocess invocation must include encoding=utf-8 + errors=replace + timeout."""
    orch = _make_orchestrator(monkeypatch, tmp_path)
    captured = {}

    def fake_run(args, **kwargs):
        captured["kwargs"] = kwargs
        from subprocess import CompletedProcess
        return CompletedProcess(args, 0, stdout="", stderr="")

    with patch("src.standards_orchestrator.subprocess.run", side_effect=fake_run):
        orch._clone_repository("github", "x", "y", None, None, tmp_path / "clone")

    kw = captured["kwargs"]
    assert kw.get("encoding") == "utf-8"
    assert kw.get("errors") == "replace"
    assert kw.get("timeout") == 300
    assert kw.get("text") is True
    assert kw.get("capture_output") is True


def test_clone_repository_raises_on_timeout(monkeypatch, tmp_path):
    """TimeoutExpired is converted to a RuntimeError with the URL."""
    import subprocess as _sp
    orch = _make_orchestrator(monkeypatch, tmp_path)
    with patch("src.standards_orchestrator.subprocess.run",
               side_effect=_sp.TimeoutExpired("git", 300)):
        with pytest.raises(RuntimeError, match="timed out"):
            orch._clone_repository("github", "x", "y", None, None, tmp_path / "clone")


def test_clone_repository_raises_on_clone_failure(monkeypatch, tmp_path):
    """CalledProcessError surfaces stderr in a RuntimeError, not a raw traceback."""
    import subprocess as _sp
    orch = _make_orchestrator(monkeypatch, tmp_path)
    err = _sp.CalledProcessError(
        returncode=128, cmd=["git"], stderr="fatal: repository not found"
    )
    with patch("src.standards_orchestrator.subprocess.run", side_effect=err):
        with pytest.raises(RuntimeError, match="repository not found"):
            orch._clone_repository("github", "x", "y", None, None, tmp_path / "clone")
