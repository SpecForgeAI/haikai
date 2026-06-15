"""
Unit tests for session persistence: persist_session_to_spec and restore_session_from_spec.

Tests verify that:
1. active_session.json is written to the spec folder with correct content
2. The Claude CLI session .jsonl is copied into the spec folder
3. restore_session_from_spec restores the .jsonl when Claude's copy is missing
4. Restore is skipped when Claude's session file already exists
5. Edge cases: missing spec dir, missing backup, corrupt active_session.json
"""

import json
import pytest
import tempfile
import shutil
import uuid
from pathlib import Path
from unittest.mock import patch
from datetime import datetime

from src.chat.claude_chat_executor import ClaudeChatExecutor


@pytest.fixture
def workspace(tmp_path):
    """Create a workspace with project dir and spec folder."""
    company = "testco"
    project = "testproj"
    project_dir = tmp_path / company / project
    spec_name = "2026-03-15-my-feature"
    spec_dir = project_dir / "haikai" / "specs" / spec_name
    spec_dir.mkdir(parents=True)
    return {
        "tmp_path": tmp_path,
        "company": company,
        "project": project,
        "project_dir": project_dir,
        "spec_name": spec_name,
        "spec_dir": spec_dir,
    }


@pytest.fixture
def executor(workspace):
    """Create a ClaudeChatExecutor with mocked paths (skips __init__ side effects)."""
    ex = ClaudeChatExecutor.__new__(ClaudeChatExecutor)
    ex.company = workspace["company"]
    ex.project = workspace["project"]
    ex.project_dir = workspace["project_dir"]
    session_string = f"{ex.company}_{ex.project}"
    ex.session_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, session_string))
    ex.session_id = session_string
    ex.extra_dirs = []  # set by real __init__ (b44ac09); __new__ bypasses it
    return ex


@pytest.fixture
def fake_session_file(executor, tmp_path):
    """Create a fake Claude CLI session .jsonl and mock get_session_file to return it."""
    claude_session_dir = tmp_path / ".claude" / "projects" / "fake-encoded-path"
    claude_session_dir.mkdir(parents=True)
    session_file = claude_session_dir / f"{executor.session_uuid}.jsonl"
    session_file.write_text('{"type":"message","content":"hello"}\n', encoding="utf-8")
    return session_file


# =============================================================================
# persist_session_to_spec tests
# =============================================================================

class TestPersistSessionToSpec:
    """Tests for persist_session_to_spec method."""

    def test_writes_active_session_json(self, executor, workspace, fake_session_file):
        """active_session.json is created with correct fields."""
        with patch.object(executor, "get_session_file", return_value=fake_session_file):
            executor.persist_session_to_spec(workspace["spec_name"])

        active_path = workspace["spec_dir"] / "active_session.json"
        assert active_path.exists()

        data = json.loads(active_path.read_text(encoding="utf-8"))
        assert data["session_id"] == executor.session_uuid
        assert data["spec_name"] == workspace["spec_name"]
        assert "created_at" in data
        # Verify created_at is valid ISO format
        datetime.fromisoformat(data["created_at"])

    def test_copies_session_jsonl(self, executor, workspace, fake_session_file):
        """The .jsonl session file is copied into the spec folder."""
        with patch.object(executor, "get_session_file", return_value=fake_session_file):
            executor.persist_session_to_spec(workspace["spec_name"])

        copied = workspace["spec_dir"] / f"{executor.session_uuid}.jsonl"
        assert copied.exists()
        assert copied.read_text(encoding="utf-8") == fake_session_file.read_text(encoding="utf-8")

    def test_skips_when_spec_dir_missing(self, executor, workspace, fake_session_file):
        """No error when the spec directory doesn't exist."""
        shutil.rmtree(workspace["spec_dir"])
        with patch.object(executor, "get_session_file", return_value=fake_session_file):
            # Should not raise
            executor.persist_session_to_spec(workspace["spec_name"])

        assert not workspace["spec_dir"].exists()

    def test_handles_missing_session_file(self, executor, workspace, tmp_path):
        """active_session.json is still written even if session .jsonl is missing."""
        missing_file = tmp_path / "nonexistent" / f"{executor.session_uuid}.jsonl"
        with patch.object(executor, "get_session_file", return_value=missing_file):
            executor.persist_session_to_spec(workspace["spec_name"])

        active_path = workspace["spec_dir"] / "active_session.json"
        assert active_path.exists()

        copied = workspace["spec_dir"] / f"{executor.session_uuid}.jsonl"
        assert not copied.exists()

    def test_overwrites_existing_active_session(self, executor, workspace, fake_session_file):
        """Calling persist twice overwrites active_session.json with updated timestamp."""
        with patch.object(executor, "get_session_file", return_value=fake_session_file):
            executor.persist_session_to_spec(workspace["spec_name"])
            first = json.loads((workspace["spec_dir"] / "active_session.json").read_text(encoding="utf-8"))

            executor.persist_session_to_spec(workspace["spec_name"])
            second = json.loads((workspace["spec_dir"] / "active_session.json").read_text(encoding="utf-8"))

        assert first["session_id"] == second["session_id"]
        # created_at should be updated (or at least still valid)
        datetime.fromisoformat(second["created_at"])


# =============================================================================
# restore_session_from_spec tests
# =============================================================================

class TestRestoreSessionFromSpec:
    """Tests for restore_session_from_spec method."""

    def test_restores_from_spec_backup(self, executor, workspace, tmp_path):
        """When Claude's session file is missing, restore from spec folder backup."""
        # Set up: session file does NOT exist at Claude's location
        claude_session_dir = tmp_path / ".claude" / "projects" / "encoded"
        missing_session_file = claude_session_dir / f"{executor.session_uuid}.jsonl"

        # Set up: backup exists in spec folder
        backup_content = '{"type":"message","content":"restored"}\n'
        backup_file = workspace["spec_dir"] / f"{executor.session_uuid}.jsonl"
        backup_file.write_text(backup_content, encoding="utf-8")

        active_session = {
            "session_id": executor.session_uuid,
            "created_at": datetime.now().isoformat(),
            "spec_name": workspace["spec_name"],
        }
        (workspace["spec_dir"] / "active_session.json").write_text(
            json.dumps(active_session), encoding="utf-8"
        )

        with patch.object(executor, "get_session_file", return_value=missing_session_file):
            result = executor.restore_session_from_spec()

        assert result == workspace["spec_name"]
        assert missing_session_file.exists()
        assert missing_session_file.read_text(encoding="utf-8") == backup_content

    def test_skips_when_session_exists(self, executor, workspace, fake_session_file):
        """No restore needed when Claude's session file already exists."""
        with patch.object(executor, "get_session_file", return_value=fake_session_file):
            result = executor.restore_session_from_spec()

        assert result is None

    def test_returns_none_when_no_specs_dir(self, executor, workspace, tmp_path):
        """Returns None when haikai/specs doesn't exist."""
        shutil.rmtree(workspace["project_dir"] / "haikai")
        missing_file = tmp_path / "missing" / f"{executor.session_uuid}.jsonl"

        with patch.object(executor, "get_session_file", return_value=missing_file):
            result = executor.restore_session_from_spec()

        assert result is None

    def test_returns_none_when_no_matching_session(self, executor, workspace, tmp_path):
        """Returns None when no active_session.json matches the session_id."""
        # Write an active_session.json with a different session_id
        active_session = {
            "session_id": "different-uuid",
            "created_at": datetime.now().isoformat(),
            "spec_name": workspace["spec_name"],
        }
        (workspace["spec_dir"] / "active_session.json").write_text(
            json.dumps(active_session), encoding="utf-8"
        )

        missing_file = tmp_path / "missing" / f"{executor.session_uuid}.jsonl"
        with patch.object(executor, "get_session_file", return_value=missing_file):
            result = executor.restore_session_from_spec()

        assert result is None

    def test_handles_corrupt_active_session_json(self, executor, workspace, tmp_path):
        """Gracefully handles corrupt active_session.json."""
        (workspace["spec_dir"] / "active_session.json").write_text(
            "not valid json{{{", encoding="utf-8"
        )

        missing_file = tmp_path / "missing" / f"{executor.session_uuid}.jsonl"
        with patch.object(executor, "get_session_file", return_value=missing_file):
            result = executor.restore_session_from_spec()

        assert result is None

    def test_handles_matching_session_but_missing_jsonl_backup(self, executor, workspace, tmp_path):
        """Warns when active_session.json matches but the .jsonl backup is gone."""
        active_session = {
            "session_id": executor.session_uuid,
            "created_at": datetime.now().isoformat(),
            "spec_name": workspace["spec_name"],
        }
        (workspace["spec_dir"] / "active_session.json").write_text(
            json.dumps(active_session), encoding="utf-8"
        )
        # No .jsonl backup file

        missing_file = tmp_path / "missing" / f"{executor.session_uuid}.jsonl"
        with patch.object(executor, "get_session_file", return_value=missing_file):
            result = executor.restore_session_from_spec()

        assert result is None

    def test_creates_parent_dirs_on_restore(self, executor, workspace, tmp_path):
        """Restore creates the Claude session directory if it doesn't exist."""
        deeply_nested = tmp_path / "a" / "b" / "c" / f"{executor.session_uuid}.jsonl"

        backup_content = '{"restored": true}\n'
        (workspace["spec_dir"] / f"{executor.session_uuid}.jsonl").write_text(
            backup_content, encoding="utf-8"
        )
        (workspace["spec_dir"] / "active_session.json").write_text(
            json.dumps({
                "session_id": executor.session_uuid,
                "created_at": datetime.now().isoformat(),
                "spec_name": workspace["spec_name"],
            }),
            encoding="utf-8",
        )

        with patch.object(executor, "get_session_file", return_value=deeply_nested):
            result = executor.restore_session_from_spec()

        assert result == workspace["spec_name"]
        assert deeply_nested.exists()
