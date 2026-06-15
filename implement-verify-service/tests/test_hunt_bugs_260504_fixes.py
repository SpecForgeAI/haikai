"""Regression tests for the autoresearch:debug 260504-0823 hunt-bugs fixes.

One test class per finding (F1, F2, F3, F6, F7, F9). F4's tests live in
tests/api/test_analyze_observability.py, and F5's tests are added to the
existing tests/test_dep_refactoring_hardening.py.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


# ─── F1: chat tool_executor workspace containment ────────────────────────────


class TestChatToolWorkspaceContainment:
    """write_to_file and read_file must reject paths that escape workspace."""

    def setup_method(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir()

    def teardown_method(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_write_to_file_rejects_absolute_path(self):
        from src.chat.tool_executor import ToolExecutor

        exe = ToolExecutor(self.workspace)
        # Absolute path would WIN under Path / semantics in the old code.
        attack_path = str(self.tmp / "outside.txt")
        with pytest.raises(ValueError, match="escapes workspace"):
            exe._execute_write_to_file({"path": attack_path, "content": "pwned"})
        assert not (self.tmp / "outside.txt").exists()

    def test_write_to_file_rejects_dotdot_traversal(self):
        from src.chat.tool_executor import ToolExecutor

        exe = ToolExecutor(self.workspace)
        with pytest.raises(ValueError, match="escapes workspace"):
            exe._execute_write_to_file(
                {"path": "../outside.txt", "content": "pwned"}
            )
        assert not (self.tmp / "outside.txt").exists()

    def test_write_to_file_allows_legitimate_subpath(self):
        from src.chat.tool_executor import ToolExecutor

        exe = ToolExecutor(self.workspace)
        result = exe._execute_write_to_file(
            {"path": "sub/dir/note.md", "content": "ok"}
        )
        assert result["success"] is True
        assert (self.workspace / "sub" / "dir" / "note.md").read_text() == "ok"

    def test_read_file_rejects_absolute_path(self):
        from src.chat.tool_executor import ToolExecutor

        secret = self.tmp / "secret.txt"
        secret.write_text("classified")
        exe = ToolExecutor(self.workspace)
        with pytest.raises(ValueError, match="escapes workspace"):
            exe._execute_read_file({"path": str(secret)})

    def test_read_file_rejects_dotdot_traversal(self):
        from src.chat.tool_executor import ToolExecutor

        (self.tmp / "secret.txt").write_text("classified")
        exe = ToolExecutor(self.workspace)
        with pytest.raises(ValueError, match="escapes workspace"):
            exe._execute_read_file({"path": "../secret.txt"})


# ─── F8: read_file size cap (without errors='replace') ───────────────────────


class TestReadFileSizeCap:
    """A 1 MB hard cap protects against LLM-issued reads of huge files
    OOMing the worker. Encoding stays strict (no errors='replace') so the
    LLM gets a clean UnicodeDecodeError on binary content."""

    def setup_method(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.workspace = self.tmp / "workspace"
        self.workspace.mkdir()

    def teardown_method(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_file_under_cap_reads_normally(self):
        from src.chat.tool_executor import ToolExecutor

        small = self.workspace / "small.txt"
        small.write_text("hello world", encoding="utf-8")
        result = ToolExecutor(self.workspace)._execute_read_file({"path": "small.txt"})
        assert result["success"] is True
        assert result["output"] == "hello world"

    def test_file_at_cap_boundary_reads(self):
        from src.chat.tool_executor import ToolExecutor
        from src.chat.tool_executor import _MAX_READ_BYTES

        boundary = self.workspace / "exactly_1mb.txt"
        # Exactly _MAX_READ_BYTES — the cap is `>`, not `>=`, so this passes
        boundary.write_bytes(b"a" * _MAX_READ_BYTES)
        result = ToolExecutor(self.workspace)._execute_read_file(
            {"path": "exactly_1mb.txt"}
        )
        assert result["success"] is True
        assert len(result["output"]) == _MAX_READ_BYTES

    def test_file_over_cap_refused_without_reading(self):
        from src.chat.tool_executor import ToolExecutor
        from src.chat.tool_executor import _MAX_READ_BYTES

        too_big = self.workspace / "huge.txt"
        too_big.write_bytes(b"a" * (_MAX_READ_BYTES + 1))
        result = ToolExecutor(self.workspace)._execute_read_file(
            {"path": "huge.txt"}
        )
        assert result["success"] is False
        assert result["output"] == ""
        # Error message includes both the actual size and the cap so the
        # LLM can decide between grep, sampling, or structural query.
        assert "exceeds" in result["error"].lower()
        assert str(_MAX_READ_BYTES) in result["error"].replace(",", "")

    def test_binary_file_raises_unicode_error_not_silent_corruption(self):
        """Strict-encoding decision: binary content surfaces as a real
        decode error rather than U+FFFD-laden garbage. The LLM gets
        actionable feedback ("this is binary") instead of word salad."""
        from src.chat.tool_executor import ToolExecutor

        binary = self.workspace / "image.bin"
        # Bytes that are invalid UTF-8 (lone continuation byte 0x80)
        binary.write_bytes(b"\x80\x81\x82\x83")
        with pytest.raises(UnicodeDecodeError):
            ToolExecutor(self.workspace)._execute_read_file({"path": "image.bin"})


# ─── F2 + F3: _clone_repo path safety + project-root anchor ──────────────────


class TestCloneRepoSafety:
    def test_traversal_via_owner_segment_rejected(self):
        from src.structural_endpoints import _clone_repo
        from fastapi import HTTPException

        # `https://github.com/anyowner/...git` parses to repo='..' which
        # was the proven attack URL in the debug session.
        with pytest.raises(HTTPException) as exc:
            _clone_repo("https://github.com/anyowner/...git")
        assert exc.value.status_code == 400

    def test_clone_root_anchored_to_project_when_env_unset(self):
        from src.structural_endpoints import _clone_root

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("AST_STORE_PATH", None)
            cwd_before = os.getcwd()
            tmp = tempfile.mkdtemp()
            try:
                os.chdir(tmp)
                root = _clone_root()
            finally:
                os.chdir(cwd_before)
                shutil.rmtree(tmp, ignore_errors=True)

        # Must NOT be under the bogus cwd
        bp = root.resolve()
        assert Path(tmp).resolve() not in bp.parents, (
            f"clone root anchored to cwd ({tmp}) instead of project root: {bp}"
        )
        # Must end in .specforge/repos
        assert bp.parts[-2:] == (".specforge", "repos")

    def test_env_override_wins(self):
        from src.structural_endpoints import _clone_root

        tmp = tempfile.mkdtemp()
        override = Path(tmp) / "custom-store"
        try:
            with patch.dict(os.environ, {"AST_STORE_PATH": str(override)}):
                root = _clone_root()
            # When AST_STORE_PATH=<x>, clone root is <x>.parent/repos
            assert root.resolve() == (override.parent / "repos").resolve()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


# ─── F6: ClaudeCLIExecutor copy-if-absent ────────────────────────────────────


class TestClaudeCommandsCopyIfAbsent:
    """User customisations in ~/.claude/commands/*.md must survive
    executor init unless CLAUDE_FORCE_REFRESH_COMMANDS=true."""

    def test_existing_user_command_preserved(self, tmp_path, monkeypatch):
        from src import claude_cli_executor as cce

        fake_home = tmp_path / "home"
        commands_dir = fake_home / ".claude" / "commands"
        commands_dir.mkdir(parents=True)
        custom = commands_dir / "write-spec.md"
        custom.write_text("MY CUSTOM CONTENT", encoding="utf-8")

        monkeypatch.setenv("USERPROFILE", str(fake_home))
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.delenv("CLAUDE_FORCE_REFRESH_COMMANDS", raising=False)

        # Build a fake project_root with an haikai-profiles tree so the
        # source files exist. The Executor only takes project_dir, so we
        # call _setup_claude_commands directly via a stub instance.
        project_root = tmp_path / "project"
        src_dir = project_root / "haikai-profiles" / "default" / "commands" / "write-spec" / "single-agent"
        src_dir.mkdir(parents=True)
        (src_dir / "write-spec.md").write_text("DEFAULT", encoding="utf-8")
        # Empty placeholders for the other 4 commands so the loop runs cleanly
        for cn in ("create-tasks", "implement-tasks", "shape-spec", "plan-product"):
            d = project_root / "haikai-profiles" / "default" / "commands" / cn / "single-agent"
            d.mkdir(parents=True)
            (d / f"{cn}.md").write_text("DEFAULT", encoding="utf-8")

        # Instantiate via __new__ to skip the executor's __init__ cwd checks
        ex = cce.ClaudeCLIExecutor.__new__(cce.ClaudeCLIExecutor)
        ex._setup_claude_commands(project_root)

        assert custom.read_text(encoding="utf-8") == "MY CUSTOM CONTENT", (
            "user customisation was overwritten — copy-if-absent regressed"
        )
        # And the other 4 commands DID land (they didn't pre-exist)
        for cn in ("create-tasks", "implement-tasks", "shape-spec", "plan-product"):
            assert (commands_dir / f"{cn}.md").read_text(encoding="utf-8") == "DEFAULT"

    def test_force_refresh_overwrites(self, tmp_path, monkeypatch):
        from src import claude_cli_executor as cce

        fake_home = tmp_path / "home"
        commands_dir = fake_home / ".claude" / "commands"
        commands_dir.mkdir(parents=True)
        custom = commands_dir / "write-spec.md"
        custom.write_text("MY CUSTOM CONTENT", encoding="utf-8")

        monkeypatch.setenv("USERPROFILE", str(fake_home))
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.setenv("CLAUDE_FORCE_REFRESH_COMMANDS", "true")

        project_root = tmp_path / "project"
        for cn, sub in (
            ("write-spec", "write-spec/single-agent/write-spec.md"),
            ("create-tasks", "create-tasks/single-agent/create-tasks.md"),
            ("implement-tasks", "implement-tasks/single-agent/implement-tasks.md"),
            ("shape-spec", "shape-spec/single-agent/shape-spec.md"),
            ("plan-product", "plan-product/single-agent/plan-product.md"),
        ):
            p = project_root / "haikai-profiles" / "default" / "commands" / Path(sub).parent
            p.mkdir(parents=True)
            (p / f"{cn}.md").write_text("DEFAULT", encoding="utf-8")

        ex = cce.ClaudeCLIExecutor.__new__(cce.ClaudeCLIExecutor)
        ex._setup_claude_commands(project_root)

        assert custom.read_text(encoding="utf-8") == "DEFAULT", (
            "force-refresh did not overwrite — opt-in escape hatch broken"
        )


# ─── F7: traceback not leaked in API response ────────────────────────────────


class TestOperationExecutorErrorShape:
    def test_product_standards_error_omits_traceback(self, tmp_path):
        from src.operation_executor import OperationExecutor
        from src.models import GenerateProductStandardsRequest, OperationMode

        # Build a valid-looking request that will fail downstream (no LLM
        # config), so we can inspect the OperationResponse.errors shape.
        req = GenerateProductStandardsRequest(
            company="acme",
            project="backend",
            sources=[],
            recursive=False,
            mode=OperationMode.GENERATE_PRODUCT_STANDARDS,
        )
        executor = OperationExecutor({}, workspace_dir=tmp_path)
        resp = executor._generate_product_standards(req)

        assert resp.success is False
        # New shape: a single str(e), NO traceback frames
        assert len(resp.errors) == 1, (
            f"expected single-string errors, got: {resp.errors}"
        )
        # And specifically no `Traceback (most recent call last)` etc.
        err = resp.errors[0]
        assert "Traceback" not in err
        assert "File \"" not in err  # no stack-frame format


# ─── F9: short-SHA staleness comparison ──────────────────────────────────────


class TestStalenessShortSha:
    """A 7-char snapshot dir should match a 40-char HEAD that starts with it."""

    @staticmethod
    def _git(repo: Path, *args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=repo, capture_output=True, text=True,
            encoding="utf-8", errors="replace", check=True,
        ).stdout

    def _seed_repo(self, root: Path) -> str:
        root.mkdir(parents=True, exist_ok=True)
        self._git(root, "init", "-b", "main")
        self._git(root, "config", "user.email", "t@t.t")
        self._git(root, "config", "user.name", "t")
        (root / "a.txt").write_text("hi\n", encoding="utf-8")
        self._git(root, "add", "a.txt")
        self._git(root, "commit", "-m", "init")
        return self._git(root, "rev-parse", "HEAD").strip()

    def test_short_sha_dirname_matches_head(self, tmp_path):
        from src.refactoring.staleness import check_staleness

        repo = tmp_path / "repo"
        full = self._seed_repo(repo)
        short = full[:7]

        # Snapshot dir whose name is the 7-char short SHA. No meta files —
        # the dir-name fallback in _read_snapshot_sha is the only signal.
        snap = tmp_path / "snaps" / short
        snap.mkdir(parents=True)
        # Mark it old enough to avoid the mtime fallback path
        report = check_staleness(snap, repo)

        assert report.snapshot_sha == short
        assert report.head_sha == full
        # The bug: this used to be 'outdated' because short != full.
        # The fix: report fresh (or stale, if dirty) but NOT outdated.
        assert report.level != "outdated", (
            f"short SHA mis-classified as outdated; report={report}"
        )
