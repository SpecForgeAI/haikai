"""Convention check: no mono/poly mode branching in pipeline code.

NFR-1 of the polyrepo spec: N=1 is the degenerate case of N≥1. Any branch
of the form ``if len(repos) == 1``, ``if is_monorepo``, ``if mode == ...``
in pipeline code is a smell — the system must treat both shapes uniformly.

This test greps the source tree for the forbidden patterns and fails if
any new ones land. Existing call-sites that *legitimately* use these
patterns (e.g. routing the top-level response `mode` field through to
backward-compatible clients) are listed in ALLOWED_OCCURRENCES below.

Add a new entry to ALLOWED_OCCURRENCES only when the pattern is a
deliberate, documented exemption. Each exemption should carry a comment
in the source explaining why the branch is needed.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List, Tuple

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent


# Files / line-matches that are exempt. (relative path, substring in line)
# The substring is matched as a literal — exact line-content fragment.
ALLOWED_OCCURRENCES: List[Tuple[str, str]] = [
    # ProjectInitResponse.mode is the backward-compat top-level field. The
    # init route picks "brownfield"/"greenfield" (N=1) or "polyrepo" (N>1)
    # — this is a *response shape* branch, not a pipeline-logic branch.
    ("src/api/routes/projects.py", 'top_mode = per_repo[0].mode if len(per_repo) == 1 else "polyrepo"'),
    # The init route documents in a comment that mono N=1 is the degenerate
    # case — the docstring contains "N=1" referenced in prose.
    ("src/api/routes/projects.py", "* ``N = 1``"),
    ("src/api/routes/projects.py", "* ``N > 1``"),
    # The Pydantic model docstring describes the legacy promotion path:
    # "promoted internally to a one-entry map" — descriptive, not a branch.
    ("src/git/models.py", "one-entry map"),
    # Repo CRUD endpoint: deleting the last entry is rejected. This is the
    # last-entry rule from FR-4, not a mono/poly branch.
    ("src/api/routes/repos.py", "if len(repos) == 1:"),
    # This convention-check test itself contains the patterns as strings.
    ("tests/test_polyrepo_no_mode_branches.py", "if len(repos) == 1"),
    ("tests/test_polyrepo_no_mode_branches.py", "if is_monorepo"),
    ("tests/test_polyrepo_no_mode_branches.py", "if mode =="),
]


# Forbidden regex patterns. Each is matched against a single line.
FORBIDDEN_PATTERNS = [
    re.compile(r"\bif\s+len\(\s*repos\s*\)\s*==\s*1\b"),
    re.compile(r"\bif\s+is_monorepo\b"),
    re.compile(r"\bif\s+is_polyrepo\b"),
    re.compile(r"\bif\s+mode\s*==\s*['\"](mono|poly|monorepo|polyrepo)"),
]


def _walk_python_sources():
    """Yield (relative_path, line_no, line_text) for every .py line under src/."""
    src = REPO_ROOT / "src"
    for path in src.rglob("*.py"):
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            with path.open("r", encoding="utf-8") as f:
                for i, line in enumerate(f, start=1):
                    yield rel, i, line.rstrip("\n")
        except OSError:
            continue


def _is_allowed(rel_path: str, line_text: str) -> bool:
    return any(
        rel_path == allowed_path and allowed_substr in line_text
        for allowed_path, allowed_substr in ALLOWED_OCCURRENCES
    )


def test_no_mono_poly_branches_in_src():
    violations: List[str] = []
    for rel, line_no, line in _walk_python_sources():
        for pat in FORBIDDEN_PATTERNS:
            if pat.search(line):
                if _is_allowed(rel, line):
                    break
                violations.append(f"{rel}:{line_no}: {line.strip()}")
                break
    assert not violations, (
        "Mono/poly branching detected — the system must treat N=1 as the\n"
        "degenerate case of N≥1 (NFR-1 of the polyrepo spec). Either remove\n"
        "the branch or add an explicit ALLOWED_OCCURRENCES entry with a\n"
        "rationale. Offending lines:\n\n" + "\n".join(violations)
    )
