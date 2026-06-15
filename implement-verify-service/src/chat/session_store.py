"""
Active session store for per-project session management.

Each (company, project) has at most one active Claude CLI session.
The session ID is a random UUID4 stored in a JSON file on disk.
"""

import json
import uuid
import logging
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

from src.path_safety import safe_segment as _safe_segment  # noqa: F401 — re-export for tests
from src.project_ref import ProjectRef

logger = logging.getLogger(__name__)


def _session_file(workspace_dir: Path, company: str, project: str) -> Path:
    """Return the path to the active session JSON file."""
    return (
        ProjectRef.from_strings(company, project).as_dir(workspace_dir)
        / ".claude" / "active_session.json"
    )


def create_active_session(workspace_dir: Path, company: str, project: str) -> str:
    """Generate a new random UUID4 session, write it to disk, return it.

    If a previous active session exists, it is replaced.

    Also ensures `.claude/.gitignore` covers every runtime artifact the
    executor drops in `.claude/`, so the cloned repo's git state stays
    clean. Without this, `gm.pull_latest()` and `git checkout` on
    subsequent runs fail because the working tree has uncommitted/
    untracked files that aren't in the upstream tree.

    Tracked entries:
      - active_session.json (per-session pointer)
      - settings.json       (project-scoped permissions; auto-recreated)
      - commands/           (Haikai commands; copied by _setup_claude_commands)

    Idempotent: appends any missing entry rather than clobbering existing
    customizations.
    """
    session_id = str(uuid.uuid4())
    session_file = _session_file(workspace_dir, company, project)
    session_file.parent.mkdir(parents=True, exist_ok=True)

    # Prevent runtime files from dirtying the project's git tree.
    gitignore = session_file.parent / ".gitignore"
    required = ("active_session.json", "settings.json", "commands/")
    existing_text = (
        gitignore.read_text(encoding="utf-8") if gitignore.exists() else ""
    )
    existing_entries = set(existing_text.splitlines())
    missing = [e for e in required if e not in existing_entries]
    if missing:
        prefix = "" if existing_text == "" or existing_text.endswith("\n") else "\n"
        with gitignore.open("a", encoding="utf-8") as f:
            f.write(prefix + "\n".join(missing) + "\n")

    data = {
        "session_id": session_id,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    session_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    logger.info(f"Created active session {session_id} for {company}/{project}")
    return session_id


def get_active_session(workspace_dir: Path, company: str, project: str) -> Optional[str]:
    """Read the active session ID for (company, project). Returns None if no active session."""
    session_file = _session_file(workspace_dir, company, project)
    if not session_file.exists():
        return None
    try:
        data = json.loads(session_file.read_text(encoding="utf-8"))
        session_id = data.get("session_id")
        if session_id:
            logger.debug(f"Active session for {company}/{project}: {session_id}")
        return session_id
    except (json.JSONDecodeError, KeyError) as e:
        logger.warning(f"Corrupt active_session.json for {company}/{project}: {e}")
        return None


def clear_active_session(workspace_dir: Path, company: str, project: str) -> bool:
    """Delete the active session file. Returns True if removed."""
    session_file = _session_file(workspace_dir, company, project)
    if session_file.exists():
        session_file.unlink()
        logger.info(f"Cleared active session for {company}/{project}")
        return True
    return False
