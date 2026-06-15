"""Integration tests for report generation — runs on real standards-extractor test suite."""

import re
from pathlib import Path

import pytest

from src.skills.test_coverage.discovery import TestDiscovery
from src.skills.test_coverage.classifier import TestClassifier
from src.skills.test_coverage.mapper import CoverageMapper
from src.skills.test_coverage.gap_analyzer import GapAnalyzer
from src.skills.test_coverage.report import ReportGenerator
from src.skills.test_coverage.cli import analyze

REPO_ROOT = str(Path(__file__).parent.parent.parent.parent)


class TestReportGenerationReal:
    """Test full pipeline report generation on real test suite."""

    def setup_method(self):
        self.report = analyze(repo_path=REPO_ROOT)

    def test_report_not_empty(self):
        """Report should contain content."""
        assert len(self.report) > 100, "Report should have substantial content"

    def test_report_has_header(self):
        """Report should have the project name header."""
        assert "# Test Coverage:" in self.report

    def test_report_has_date(self):
        """Report should include a date."""
        assert "**Date:**" in self.report

    def test_report_has_branch(self):
        """Report should include branch name."""
        assert "**Branch:**" in self.report

    def test_report_has_total_tests(self):
        """Report should include total test count."""
        assert "**Total tests:**" in self.report
        # Extract the number
        match = re.search(r"\*\*Total tests:\*\*\s*(\d+)", self.report)
        assert match, "Should have a numeric total"
        total = int(match.group(1))
        assert total > 50, f"Expected >50 total tests, got {total}"

    def test_report_has_coverage_summary(self):
        """Report should have the coverage summary section."""
        assert "## Coverage Summary" in self.report
        assert "Integration tests (real data)" in self.report
        assert "Unit tests covered by integration" in self.report
        assert "Unit tests (synthetic only)" in self.report

    def test_report_has_integration_files_section(self):
        """Report should list integration test files."""
        assert "## Integration Test Files" in self.report

    def test_report_has_unit_coverage_section(self):
        """Report should have unit test coverage breakdown."""
        assert "## Unit Test Files + Integration Coverage" in self.report

    def test_report_has_markdown_tables(self):
        """Report should contain properly formatted markdown tables."""
        # Check for table headers (pipe-separated)
        table_lines = [l for l in self.report.split("\n") if l.startswith("|")]
        assert len(table_lines) >= 6, "Should have multiple table rows"

    def test_report_percentages_sum_to_100(self):
        """Category percentages should sum to approximately 100%."""
        # Extract all percentage values from the summary table
        percent_pattern = re.compile(r"(\d+\.?\d*)\%")
        lines = self.report.split("\n")
        in_summary = False
        percentages = []
        for line in lines:
            if "## Coverage Summary" in line:
                in_summary = True
                continue
            if in_summary and line.startswith("## "):
                break
            if in_summary and "%" in line and "**Total**" not in line and "Real-data" not in line:
                match = percent_pattern.search(line)
                if match:
                    percentages.append(float(match.group(1)))

        if percentages:
            total = sum(percentages)
            assert 99.0 <= total <= 101.0, \
                f"Percentages should sum to ~100%, got {total}% from {percentages}"

    def test_report_real_data_backing_line(self):
        """Report should include the real-data backing summary line."""
        assert "Real-data backing:" in self.report

    def test_report_valid_markdown(self):
        """Report should be valid markdown (no broken table rows)."""
        for line in self.report.split("\n"):
            if line.startswith("|"):
                # Table rows should have consistent pipe count
                pipes = line.count("|")
                assert pipes >= 3, f"Table row has too few pipes: {line}"


class TestCLIAnalyze:
    """Test the analyze() function directly."""

    def test_analyze_returns_string(self):
        """analyze() should return a string report."""
        result = analyze(repo_path=REPO_ROOT)
        assert isinstance(result, str)
        assert len(result) > 0

    def test_analyze_with_output_file(self, tmp_path):
        """analyze() should write to file when output_path specified.

        Use encoding="utf-8" + newline="" semantics — on Windows
        Path.write_text/read_text default newlines may differ from the
        return value's. We compare via stripped equality of normalized
        line endings."""
        output = tmp_path / "TEST-COVERAGE.md"
        result = analyze(repo_path=REPO_ROOT, output_path=str(output))
        assert output.exists()
        content = output.read_text(encoding="utf-8")
        # Normalize CRLF↔LF: Windows write_text may translate \n to \r\n
        # on read while result has plain \n.
        assert content.replace("\r\n", "\n") == result.replace("\r\n", "\n")

    def test_analyze_with_custom_project_name(self):
        """analyze() should use custom project name."""
        result = analyze(repo_path=REPO_ROOT, project_name="MyProject")
        assert "# Test Coverage: MyProject" in result

    def test_analyze_nonexistent_dir(self):
        """analyze() should handle non-existent repo gracefully."""
        result = analyze(repo_path="/tmp/nonexistent-repo-12345")
        # Should still produce a report, just with 0 tests
        assert "# Test Coverage:" in result
        assert "**Total tests:** 0" in result
