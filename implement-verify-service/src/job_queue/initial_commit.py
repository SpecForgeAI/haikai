"""SCL first-commit delivery + shipped-file hash reads (2026-08-18).

Two seams, both deliberately tiny and git-native:

* :func:`write_initial_commit_files` — after a job's branch/workspace is
  prepared and BEFORE any implementer work, write the payload-supplied
  ``initial_commit_files`` into the run workspace's repo target and make ONE
  commit with the payload's ``initial_commit_message``. The commit uses the
  repo's EXISTING git identity (no author override) and stages ONLY the
  written paths — the seeded spec folders must never be swept into the
  shipped-suite commit. Failure raises :class:`InitialCommitError`
  (fail-closed: a job whose contract is "the shipped suite is the first
  commit" must not run without it).

* :func:`collect_branch_file_hashes` — the read side the gateway's
  build-results door calls (``GET /api/v2/jobs/{job_id}/file-hashes``):
  sha256 hashes of shipped files ON THE JOB'S BRANCH, computed via
  ``git show <branch>:<path>`` against the LIVE repo (the run worktree is
  reclaimed after completion; the branch survives). Also returns the raw
  contents of the two well-known SCL sidecar files
  (``scl-suite-manifest.json`` / ``scl-quarantine.json``) so the gateway can
  run its integrity + quarantine accounting in one round-trip.

Windows note: subprocess output is read as BYTES (``text=False``) so blob
content hashes are computed over the exact committed bytes — no newline or
codec translation.
"""
from __future__ import annotations

import hashlib
import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("src.job_queue.initial_commit")

# The well-known SCL sidecar files shipped alongside a generated suite.
SCL_MANIFEST_FILENAME = "scl-suite-manifest.json"
SCL_QUARANTINE_FILENAME = "scl-quarantine.json"


class InitialCommitError(Exception):
    """The initial-commit contract could not be honoured (fail-closed)."""


def _run_git(args: list, cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess:
    """Run a git command with BINARY capture (blob bytes must round-trip)."""
    result = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, timeout=120,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
        raise InitialCommitError(f"git {' '.join(args)} failed: {detail}")
    return result


def _safe_repo_relative(repo_dir: Path, rel_path: str) -> Path:
    """Resolve ``rel_path`` under ``repo_dir``, refusing traversal escapes."""
    candidate = (repo_dir / rel_path).resolve()
    root = repo_dir.resolve()
    if root != candidate and root not in candidate.parents:
        raise InitialCommitError(
            f"initial_commit_files path escapes the repo: {rel_path!r}"
        )
    return candidate


def write_initial_commit_files(product_root, files, message: str) -> dict:
    """Write ``files`` ([{path, content}] or pydantic models) into the run
    workspace's repo target and make ONE commit with ``message``.

    Repo target resolution mirrors the git phase (``_resolve_repo_targets``):
    single-repo product roots ARE the repo; polyrepo roots commit into the
    FIRST coordination.yaml target (logged loudly — the SCL suites are
    single-service artifacts).

    Returns ``{"repo": folder|None, "commit_sha": sha, "files": [paths]}``.
    Raises :class:`InitialCommitError` on any failure (fail-closed).
    """
    from .tasks import _resolve_repo_targets  # lazy — avoids a module cycle

    if not files:
        raise InitialCommitError("initial_commit_files is empty")
    if not (message or "").strip():
        raise InitialCommitError(
            "initial_commit_message is required when initial_commit_files is set"
        )

    product_root = Path(product_root)
    targets = _resolve_repo_targets(product_root)
    if not targets:
        raise InitialCommitError(
            f"no repo targets at {product_root} — cannot commit the shipped suite"
        )
    folder, repo_dir = targets[0]
    if len(targets) > 1:
        logger.warning(
            "initial-commit: %d repo targets at %s — committing the shipped "
            "suite into the FIRST target %r (the others are untouched)",
            len(targets), product_root, folder,
        )

    written: list = []
    for entry in files:
        path = entry.get("path") if isinstance(entry, dict) else getattr(entry, "path", None)
        content = entry.get("content") if isinstance(entry, dict) else getattr(entry, "content", None)
        if not path or content is None:
            raise InitialCommitError(f"malformed initial_commit_files entry: {entry!r}")
        dest = _safe_repo_relative(repo_dir, path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(str(content).encode("utf-8"))
        written.append(path)

    # Stage ONLY the written paths — never `git add -A` (the seeded haikai
    # spec folders must not ride the shipped-suite commit).
    _run_git(["add", "--", *written], repo_dir)
    # IDEMPOTENT on resume: a job re-created from its run branch already
    # carries the shipped commit — the re-written files are byte-identical,
    # nothing stages, and a `git commit` would fail "nothing to commit".
    # That is DELIVERED, not an error.
    staged = _run_git(
        ["status", "--porcelain", "--", *written], repo_dir
    ).stdout.decode("utf-8", "replace").strip()
    if not staged:
        sha = (
            _run_git(["rev-parse", "HEAD"], repo_dir)
            .stdout.decode("utf-8", "replace").strip()
        )
        logger.info(
            "initial-commit: all %d shipped file(s) already on the branch at %s "
            "(resume) — no new commit",
            len(written), sha[:8],
        )
        return {"repo": folder, "commit_sha": sha, "files": written}
    _run_git(["commit", "-m", message], repo_dir)
    sha = (
        _run_git(["rev-parse", "HEAD"], repo_dir).stdout.decode("utf-8", "replace").strip()
    )
    logger.info(
        "initial-commit: committed %d shipped file(s) as %s in %s (%r)",
        len(written), sha[:8], repo_dir, message,
    )
    return {"repo": folder, "commit_sha": sha, "files": written}


def _git_show_bytes(repo_dir: Path, ref: str, rel_path: str):
    """``git show <ref>:<path>`` → bytes, or None when the ref/path is absent."""
    result = _run_git(["show", f"{ref}:{rel_path}"], repo_dir, check=False)
    if result.returncode != 0:
        return None
    return result.stdout


def _branch_file_bytes(repo_dir: Path, branch: str, rel_path: str):
    """Blob bytes for ``rel_path`` on ``branch`` (local first, then origin/)."""
    blob = _git_show_bytes(repo_dir, branch, rel_path)
    if blob is None:
        blob = _git_show_bytes(repo_dir, f"origin/{branch}", rel_path)
    return blob


def collect_branch_file_hashes(product_root, branch: str, paths=None) -> dict:
    """sha256 hashes of shipped files on ``branch`` + the SCL sidecar contents.

    ``paths=None``/empty → the path set is derived from the branch's
    ``scl-suite-manifest.json`` (its ``files[].path`` list), so the gateway's
    common case is a single round-trip. A path that does not exist on the
    branch reports ``sha256: None`` (the gateway's integrity check counts it
    missing). Never raises for absent files — only for a missing repo.
    """
    from .tasks import _resolve_repo_targets  # lazy — avoids a module cycle

    product_root = Path(product_root)
    targets = _resolve_repo_targets(product_root)
    if not targets:
        raise InitialCommitError(
            f"no repo targets at {product_root} — cannot read branch file hashes"
        )
    folder, repo_dir = targets[0]

    manifest_bytes = _branch_file_bytes(repo_dir, branch, SCL_MANIFEST_FILENAME)
    quarantine_bytes = _branch_file_bytes(repo_dir, branch, SCL_QUARANTINE_FILENAME)

    wanted = [p for p in (paths or []) if isinstance(p, str) and p.strip()]
    if not wanted and manifest_bytes is not None:
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8", "replace"))
            wanted = [
                f.get("path")
                for f in (manifest.get("files") or [])
                if isinstance(f, dict) and isinstance(f.get("path"), str)
            ]
        except (ValueError, AttributeError):
            logger.warning(
                "file-hashes: %s on branch %s is unparseable — no derived paths",
                SCL_MANIFEST_FILENAME, branch,
            )
            wanted = []

    hashes = []
    for rel_path in wanted:
        blob = _branch_file_bytes(repo_dir, branch, rel_path)
        hashes.append({
            "path": rel_path,
            "sha256": hashlib.sha256(blob).hexdigest() if blob is not None else None,
        })

    return {
        "repo": folder,
        "branch": branch,
        "hashes": hashes,
        "manifest": manifest_bytes.decode("utf-8", "replace") if manifest_bytes is not None else None,
        "quarantine": quarantine_bytes.decode("utf-8", "replace") if quarantine_bytes is not None else None,
    }
