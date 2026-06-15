"""Generate TEST-COVERAGE.md reports."""

import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from src.skills.test_coverage.models import (
    TestFile, TestCategory, CoverageMapping, CoverageGap,
    CoverageReport, GapReason,
)

logger = logging.getLogger(__name__)


class ReportGenerator:
    """Generate markdown coverage reports."""

    def __init__(self, repo_path: str, project_name: Optional[str] = None):
        self.repo_path = Path(repo_path)
        self.project_name = project_name or self.repo_path.name

    def generate(
        self,
        test_files: list[TestFile],
        mappings: list[CoverageMapping],
        gaps: list[CoverageGap],
    ) -> str:
        """Generate complete TEST-COVERAGE.md content."""
        report = self._build_report(test_files, mappings, gaps)
        return self._render(report)

    def _build_report(
        self,
        test_files: list[TestFile],
        mappings: list[CoverageMapping],
        gaps: list[CoverageGap],
    ) -> CoverageReport:
        """Build report data from analysis results."""
        integration_files = [tf for tf in test_files if tf.category == TestCategory.INTEGRATION]
        resilience_files = [tf for tf in test_files if tf.category == TestCategory.RESILIENCE]
        manual_files = [tf for tf in test_files if tf.category == TestCategory.MANUAL]

        # Count tests by category
        integration_count = sum(tf.test_count for tf in integration_files)
        resilience_count = sum(tf.test_count for tf in resilience_files)
        manual_count = sum(tf.test_count for tf in manual_files)

        # Count covered vs synthetic from mappings
        unit_covered = sum(m.covered_count for m in mappings)
        unit_synthetic = sum(m.gap_count for m in mappings)

        total = integration_count + unit_covered + unit_synthetic + resilience_count + manual_count

        return CoverageReport(
            total_tests=total,
            integration_count=integration_count,
            unit_covered_count=unit_covered,
            unit_synthetic_count=unit_synthetic,
            resilience_count=resilience_count,
            manual_count=manual_count,
            integration_files=integration_files,
            coverage_mappings=mappings,
            gaps=gaps,
            branch_name=self._get_branch(),
            date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            project_name=self.project_name,
        )

    def _render(self, report: CoverageReport) -> str:
        """Render report to markdown."""
        lines = []

        # Header
        lines.append(f"# Test Coverage: {report.project_name}\n")
        lines.append(f"**Date:** {report.date}")
        lines.append(f"**Total tests:** {report.total_tests}")
        lines.append(f"**Branch:** `{report.branch_name}`\n")
        lines.append("---\n")

        # Coverage summary
        lines.append("## Coverage Summary\n")
        lines.append("| Category | Tests | % |")
        lines.append("|----------|------:|--:|")

        total = report.total_tests or 1  # avoid division by zero
        real_data_backed = report.integration_count + report.unit_covered_count + report.resilience_count

        lines.append(
            f"| Integration tests (real data) | {report.integration_count} "
            f"| {report.integration_count * 100 / total:.1f}% |"
        )
        lines.append(
            f"| Unit tests covered by integration | {report.unit_covered_count} "
            f"| {report.unit_covered_count * 100 / total:.1f}% |"
        )
        lines.append(
            f"| Resilience scenarios (functional) | {report.resilience_count} "
            f"| {report.resilience_count * 100 / total:.1f}% |"
        )
        lines.append(
            f"| Unit tests (synthetic only) | {report.unit_synthetic_count} "
            f"| {report.unit_synthetic_count * 100 / total:.1f}% |"
        )
        lines.append(
            f"| **Total** | **{report.total_tests}** | **100%** |"
        )
        lines.append(
            f"\n**Real-data backing: {real_data_backed} / {report.total_tests} "
            f"({real_data_backed * 100 / total:.1f}%)**"
            f" — only {report.unit_synthetic_count} tests are purely synthetic "
            f"with no integration coverage.\n"
        )
        lines.append("---\n")

        # Integration test files
        lines.append("## Integration Test Files\n")
        lines.append("| File | Tests | Real Data |")
        lines.append("|------|------:|-----------|")
        for tf in sorted(report.integration_files, key=lambda f: f.path):
            real_data = ", ".join(tf.tested_modules[:3]) or "real files"
            lines.append(f"| `{tf.path}` | {tf.test_count} | {real_data} |")
        lines.append("")
        lines.append("---\n")

        # Unit test file breakdown
        lines.append("## Unit Test Files + Integration Coverage\n")
        lines.append("| File | Unit | Covered by Integration | Gap |")
        lines.append("|------|-----:|----------------------:|----:|")
        for m in sorted(report.coverage_mappings, key=lambda x: x.unit_file):
            lines.append(
                f"| `{m.unit_file}` | {m.unit_count} | {m.covered_count} | {m.gap_count} |"
            )
        total_unit = sum(m.unit_count for m in report.coverage_mappings)
        total_covered = sum(m.covered_count for m in report.coverage_mappings)
        total_gap = sum(m.gap_count for m in report.coverage_mappings)
        lines.append(
            f"| **Totals** | **{total_unit}** | **{total_covered}** | **{total_gap}** |"
        )
        lines.append("")
        lines.append("---\n")

        # Uncovered tests
        if report.gaps:
            lines.append("## Uncovered Tests — Classification\n")

            # Group by reason
            edge_cases = [g for g in report.gaps if g.reason == GapReason.EDGE_CASE]
            error_handling = [g for g in report.gaps if g.reason == GapReason.ERROR_HANDLING]
            genuine_gaps = [g for g in report.gaps if g.reason == GapReason.GENUINE_GAP]

            if edge_cases:
                lines.append(f"### Edge Cases ({len(edge_cases)} tests)\n")
                lines.append("These test defensive paths that cannot trigger on real data:\n")
                for g in sorted(edge_cases, key=lambda x: x.file_path):
                    lines.append(f"- `{g.test_name}` ({g.file_path}) — {g.description}")
                lines.append("")

            if error_handling:
                lines.append(f"### Error Handling ({len(error_handling)} tests)\n")
                lines.append("These test error conditions:\n")
                for g in sorted(error_handling, key=lambda x: x.file_path):
                    lines.append(f"- `{g.test_name}` ({g.file_path}) — {g.description}")
                lines.append("")

            if genuine_gaps:
                lines.append(f"### Genuine Gaps ({len(genuine_gaps)} tests)\n")
                lines.append("These test normal behavior with no integration counterpart — **needs remediation**:\n")
                for g in sorted(genuine_gaps, key=lambda x: x.file_path):
                    lines.append(f"- `{g.test_name}` ({g.file_path}) — {g.description}")
                lines.append("")

        return "\n".join(lines) + "\n"

    def _get_branch(self) -> str:
        """Get current git branch name."""
        try:
            result = subprocess.run(
                ["git", "branch", "--show-current"],
                capture_output=True, text=True, timeout=5,
                cwd=self.repo_path,
            )
            return result.stdout.strip() or "unknown"
        except Exception:
            return "unknown"
