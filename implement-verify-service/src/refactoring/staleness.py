"""Snapshot vs working-tree staleness check.

Levels:
  - fresh:        snapshot SHA == HEAD AND working tree clean
  - stale:        snapshot SHA == HEAD AND working tree dirty (uncommitted edits)
  - outdated:     snapshot SHA != HEAD (snapshot is from a different commit)
  - stale-mtime:  no SHA available, but at least one source file was modified
                  AFTER the snapshot was built (mtime fallback)
  - fresh-mtime:  no SHA available; mtime check shows no source file newer
                  than the snapshot
  - unknown:      no SHA AND no usable mtime evidence (e.g. snapshot dir empty)

Snapshot SHA discovery (in order):
  1. `<snapshot>/_meta.json`'s `commit_sha` / `sha` / `head_sha` field
  2. `<snapshot>/_depgraph.meta.json` (Spec 1 builder doesn't write this
     today — see `2026-04-27-depgraph-commit-sha` follow-up spec)
  3. `<snapshot>/_meta.yaml`'s `commit` / `commit_sha` field
  4. The snapshot dir name OR an ancestor dir name if it's a hex SHA

When all four lookups fail, the mtime fallback compares source-file mtimes
to the dep-graph build time. This is a coarser signal than SHA matching
(it can't distinguish an `outdated` snapshot from a `stale` one — both
look like "files changed after build") but it's the honest available
answer.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from src.refactoring.git_repo import GitRepo

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


@dataclass
class StalenessReport:
    snapshot_sha: Optional[str]
    head_sha: Optional[str]
    working_tree_dirty: bool = False
    modified_files_since: list[str] = field(default_factory=list)
    level: str = "unknown"  # fresh | stale | outdated | unknown
    notes: list[str] = field(default_factory=list)


def check_staleness(snapshot_path: str | Path, repo_root: str | Path) -> StalenessReport:
    """Compare snapshot's commit SHA to current `git HEAD` and working tree.

    Falls back to source-file mtime comparison when no SHA is available.
    """
    snap = Path(snapshot_path)
    snap_sha = _read_snapshot_sha(snap)
    git = GitRepo(repo_root)
    head = git.head_sha()
    dirty = git.working_tree_dirty()
    modified = git.modified_files() if dirty else []

    report = StalenessReport(
        snapshot_sha=snap_sha,
        head_sha=head,
        working_tree_dirty=dirty,
        modified_files_since=modified,
    )

    if snap_sha is None:
        # Mtime fallback: compare source file mtimes to the dep-graph build time.
        return _classify_by_mtime(report, snap, Path(repo_root))

    # `snap_sha` may be a 7-40 char short SHA from the dir-name fallback in
    # `_read_snapshot_sha`. A direct `!=` against the 40-char HEAD always
    # mis-classifies short snapshots as outdated. Compare via prefix when
    # the snapshot SHA is short.
    if len(snap_sha) < 40:
        same_commit = head.startswith(snap_sha)
    else:
        same_commit = (snap_sha == head)

    if not same_commit:
        report.level = "outdated"
        report.notes.append(f"snapshot at {snap_sha[:8]}, HEAD at {head[:8]}")
    elif dirty:
        report.level = "stale"
        report.notes.append(
            f"snapshot SHA matches HEAD but {len(modified)} file(s) modified locally"
        )
    else:
        report.level = "fresh"
    return report


def _classify_by_mtime(
    report: StalenessReport, snap: Path, repo_root: Path,
) -> StalenessReport:
    """Fallback when no SHA is available — compare mtimes."""
    # Find the snapshot's build time. Prefer the dep-graph SQLite mtime
    # (set when builder.run completed); fall back to the snapshot dir mtime.
    db = snap / "_depgraph.sqlite"
    snap_mtime = (db if db.exists() else snap).stat().st_mtime

    # Walk source files under repo_root, find any newer than snap_mtime.
    # Skip .git/, node_modules/, vendor/ etc. for speed.
    skip_dirs = {".git", "node_modules", "vendor", "dist", "build", ".venv", "__pycache__"}
    newer: list[str] = []
    try:
        for root, dirs, files in os.walk(repo_root):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for fname in files:
                fp = Path(root) / fname
                try:
                    if fp.stat().st_mtime > snap_mtime + 1.0:
                        newer.append(str(fp.relative_to(repo_root)).replace("\\", "/"))
                        if len(newer) >= 1000:  # cap to avoid runaway
                            break
                except OSError:
                    continue
            if len(newer) >= 1000:
                break
    except OSError as exc:
        report.level = "unknown"
        report.notes.append(f"mtime fallback failed: {exc}")
        return report

    if not newer:
        report.level = "fresh-mtime"
        report.notes.append(
            "snapshot SHA not found; no source files newer than snapshot build time"
        )
    else:
        report.level = "stale-mtime"
        report.modified_files_since = sorted(newer)[:50]  # cap displayed list
        report.notes.append(
            f"snapshot SHA not found; {len(newer)} source file(s) newer than "
            f"snapshot build time (showing first {min(len(newer), 50)})"
        )
    return report


def _read_snapshot_sha(snap: Path) -> Optional[str]:
    """Find the snapshot's commit SHA via meta files or dir-name pattern."""
    for name in ("_meta.json", "_depgraph.meta.json"):
        path = snap / name
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
            except (json.JSONDecodeError, OSError):
                continue
            for k in ("commit_sha", "sha", "head_sha"):
                v = data.get(k)
                if isinstance(v, str) and _SHA_RE.match(v):
                    return v

    # Some pipelines store SHA in _meta.yaml. We don't pull pyyaml just for this —
    # do a line-grep for common keys. Tolerant to formatting (`commit: abc123`,
    # `commit_sha: "abc123"`, etc.).
    yaml_path = snap / "_meta.yaml"
    if yaml_path.exists():
        try:
            text = yaml_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            text = ""
        for line in text.splitlines():
            m = re.match(r"^\s*(commit|commit_sha|sha|head_sha)\s*:\s*['\"]?([0-9a-fA-F]+)['\"]?\s*$", line)
            if m and _SHA_RE.match(m.group(2).lower()):
                return m.group(2).lower()

    # Walk up: snapshot may be `<base>/<repo>/<sha>/...` — first ancestor dir
    # whose name is a full SHA wins.
    for parent in (snap, *snap.parents):
        if _SHA_RE.match(parent.name):
            return parent.name

    # Short-SHA dir-name fallback (e.g. `<repo>/<7-char-sha>/`)
    short = re.compile(r"^[0-9a-f]{7,40}$")
    for parent in (snap, *snap.parents):
        if short.match(parent.name) and len(parent.name) >= 7:
            # Resolve short SHA via git? No — we don't have repo_root here.
            # Return as-is; staleness compare will surface the mismatch.
            return parent.name
    return None
