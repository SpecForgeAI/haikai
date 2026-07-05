"""Executor-agnostic worktree preparation (parallel-worktrees).

A fresh git worktree is a directory the chat-executor CLI has never seen.
Each backend needs DIFFERENT prep before a session can run there, so the
worktree allocator must NOT hardcode one CLI's assumptions:

- **claude**: the CLI treats a new dir as UNTRUSTED and ignores the
  workspace `.claude/settings.json` permissions until trusted, and its
  resumable transcript lives under `~/.claude/projects/<encoded cwd>` —
  neither follows into a fresh worktree. Prep: seed trust in
  `~/.claude.json` + transplant the encoded session dir.
- **kiro**: passes `--no-interactive --trust-all-tools` on every call (no
  trust file, no untrusted-dir problem) and resolves the session by CWD
  (`--resume` takes no id); its `.kiro/skills` are re-created by the Kiro
  executor's own init in the worktree cwd. Prep: nothing to seed.

Dispatch on `CHAT_EXECUTOR`. Unknown backend → warn + no-op. Best-effort:
never fail allocation over prep (a prep failure surfaces later as a real
session error, not a silent-but-different allocation).
"""

import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def _active_backend() -> str:
    # Read directly (not backend_registry._executor_backend, which raises an
    # HTTPException on unset — wrong failure mode for the worker/allocator).
    # The worker always sets CHAT_EXECUTOR; default to claude if somehow unset.
    return os.getenv("CHAT_EXECUTOR", "claude").strip().lower()


def prepare_worktree(project_dir, live_product: Optional[Path] = None,
                     backend: Optional[str] = None) -> None:
    """Prepare a fresh worktree for the active backend's chat session.

    project_dir:  the session cwd inside the worktree (the product root).
    live_product: the original live-checkout product root whose session is
                  re-homed into the worktree; None = no session re-home
                  (e.g. verify worktrees, which always run fresh).
    backend:      override the active backend (tests).
    """
    b = backend or _active_backend()
    try:
        if b == "claude":
            _claude_prepare(Path(project_dir), live_product)
        elif b == "kiro":
            _kiro_prepare(Path(project_dir), live_product)
        else:
            logger.warning("worktree prep: unknown backend %r — no-op", b)
    except Exception:
        logger.warning("worktree prep (%s) failed for %s", b, project_dir,
                       exc_info=True)


def _claude_prepare(project_dir: Path, live_product: Optional[Path]) -> None:
    from src.git import worktree_runs as wr

    wr.trust_worktree_path(project_dir)
    if live_product is not None:
        wr.transplant_session_dir(str(live_product), str(project_dir))


def _kiro_prepare(project_dir: Path, live_product: Optional[Path]) -> None:
    # Kiro trusts via `--trust-all-tools` (no ~/.claude.json), keys its
    # session by cwd (nothing to transplant into an encoded store), and its
    # KiroChatExecutor init re-creates `.kiro/skills` in this worktree cwd.
    # So there is nothing to seed here — but the hook exists so the allocator
    # stays executor-agnostic and Kiro-specific prep has a home if the CLI
    # grows a per-directory trust/session artifact later.
    logger.info("worktree prep (kiro): no seeding — trust via --trust-all-tools, "
                "session keyed by cwd, skills via executor init (%s)", project_dir)
