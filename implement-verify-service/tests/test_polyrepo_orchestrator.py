"""Tests for the polyrepo orchestrator wiring (Phase 4).

Covers ``_polyrepo_extra_dirs`` (the coordination.yaml snapshot helper)
and the plumbing through ``_build_chat_executor`` to the chat-executor
factory. The chat executor itself is not invoked — we only verify the
``extra_dirs`` argv arrives at the factory call with the right shape.

haikai/specs/2026-05-25-polyrepo-analysis/tasks.md T4.1, T4.4, T4.5, T4.6.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")
os.environ.setdefault("CHAT_EXECUTOR", "claude")

from src.haikai_orchestrator import _build_chat_executor, _polyrepo_extra_dirs
from src.git.coordination import write_coordination


@pytest.fixture
def workspace():
    d = Path(tempfile.mkdtemp(prefix="polyrepo-orch-"))
    yield d
    shutil.rmtree(d, ignore_errors=True)


# ── _polyrepo_extra_dirs ─────────────────────────────────────────────────────


class TestPolyrepoExtraDirs:
    def test_no_coordination_yaml_returns_empty(self, workspace):
        assert _polyrepo_extra_dirs(workspace, "acme", "petclinic") == []

    def test_single_entry_returns_one_path(self, workspace):
        product_root = workspace / "acme" / "petclinic"
        write_coordination(product_root, {"app": "https://x/a.git"})
        result = _polyrepo_extra_dirs(workspace, "acme", "petclinic")
        assert result == [product_root / "app"]

    def test_multi_entry_returns_sorted_paths(self, workspace):
        product_root = workspace / "acme" / "petclinic"
        write_coordination(
            product_root,
            {
                "zeta": "https://x/z.git",
                "alpha": "https://x/a.git",
                "mu": "https://x/m.git",
            },
        )
        result = _polyrepo_extra_dirs(workspace, "acme", "petclinic")
        # Alphabetical for determinism — argv order matters across runs
        assert result == [
            product_root / "alpha",
            product_root / "mu",
            product_root / "zeta",
        ]


# ── _build_chat_executor plumbing ────────────────────────────────────────────


class TestBuildChatExecutorWithExtraDirs:
    @patch("src.backend_registry._build_claude_chat_executor_shim")
    def test_n1_passes_one_extra_dir(self, mock_shim, workspace):
        product_root = workspace / "acme" / "petclinic"
        write_coordination(product_root, {"app": "https://x/a.git"})

        _build_chat_executor(
            company="acme",
            project="petclinic",
            workspace_dir=workspace,
            anthropic_api_key="sk-ant-test",
        )

        assert mock_shim.called
        kwargs = mock_shim.call_args.kwargs
        assert "extra_dirs" in kwargs
        assert kwargs["extra_dirs"] == [product_root / "app"]

    @patch("src.backend_registry._build_claude_chat_executor_shim")
    def test_n3_passes_three_extra_dirs_sorted(self, mock_shim, workspace):
        product_root = workspace / "acme" / "petclinic"
        write_coordination(
            product_root,
            {
                "backend": "https://x/be.git",
                "frontend": "https://x/fe.git",
                "shared": "https://x/sh.git",
            },
        )

        _build_chat_executor(
            company="acme",
            project="petclinic",
            workspace_dir=workspace,
            anthropic_api_key="sk-ant-test",
        )

        kwargs = mock_shim.call_args.kwargs
        assert kwargs["extra_dirs"] == [
            product_root / "backend",
            product_root / "frontend",
            product_root / "shared",
        ]

    @patch("src.backend_registry._build_claude_chat_executor_shim")
    def test_legacy_project_with_no_coordination_yaml_passes_empty(
        self, mock_shim, workspace
    ):
        # No coordination.yaml written — legacy single-repo path.
        _build_chat_executor(
            company="acme",
            project="legacy",
            workspace_dir=workspace,
            anthropic_api_key="sk-ant-test",
        )
        kwargs = mock_shim.call_args.kwargs
        assert kwargs["extra_dirs"] == []


# ── ClaudeChatExecutor argv shape ────────────────────────────────────────────


class TestClaudeChatExecutorArgvShape:
    """Verify the --add-dir flags actually land in the Claude CLI argv.

    We bypass __init__ to skip the Claude-CLI-on-disk requirement and
    directly invoke _build_cli_command on a constructed instance.
    """

    def _make_executor(self, workspace, extra_dirs):
        from src.chat.claude_chat_executor import ClaudeChatExecutor

        exe = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
        exe.claude_cli_path = Path("/usr/local/bin/claude")
        exe.session_uuid = "00000000-0000-0000-0000-000000000000"
        exe.project_dir = workspace / "acme" / "petclinic"
        exe.extra_dirs = list(extra_dirs)
        # Bypass _haikai_profiles_path by patching the method on the instance
        exe._haikai_profiles_path = lambda: workspace / "_profiles"
        return exe

    def test_n1_argv_has_no_extra_add_dir(self, workspace):
        exe = self._make_executor(workspace, [])
        argv = exe._build_cli_command(prompt="hi", is_new_session=True)
        # Default mounts: project_dir + haikai-profiles. With no extras,
        # the count of --add-dir flags is exactly 2.
        assert argv.count("--add-dir") == 2

    def test_n3_argv_has_two_default_plus_three_extra(self, workspace):
        product_root = workspace / "acme" / "petclinic"
        extras = [
            product_root / "backend",
            product_root / "frontend",
            product_root / "shared",
        ]
        exe = self._make_executor(workspace, extras)
        argv = exe._build_cli_command(prompt="hi", is_new_session=True)
        assert argv.count("--add-dir") == 5
        # Each extra appears as a positional after --add-dir
        for d in extras:
            assert str(d).replace("\\", "/") in argv
