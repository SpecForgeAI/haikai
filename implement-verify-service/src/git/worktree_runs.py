"""Per-run git worktree allocation / reclamation (parallel-worktrees spec v2).

One job (or one spec of a per-spec run) = one worktree set at
``<workspace>/wt/<job_id8>[/<spec>]``, on its own branch, seeded with the
untracked live-checkout state the runtime hard-requires. The live checkout's
repo tree is never mutated (W1); the shared ``.git`` is mutated only under
the narrowed project lock (W4: worktree add/remove/prune).

Reclamation is governed by the D14 predicate — job status alone NEVER
authorizes removal — and always copies observability artifacts out first
(predicate condition 6). Windows removal ladder per W8.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# Heartbeat staleness beyond which a non-running job's process is presumed
# dead (mirrors recovery's discriminator; D14 condition 4).
STALE_HEARTBEAT_SECONDS = 300


class WorktreeAllocationError(RuntimeError):
    """Fail-fast allocation errors (W5): branch active elsewhere, submodule
    repo, missing base, seed-source missing, checksum mismatch."""


class WorktreeReclaimError(RuntimeError):
    pass


def _git(repo_dir, *args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(repo_dir), *args],
                          capture_output=True, text=True)


def _require(cp: subprocess.CompletedProcess, what: str) -> subprocess.CompletedProcess:
    if cp.returncode != 0:
        raise WorktreeAllocationError(f"{what}: {(cp.stdout + cp.stderr)[-400:]}")
    return cp


def project_git_lock(workspace_dir: str, company: str, project: str):
    """The narrowed shared-.git lock (same file the orchestration phase used
    pre-worktrees, now held only around worktree add/remove/prune)."""
    from src.file_lock import exclusive_lock

    key = hashlib.sha256(f"{company}/{project}".encode()).hexdigest()[:16]
    lock_path = Path(workspace_dir) / ".locks" / f"orch-git-{key}.lock"
    return exclusive_lock(lock_path)


def run_root(workspace_dir: str, job_id: str, spec: Optional[str] = None) -> Path:
    """Short root (W8 path budget): <workspace>/wt/<job_id8>[/<spec>]."""
    root = Path(workspace_dir) / "wt" / job_id[:8]
    return root / spec if spec else root


# ── D4 branch policy ─────────────────────────────────────────────────────────

def branch_checked_out_at(live_repo: Path, branch: str) -> Optional[str]:
    """Path of the worktree that has `branch` checked out, else None."""
    cp = _git(live_repo, "worktree", "list", "--porcelain")
    if cp.returncode != 0:
        return None
    current_path = None
    for line in cp.stdout.splitlines():
        if line.startswith("worktree "):
            current_path = line[len("worktree "):].strip()
        elif line.startswith("branch ") and current_path:
            if line.strip() == f"branch refs/heads/{branch}":
                return current_path
    return None


def _branch_exists(live_repo: Path, branch: str) -> bool:
    return _git(live_repo, "show-ref", "--verify", "--quiet",
                f"refs/heads/{branch}").returncode == 0


def _has_submodules(live_repo: Path) -> bool:
    return (Path(live_repo) / ".gitmodules").exists()


def add_worktree(live_repo: Path, path: Path, branch: str, base: str,
                 job_id: str = "") -> None:
    """The three-way allocation rule (D4, user ruling verbatim):
    absent → add -b; exists+active elsewhere → fail clearly;
    exists+free → add without -b. Detached mode: branch=None."""
    if _has_submodules(live_repo):
        raise WorktreeAllocationError(
            f"repo {live_repo} uses submodules — unsupported under worktree "
            "mode (W5 fail-fast; use WORKTREE_RUNS=off)")
    path.parent.mkdir(parents=True, exist_ok=True)
    if branch is None:
        _require(_git(live_repo, "worktree", "add", "--detach", str(path), base),
                 f"cannot create detached worktree at {base}")
    else:
        holder = branch_checked_out_at(live_repo, branch)
        if holder:
            raise WorktreeAllocationError(
                f"branch {branch} is active in another worktree ({holder}) — "
                f"refusing allocation for job {job_id or '?'}")
        if _branch_exists(live_repo, branch):
            _require(_git(live_repo, "worktree", "add", str(path), branch),
                     f"cannot attach worktree to existing branch {branch}")
        else:
            _require(_git(live_repo, "worktree", "add", "-b", branch,
                          str(path), base),
                     f"cannot create worktree branch {branch} from {base}")
    if job_id:
        _git(live_repo, "worktree", "lock",
             "--reason", f"job {job_id} active", str(path))


def create_branch_in_worktree(worktree: Path, branch: str, base: str) -> None:
    """Worktree-safe mid-run branch creation: single command with a
    start-point — never checks out the default branch (the linked-worktree
    crash at git_manager's two-step checkout)."""
    _require(_git(worktree, "checkout", "-b", branch, base),
             f"cannot create branch {branch} from {base} in worktree")


def detach_to(worktree: Path, ref: str) -> None:
    """Between-spec reset inside a worktree (never `checkout <default>`)."""
    _require(_git(worktree, "checkout", "--detach", ref),
             f"cannot detach worktree to {ref}")


# ── D2 seeding ───────────────────────────────────────────────────────────────

def _copytree(src: Path, dst: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dst, dirs_exist_ok=True)
    elif src.is_file():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def seed_run_root(product_root: Path, dest_root: Path,
                  specs: Iterable[str]) -> list[str]:
    """Copy the untracked live-checkout state a fresh worktree lacks:
    the SCOPED spec trees (never the whole haikai/ — a concurrent
    shape-spec session may be mid-write on an unrelated spec),
    coordination files, and the active-session pointer. Returns the list
    of seeded items (for evidence)."""
    seeded: list[str] = []
    for spec in specs:
        src = product_root / "haikai" / "specs" / spec
        if not src.is_dir():
            raise WorktreeAllocationError(
                f"spec folder not found in live checkout: {src} — run "
                "/shape-spec first (F1: shape output is uncommitted state)")
        _copytree(src, dest_root / "haikai" / "specs" / spec)
        seeded.append(f"haikai/specs/{spec}")
    for name in ("coordination.yaml", "coordination.lock.yaml"):
        src = product_root / name
        if src.exists():
            _copytree(src, dest_root / name)
            seeded.append(name)
    pointer = product_root / ".claude" / "active_session.json"
    if pointer.exists():
        _copytree(pointer, dest_root / ".claude" / "active_session.json")
        seeded.append(".claude/active_session.json")
    return seeded


def seed_repo_config(live_repo: Path, worktree: Path) -> bool:
    """.haikai/config.json is gitignored — without it GitManager.load_config
    raises in a fresh worktree (G4)."""
    src = Path(live_repo) / ".haikai" / "config.json"
    if not src.exists():
        return False
    _copytree(src, Path(worktree) / ".haikai" / "config.json")
    return True


def encode_project_dir(project_dir: str) -> str:
    """The Claude CLI's cwd → session-directory encoding (mirror of
    claude_chat_executor.get_session_file)."""
    p = str(project_dir)
    p = p.replace(":\\", "--").replace(":/", "--")
    return p.replace("\\", "-").replace("/", "-").replace("_", "-")


def transplant_session_dir(old_project_dir: str, new_project_dir: str,
                           claude_home: Optional[Path] = None) -> Optional[Path]:
    """Copy the encoded CLI session DIRECTORY verbatim (sidecars included —
    sessions are directories, not one jsonl; D7) so --resume works from the
    worktree cwd. Transcript content is copied AS-IS (stale historical
    paths accepted, grill Q3). Returns the new dir or None if no source."""
    home = claude_home or (Path.home() / ".claude" / "projects")
    src = home / encode_project_dir(old_project_dir)
    if not src.is_dir():
        return None
    dst = home / encode_project_dir(new_project_dir)
    shutil.copytree(src, dst, dirs_exist_ok=True)
    return dst


def sha256_tree(root: Path, rel_files: Iterable[str]) -> str:
    """Stable content checksum over the given files (repair mini-spec
    hand-off verification, D8). Missing files hash as empty."""
    h = hashlib.sha256()
    for rel in sorted(rel_files):
        h.update(rel.encode())
        f = Path(root) / rel
        if f.is_file():
            h.update(f.read_bytes())
    return h.hexdigest()


def spec_planning_checksum(product_root: Path, spec: str) -> Optional[str]:
    """sha256 over a spec's planning files (the repair mini-spec hand-off,
    D8): the SAME function runs at dispatch (enqueue_cli, live product root)
    and at allocation (seeded copy) — mismatch = tampered/partial hand-off,
    fail fast (W5). None if the planning dir doesn't exist."""
    planning = Path(product_root) / "haikai" / "specs" / spec / "planning"
    if not planning.is_dir():
        return None
    rels = sorted(
        str(p.relative_to(product_root)).replace("\\", "/")
        for p in planning.rglob("*") if p.is_file()
    )
    return sha256_tree(product_root, rels)


# ── D14 reclaim ──────────────────────────────────────────────────────────────

def reclaim_allowed(job, storage,
                    stale_seconds: float = STALE_HEARTBEAT_SECONDS,
                    lease_active: bool = False) -> tuple[bool, str]:
    """The six-condition predicate (D14). `job` may be None for a worktree
    registration with no job record (TTL path — caller decides)."""
    from src.job_queue.job_models import (JobStatus, PROTECTED_STATUSES,
                                          TERMINAL_STATUSES)

    if job is None:
        return True, "no job record (TTL path)"
    status = job.status if isinstance(job.status, JobStatus) else JobStatus(job.status)
    if status not in TERMINAL_STATUSES:                       # cond 1
        return False, f"status {status.value} is not terminal"
    if status in PROTECTED_STATUSES:                          # cond 2
        return False, f"status {status.value} is protected"
    # cond 3 (protected resume_from_step + worktree_root state) is subsumed:
    # resume-protected statuses (QUEUED_FOR_RESUME, RECOVERING, RESUMABLE_FAILED)
    # are all non-terminal, so condition 1 already refuses them.
    pid = storage.tracked_pid(job.job_id) if storage else None  # cond 4
    if pid is not None:
        from src.job_queue.process_tracking import pid_alive
        if pid_alive(pid):
            age = storage.heartbeat_age_seconds(job.job_id)
            if age is None or age < stale_seconds:
                return False, f"tracked pid {pid} alive and heartbeat fresh"
    else:
        age = storage.heartbeat_age_seconds(job.job_id) if storage else None
        if age is not None and age < stale_seconds:
            return False, f"heartbeat fresh ({age:.0f}s < {stale_seconds}s)"
    if lease_active:                                          # cond 5
        return False, "active worker lease owns the worktree"
    return True, "reclaimable"                                # cond 6 = caller copies logs first


def copy_observability_out(worktree_root: Path, logs_path: Optional[str]) -> None:
    """D14 condition 6: chat logs (and anything else worth keeping) must be
    copied out BEFORE deletion."""
    if not logs_path:
        return
    src = Path(worktree_root) / "chat_logs"
    if src.is_dir():
        dst = Path(logs_path) / "chat_logs"
        shutil.copytree(src, dst, dirs_exist_ok=True)


def remove_worktree(live_repo: Path, path: Path) -> None:
    """Windows removal ladder (W8): unlock → remove → retry → remove --force
    → delete contents → prune. Never a bare rmtree without prune."""
    path = Path(path)
    _git(live_repo, "worktree", "unlock", str(path))
    for attempt, force in ((1, False), (2, False), (3, True)):
        args = ["worktree", "remove"] + (["--force"] if force else []) + [str(path)]
        cp = _git(live_repo, *args)
        if cp.returncode == 0:
            break
        time.sleep(0.5 * attempt)
    else:  # pragma: no cover
        pass
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)
    _git(live_repo, "worktree", "prune")


def reclaim_run(live_repos: Iterable[Path], worktree_paths: Iterable[Path],
                run_root_dir: Path, logs_path: Optional[str] = None) -> None:
    """Reclaim a run's whole worktree set. Caller has already satisfied the
    D14 predicate (and killed the tracked tree, D13)."""
    copy_observability_out(run_root_dir, logs_path)
    for repo, wt in zip(live_repos, worktree_paths):
        try:
            remove_worktree(repo, wt)
        except Exception:
            logger.warning("remove_worktree(%s) failed", wt, exc_info=True)
    shutil.rmtree(run_root_dir, ignore_errors=True)


def sweep(storage, workspace_dir: str, live_repo_resolver,
          ttl_seconds: float = 7 * 24 * 3600) -> list[str]:
    """Reclaim crash debris under <workspace>/wt/ per D14. `live_repo_resolver`
    maps a Job -> list[(live_repo, worktree_path)] (S4 provides it). Dirs with
    NO matching job record are removed only past `ttl_seconds`. Returns
    reclaimed root names."""
    wt_root = Path(workspace_dir) / "wt"
    if not wt_root.is_dir():
        return []
    by_prefix = {}
    for job in storage.list_jobs(limit=1000):
        if job.worktree_root:
            by_prefix[Path(job.worktree_root).name] = job
    reclaimed = []
    for entry in wt_root.iterdir():
        if not entry.is_dir():
            continue
        job = by_prefix.get(entry.name)
        if job is None:
            age = time.time() - entry.stat().st_mtime
            if age > ttl_seconds:
                shutil.rmtree(entry, ignore_errors=True)
                reclaimed.append(entry.name)
            continue
        ok, reason = reclaim_allowed(job, storage)
        if not ok:
            logger.debug("sweep: keep %s (%s)", entry.name, reason)
            continue
        pairs = live_repo_resolver(job) or []
        reclaim_run([p[0] for p in pairs], [p[1] for p in pairs],
                    entry, logs_path=job.logs_path)
        reclaimed.append(entry.name)
    return reclaimed


def repo_index_lock_path(repo_or_worktree: Path) -> Path:
    """Linked-worktree-safe index.lock resolution (D5: `.git` is a FILE in a
    linked worktree — `<dir>/.git/index.lock` silently misses)."""
    cp = _git(repo_or_worktree, "rev-parse", "--git-path", "index.lock")
    if cp.returncode != 0:
        return Path(repo_or_worktree) / ".git" / "index.lock"
    p = Path(cp.stdout.strip())
    return p if p.is_absolute() else Path(repo_or_worktree) / p
