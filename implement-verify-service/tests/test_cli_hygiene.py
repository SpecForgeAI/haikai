"""Hygiene tests for the CLI surface.

Covers regressions for:
- `analyze --no-treesitter` must not leak `AST_TREESITTER_ENABLED=false`
  to subsequent invocations in the same process.
- `extract-endpoints --endpoints-only --interactions-only` must reject
  the conflicting flag combination instead of silently producing nothing.
- The unused `--no-llm` flag must no longer exist on extract-endpoints.
"""
from __future__ import annotations

import os

from click.testing import CliRunner

from src.cli import cli


def test_extract_endpoints_no_llm_flag_removed():
    """The dead --no-llm flag was removed; passing it now errors."""
    runner = CliRunner()
    result = runner.invoke(cli, ["extract-endpoints", "--store-path", ".", "--no-llm"])
    assert result.exit_code != 0
    assert "no-llm" in result.output.lower() or "no such option" in result.output.lower()


def test_extract_endpoints_mutex_flags_rejected(tmp_path):
    """--endpoints-only and --interactions-only together → exit 1."""
    runner = CliRunner()
    # store-path needs to exist (click.Path(exists=True))
    (tmp_path / "_index.txt").write_text("")
    (tmp_path / "_calls.txt").write_text("")
    result = runner.invoke(
        cli,
        [
            "extract-endpoints",
            "--store-path", str(tmp_path),
            "--endpoints-only",
            "--interactions-only",
        ],
    )
    assert result.exit_code == 1
    assert "mutually exclusive" in result.output


def test_analyze_no_treesitter_does_not_leak_env(monkeypatch, tmp_path):
    """analyze --no-treesitter must restore AST_TREESITTER_ENABLED on exit."""
    monkeypatch.delenv("AST_TREESITTER_ENABLED", raising=False)

    # Create an empty project dir — analyze will fail early on "no source
    # files" but that's fine; we only care that the env restore runs.
    proj = tmp_path / "empty-proj"
    proj.mkdir()

    runner = CliRunner()
    runner.invoke(cli, ["analyze", "--project-dir", str(proj), "--no-treesitter"])

    # After invocation, env var should be unset (matches pre-call state)
    assert "AST_TREESITTER_ENABLED" not in os.environ


def test_analyze_no_treesitter_restores_prior_value(monkeypatch, tmp_path):
    """If AST_TREESITTER_ENABLED was set beforehand, restore that value."""
    monkeypatch.setenv("AST_TREESITTER_ENABLED", "true")

    proj = tmp_path / "empty-proj"
    proj.mkdir()

    runner = CliRunner()
    runner.invoke(cli, ["analyze", "--project-dir", str(proj), "--no-treesitter"])

    # After invocation, original value should be restored
    assert os.environ.get("AST_TREESITTER_ENABLED") == "true"
