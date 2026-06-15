"""Refactoring tools built on top of the dependency graph (Spec 1).

See `haikai/specs/2026-04-27-refactoring-impact/spec.md`.
"""

__version__ = "0.1.0"

from src.refactoring.change_detector import (
    ChangeImpactReport,
    FileChange,
    ImpactedSymbol,
    RiskScore,
    detect_changes,
)
from src.refactoring.git_repo import (
    DiffHunk,
    DiffScope,
    FileDiff,
    GitRepo,
)
from src.refactoring.rename_engine import (
    AmbiguityCandidate,
    Partitions,
    Patch,
    Ref,
    RenamePlan,
    rename_apply,
    rename_preview,
)
from src.refactoring.staleness import (
    StalenessReport,
    check_staleness,
)

__all__ = [
    "__version__",
    # change_detector
    "ChangeImpactReport",
    "FileChange",
    "ImpactedSymbol",
    "RiskScore",
    "detect_changes",
    # git_repo
    "DiffHunk",
    "DiffScope",
    "FileDiff",
    "GitRepo",
    # rename_engine
    "AmbiguityCandidate",
    "Partitions",
    "Patch",
    "Ref",
    "RenamePlan",
    "rename_apply",
    "rename_preview",
    # staleness
    "StalenessReport",
    "check_staleness",
]
