"""Change detection — git diff → impacted symbols → blast radius.

Reads a `git diff` at the requested scope, attributes each hunk line to the
nearest-preceding symbol in the dep-graph, and aggregates the resulting
`impact_of()` reports into a single ChangeImpactReport.

See `haikai/specs/2026-04-27-refactoring-impact/spec.md` (change_detector
section) for the contract and edge-case rules.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from src.dep.db import DepGraph
from src.dep.impact import EndpointRef, ImpactReport, impact_of
from src.refactoring.git_repo import DiffScope, FileDiff, GitRepo

# Risk score → level thresholds. Placeholder formula (see spec); thresholds
# kept low/medium/high split at 10 and 50.
_RISK_LOW = 10
_RISK_MEDIUM = 50


@dataclass
class ImpactedSymbol:
    """A symbol attributed to one or more hunks in a single file."""
    qualified_name: str
    file: str
    line: int
    kind: str
    hit_lines: list[int] = field(default_factory=list)


@dataclass
class FileChange:
    """Per-file summary of attributed symbols."""
    path: str
    status: str  # 'modified' | 'added' | 'deleted' | 'renamed'
    old_path: Optional[str] = None
    impacted_symbols: list[ImpactedSymbol] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class RiskScore:
    score: int
    level: str  # 'low' | 'medium' | 'high'


@dataclass
class ChangeImpactReport:
    scope: str
    files: list[FileChange] = field(default_factory=list)
    impacted_symbols: list[ImpactedSymbol] = field(default_factory=list)
    affected_callers: list[str] = field(default_factory=list)  # qualified names
    affected_endpoints: list[EndpointRef] = field(default_factory=list)
    risk: RiskScore = field(default_factory=lambda: RiskScore(0, "low"))


def detect_changes(
    repo_root: str | Path,
    depgraph: DepGraph,
    scope: str | DiffScope = DiffScope.STAGED,
    commit: Optional[str] = None,
) -> ChangeImpactReport:
    """Run git diff at `scope`, attribute hunks to symbols, aggregate impact.

    `scope` may be a DiffScope value or its string equivalent
    ('staged'/'unstaged'/'all'/'commit'). When scope='commit', `commit` is
    required (the SHA being inspected; diff is against its first parent).
    """
    if isinstance(scope, str):
        scope = DiffScope(scope)

    git = GitRepo(repo_root)
    diffs = git.diff(scope=scope, commit=commit)

    report = ChangeImpactReport(scope=scope.value)

    # Per-symbol aggregation across all files
    seen_callers: set[str] = set()
    seen_endpoints: dict[tuple[str, str], EndpointRef] = {}
    all_impacted: dict[tuple[str, str], ImpactedSymbol] = {}

    for fd in diffs:
        fc = FileChange(path=fd.path, status=fd.status, old_path=fd.old_path)

        if fd.status == "added":
            fc.notes.append("new file — no prior symbols to impact")
            report.files.append(fc)
            continue

        if fd.status == "deleted":
            # Treat every symbol that lived in <path> per snapshot as edited.
            symbols = _all_symbols_in_file(depgraph, fd.path)
            for s in symbols:
                impsym = ImpactedSymbol(
                    qualified_name=s["qualified_name"],
                    file=fd.path,
                    line=s["line"] or 0,
                    kind=s["kind"] or "",
                )
                fc.impacted_symbols.append(impsym)
                _record_symbol(impsym, all_impacted)
            if not symbols:
                fc.notes.append("file not present in snapshot — nothing to impact")
            report.files.append(fc)
            continue

        # Modified or renamed: attribute hunk lines to enclosing symbols.
        # For renames, hunks describe edits relative to the new path.
        target_path = fd.path
        for hunk in fd.hunks:
            for line_no in hunk.affected_lines:
                row = _nearest_preceding_symbol(depgraph, target_path, line_no)
                if row is None:
                    continue
                qname = row["qualified_name"]
                key = (target_path, qname)
                if key in all_impacted:
                    impsym = all_impacted[key]
                    if line_no not in impsym.hit_lines:
                        impsym.hit_lines.append(line_no)
                else:
                    impsym = ImpactedSymbol(
                        qualified_name=qname,
                        file=target_path,
                        line=row["line"] or 0,
                        kind=row["kind"] or "",
                        hit_lines=[line_no],
                    )
                    all_impacted[key] = impsym
                    fc.impacted_symbols.append(impsym)

        if fd.status == "renamed" and fd.old_path:
            fc.notes.append(f"renamed from {fd.old_path}; symbols shown for new path")

        report.files.append(fc)

    # Run impact_of for each impacted symbol, fold into aggregates.
    for impsym in all_impacted.values():
        ir: ImpactReport = impact_of(depgraph, impsym.qualified_name)
        for cr in ir.direct_callers:
            seen_callers.add(cr.qualified_name)
        for cr in ir.transitive_callers:
            seen_callers.add(cr.qualified_name)
        for ep in ir.affected_endpoints:
            seen_endpoints[(ep.operation, ep.path)] = ep

    report.impacted_symbols = list(all_impacted.values())
    report.affected_callers = sorted(seen_callers)
    report.affected_endpoints = list(seen_endpoints.values())
    report.risk = _score_risk(len(seen_callers), len(seen_endpoints))

    return report


# ─── internals ───────────────────────────────────────────────────────────────


def _nearest_preceding_symbol(graph: DepGraph, file_path: str, line: int):
    """The symbol with the largest line<=`line` in `file_path`, or None."""
    return graph.query_one(
        """
        SELECT s.qualified_name, s.kind, s.line
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.path = ? AND s.line IS NOT NULL AND s.line <= ?
        ORDER BY s.line DESC
        LIMIT 1
        """,
        (file_path, line),
    )


def _all_symbols_in_file(graph: DepGraph, file_path: str):
    """Every symbol whose `file` equals `file_path` in the snapshot."""
    return graph.query(
        """
        SELECT s.qualified_name, s.kind, s.line
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE f.path = ?
        """,
        (file_path,),
    )


def _record_symbol(
    impsym: ImpactedSymbol,
    bucket: dict[tuple[str, str], ImpactedSymbol],
) -> None:
    key = (impsym.file, impsym.qualified_name)
    if key not in bucket:
        bucket[key] = impsym


def _score_risk(n_callers: int, n_endpoints: int) -> RiskScore:
    """Placeholder risk score; thresholds tunable in spec follow-up."""
    score = n_callers + 5 * n_endpoints
    if score < _RISK_LOW:
        level = "low"
    elif score < _RISK_MEDIUM:
        level = "medium"
    else:
        level = "high"
    return RiskScore(score=score, level=level)
