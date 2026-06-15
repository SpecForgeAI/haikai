"""Git repository wrapper — subprocess-based, no external git library.

Used by the refactoring engines to read diffs, working-tree state, and HEAD.
All write operations go elsewhere (rename_engine apply path); this module is
read-only.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional


class GitRepoError(RuntimeError):
    """Raised when a git subprocess call fails or times out.

    Wraps `subprocess.CalledProcessError` and `subprocess.TimeoutExpired`
    so callers (typically REST handlers) don't propagate raw `git` stderr
    or stack traces to API clients.
    """


class DiffScope(str, Enum):
    """Which set of changes to include in `GitRepo.diff()`."""
    STAGED = "staged"          # git diff --staged
    UNSTAGED = "unstaged"      # git diff
    ALL = "all"                # git diff HEAD (staged + unstaged)
    COMMIT = "commit"          # git diff <commit>^..<commit>


@dataclass
class DiffHunk:
    """A single hunk inside a FileDiff (one contiguous changed region)."""
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[str] = field(default_factory=list)

    @property
    def affected_lines(self) -> list[int]:
        """Line numbers in the new file affected by this hunk.

        For pure deletions (new_count == 0), returns the single line where
        the deletion happened (new_start). Callers map these to the
        nearest-preceding symbol via the dep-graph.
        """
        if self.new_count == 0:
            return [self.new_start]
        return list(range(self.new_start, self.new_start + self.new_count))


@dataclass
class FileDiff:
    """All hunks for a single file plus its status."""
    path: str
    status: str  # 'modified' | 'added' | 'deleted' | 'renamed'
    hunks: list[DiffHunk] = field(default_factory=list)
    old_path: Optional[str] = None  # populated when status == 'renamed'


# `--numstat` line: "<add>\t<del>\t<path>" (or "...\t...\t<old> => <new>")
_NUMSTAT_RE = re.compile(r"^(\d+|-)\t(\d+|-)\t(.+)$")
# Hunk header: "@@ -<old_start>[,<old_count>] +<new_start>[,<new_count>] @@"
_HUNK_RE = re.compile(
    r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@"
)


class GitRepo:
    """Subprocess wrapper around `git`. Read-only operations.

    All commands run with `cwd=repo_path`. Errors propagate as
    `subprocess.CalledProcessError` (we don't swallow them — callers can
    decide whether a missing repo is fatal).
    """

    def __init__(self, repo_path: str | Path):
        self.repo_path = Path(repo_path).resolve()
        if not (self.repo_path / ".git").exists():
            raise ValueError(f"Not a git repository: {self.repo_path}")

    def _run(self, *args: str) -> str:
        """Run `git <args...>`, return stdout.

        Raises `GitRepoError` on non-zero exit OR timeout. timeout=300
        (matches git_manager._run_git, structural_endpoints._clone_repo).
        Wrapping the underlying subprocess exceptions keeps raw git stderr
        out of REST responses — callers can format the GitRepoError
        message however they want.
        """
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            raise GitRepoError(f"git {args[0] if args else ''} timed out after 300s")
        except subprocess.CalledProcessError as e:
            stderr = (e.stderr or "").strip()
            raise GitRepoError(f"git {args[0] if args else ''} failed (exit {e.returncode}): {stderr}")
        return result.stdout

    # --- HEAD / working-tree state ------------------------------------------

    def head_sha(self) -> str:
        """Full SHA of current HEAD."""
        return self._run("rev-parse", "HEAD").strip()

    def working_tree_dirty(self) -> bool:
        """True if there are uncommitted changes (staged or unstaged)."""
        return bool(self._run("status", "--porcelain").strip())

    def modified_files(self) -> list[str]:
        """Files with uncommitted changes (staged or unstaged), as repo-relative paths.

        Excludes untracked files. Order is git's default — typically alphabetic
        within each status group.
        """
        out = self._run("status", "--porcelain").splitlines()
        files: list[str] = []
        for line in out:
            # Format: "XY path" where X is staged status, Y is unstaged.
            # "??" is untracked — skip.
            if not line or line.startswith("??"):
                continue
            # Path starts at column 3; for renames it's "old -> new"
            path = line[3:].strip()
            if " -> " in path:
                path = path.split(" -> ", 1)[1]
            files.append(path)
        return files

    # --- Diff ---------------------------------------------------------------

    def diff(
        self,
        scope: DiffScope = DiffScope.STAGED,
        commit: Optional[str] = None,
    ) -> list[FileDiff]:
        """Return per-file diffs at the requested scope.

        For COMMIT scope, `commit` is the SHA being inspected; the diff is
        against its first parent (`<commit>^..<commit>`).
        """
        cmd = self._diff_command(scope, commit)
        raw = self._run(*cmd)
        statuses = self._collect_statuses(scope, commit)
        return self._parse_diff(raw, statuses)

    def _diff_command(self, scope: DiffScope, commit: Optional[str]) -> list[str]:
        """Build the `git diff` argv (without 'git').

        Note on `--`: it separates *revisions* from *pathspecs*. With `--`
        placed BEFORE the rev, git treats the rev as a non-existent path
        and silently returns empty output (which is what the previous
        version did, breaking ALL+COMMIT scopes — see autoresearch:debug
        260504-0823 finding #5). There is no pathspec here, so `--` is
        omitted entirely.
        """
        args = ["diff", "--unified=0", "--no-color", "--no-ext-diff"]
        if scope == DiffScope.STAGED:
            args.append("--staged")
        elif scope == DiffScope.UNSTAGED:
            pass  # default
        elif scope == DiffScope.ALL:
            args.append("HEAD")
        elif scope == DiffScope.COMMIT:
            if not commit:
                raise ValueError("scope=COMMIT requires a commit SHA")
            # Defense-in-depth: refuse argv-style injection in the commit
            # SHA (the only field a caller could plausibly turn hostile).
            if commit.startswith("-"):
                raise ValueError(f"commit SHA must not start with '-': {commit!r}")
            args.append(f"{commit}^..{commit}")
        else:
            raise ValueError(f"unknown scope: {scope}")
        return args

    def _collect_statuses(
        self, scope: DiffScope, commit: Optional[str]
    ) -> dict[str, tuple[str, Optional[str]]]:
        """Map path → (status, old_path) using `--name-status` at the same scope.

        status is one of 'modified', 'added', 'deleted', 'renamed'.
        old_path is set only for renames.
        """
        args = ["diff", "--name-status", "--no-color", "--no-ext-diff"]
        if scope == DiffScope.STAGED:
            args.append("--staged")
        elif scope == DiffScope.ALL:
            args.append("HEAD")
        elif scope == DiffScope.COMMIT:
            if not commit:
                raise ValueError("scope=COMMIT requires a commit SHA")
            if commit.startswith("-"):
                raise ValueError(f"commit SHA must not start with '-': {commit!r}")
            args.append(f"{commit}^..{commit}")
        # UNSTAGED uses the bare default

        out = self._run(*args)
        result: dict[str, tuple[str, Optional[str]]] = {}
        for line in out.splitlines():
            if not line.strip():
                continue
            parts = line.split("\t")
            code = parts[0]
            # Code is one of M, A, D, or Rxxx (rename with similarity)
            if code.startswith("R"):
                # Format: "R100\told_path\tnew_path"
                if len(parts) >= 3:
                    result[parts[2]] = ("renamed", parts[1])
            elif code.startswith("M"):
                if len(parts) >= 2:
                    result[parts[1]] = ("modified", None)
            elif code.startswith("A"):
                if len(parts) >= 2:
                    result[parts[1]] = ("added", None)
            elif code.startswith("D"):
                if len(parts) >= 2:
                    result[parts[1]] = ("deleted", None)
            # ignore C (copy), T (typechange), U (unmerged), X (unknown)
        return result

    def _parse_diff(
        self,
        raw: str,
        statuses: dict[str, tuple[str, Optional[str]]],
    ) -> list[FileDiff]:
        """Parse `git diff --unified=0` output into FileDiff records."""
        files: list[FileDiff] = []
        current: Optional[FileDiff] = None
        current_hunk: Optional[DiffHunk] = None

        for line in raw.splitlines():
            if line.startswith("diff --git "):
                # Flush any pending hunk + file
                self._flush(current, current_hunk, files)
                current_hunk = None
                # Extract the new path: 'diff --git a/<path> b/<path>'
                # Use the b/ side as canonical
                m = re.match(r"diff --git a/(.+) b/(.+)", line)
                if not m:
                    current = None
                    continue
                new_path = m.group(2)
                # Lookup status — fall back to 'modified' if name-status didn't list it
                status, old_path = statuses.get(new_path, ("modified", None))
                current = FileDiff(path=new_path, status=status, old_path=old_path)
                continue

            if current is None:
                continue

            # rename/added/deleted markers (informational; status already set)
            if line.startswith("rename from "):
                # Confirm rename even if --name-status missed it
                if current.status != "renamed":
                    current.status = "renamed"
                    current.old_path = line[len("rename from "):]
                continue
            if line.startswith("new file mode") and current.status not in ("added", "renamed"):
                current.status = "added"
                continue
            if line.startswith("deleted file mode") and current.status not in ("deleted", "renamed"):
                current.status = "deleted"
                continue

            m = _HUNK_RE.match(line)
            if m:
                # New hunk
                if current_hunk is not None:
                    current.hunks.append(current_hunk)
                old_start = int(m.group(1))
                old_count = int(m.group(2)) if m.group(2) else 1
                new_start = int(m.group(3))
                new_count = int(m.group(4)) if m.group(4) else 1
                current_hunk = DiffHunk(
                    old_start=old_start,
                    old_count=old_count,
                    new_start=new_start,
                    new_count=new_count,
                    lines=[],
                )
                continue

            if current_hunk is not None and (line.startswith("+") or line.startswith("-")):
                # +++/--- file headers also start with +/- but aren't hunk lines.
                # Filter them out.
                if line.startswith("+++") or line.startswith("---"):
                    continue
                current_hunk.lines.append(line)

        # Flush trailing
        self._flush(current, current_hunk, files)
        return files

    @staticmethod
    def _flush(
        current: Optional[FileDiff],
        current_hunk: Optional[DiffHunk],
        files: list[FileDiff],
    ) -> None:
        """Append in-progress hunk and file to the result list."""
        if current is None:
            return
        if current_hunk is not None:
            current.hunks.append(current_hunk)
        files.append(current)
