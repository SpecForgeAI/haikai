"""Surefire / Failsafe report reader (2026-09-09): skipped tests are not passing tests.

WHY. The only verification signals the service had were a literal
``VERDICT=PASS`` in the model's own stdout (the repair gate) and the inline
runner's exit code. Nothing parsed the test reports. A Surefire run whose
Testcontainers classes were 100% skipped (no Docker daemon) exited 0 and
printed BUILD SUCCESS, so both gates read it as green -- and the run reported
implemented work that had never been verified.

The reader is STATIC (XML under ``target/surefire-reports`` /
``target/failsafe-reports``), judged PER CLASS: the console aggregate and the
XML sums disagree on nested classes (each gets its own report file), so the
totals are the wrong unit. A class with ``tests > 0`` and ``skipped == tests``
contributed NO verification at all -- the Testcontainers/@Disabled shape.
Partial skips are noise; a wholly-skipped class is a hole.
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

REPORT_DIR_NAMES = ("surefire-reports", "failsafe-reports")
#: Upper bound on report files parsed per repo; the gate must never spend real IO.
MAX_REPORT_FILES = 2000


@dataclass
class SurefireSummary:
    total: int = 0
    skipped: int = 0
    failures: int = 0
    errors: int = 0
    report_files: int = 0
    #: Fully qualified names of classes with tests > 0 and skipped == tests.
    fully_skipped_classes: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "total": self.total,
            "skipped": self.skipped,
            "failures": self.failures,
            "errors": self.errors,
            "report_files": self.report_files,
            "fully_skipped_classes": list(self.fully_skipped_classes),
        }


def find_report_files(repo_dir: Path) -> List[Path]:
    """Every ``TEST-*.xml`` (and bare ``*.xml``) under any ``target/{surefire,failsafe}-reports``."""
    root = Path(repo_dir)
    found: List[Path] = []
    try:
        for target in root.rglob("target"):
            if not target.is_dir():
                continue
            for name in REPORT_DIR_NAMES:
                reports = target / name
                if not reports.is_dir():
                    continue
                for xml in sorted(reports.glob("*.xml")):
                    found.append(xml)
                    if len(found) >= MAX_REPORT_FILES:
                        return found
    except OSError:
        return found
    return found


def _int_attr(el: ET.Element, name: str) -> int:
    try:
        return int(el.get(name) or 0)
    except (TypeError, ValueError):
        return 0


def read_surefire_reports(report_files: Iterable[Path]) -> SurefireSummary:
    """Parse ``testsuite`` elements; per-class skip judgement from the file's own counts."""
    summary = SurefireSummary()
    for path in report_files:
        try:
            root = ET.parse(path).getroot()
        except (ET.ParseError, OSError) as exc:
            logger.warning("surefire: could not parse %s: %s", path, exc)
            continue
        suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
        for suite in suites:
            tests = _int_attr(suite, "tests")
            skipped = _int_attr(suite, "skipped")
            summary.report_files += 1
            summary.total += tests
            summary.skipped += skipped
            summary.failures += _int_attr(suite, "failures")
            summary.errors += _int_attr(suite, "errors")
            if tests > 0 and skipped >= tests:
                name = (suite.get("name") or path.stem).strip()
                if name and name not in summary.fully_skipped_classes:
                    summary.fully_skipped_classes.append(name)
    summary.fully_skipped_classes.sort()
    return summary


def summarize_repo(repo_dir: Path) -> Optional[SurefireSummary]:
    """``None`` when the repo has no reports at all (nothing ran, or not a JVM repo)."""
    files = find_report_files(repo_dir)
    if not files:
        return None
    return read_surefire_reports(files)


def _simple_name(fqcn: str) -> str:
    return fqcn.rsplit(".", 1)[-1].rsplit("$", 1)[-1]


def undeclared_fully_skipped_classes(
    summary: SurefireSummary, declared_blocked_notes: Sequence[str]
) -> List[str]:
    """Wholly-skipped classes NOT declared out of scope by a reasoned ``[~]`` task.

    A class is "declared" when any reasoned blocked-task note mentions its
    simple or fully-qualified name (case-insensitive). The spec's tasks.md is
    the one place the implementer can legitimately say "this class cannot run
    here and why"; the same BLOCKED idiom, the same reason threshold.
    """
    haystack = "\n".join(declared_blocked_notes or []).lower()
    undeclared: List[str] = []
    for fqcn in summary.fully_skipped_classes:
        simple = _simple_name(fqcn).lower()
        if fqcn.lower() in haystack or re.search(rf"\b{re.escape(simple)}\b", haystack):
            continue
        undeclared.append(fqcn)
    return sorted(undeclared)
