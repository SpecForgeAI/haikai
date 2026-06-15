"""Command-line entry point for test coverage analysis."""

import argparse
import sys
from pathlib import Path

from src.skills.test_coverage.discovery import TestDiscovery
from src.skills.test_coverage.classifier import TestClassifier
from src.skills.test_coverage.mapper import CoverageMapper
from src.skills.test_coverage.gap_analyzer import GapAnalyzer
from src.skills.test_coverage.report import ReportGenerator


def analyze(
    repo_path: str,
    test_dirs: list[str] | None = None,
    output_path: str | None = None,
    project_name: str | None = None,
) -> str:
    """Run the full coverage analysis pipeline.

    Returns the generated report content.
    """
    test_dirs = test_dirs or ["tests"]

    # 1. Discover test files
    discovery = TestDiscovery(repo_path, test_dirs)
    test_files = discovery.discover()

    # 2. Classify tests
    classifier = TestClassifier()
    test_files = classifier.classify(test_files)

    # 3. Map coverage
    mapper = CoverageMapper()
    mappings = mapper.map_coverage(test_files)

    # 4. Analyze gaps
    gap_analyzer = GapAnalyzer()
    gaps = gap_analyzer.analyze(test_files, mappings)

    # 5. Generate report
    generator = ReportGenerator(repo_path, project_name)
    report = generator.generate(test_files, mappings, gaps)

    # Write report if output path specified
    if output_path:
        Path(output_path).write_text(report, encoding="utf-8")
        print(f"Report written to {output_path}")

    return report


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Analyze test coverage: unit ↔ integration mapping"
    )
    parser.add_argument(
        "repo_path",
        nargs="?",
        default=".",
        help="Repository root path (default: current directory)",
    )
    parser.add_argument(
        "--test-dirs",
        nargs="+",
        default=["tests"],
        help="Test directories to scan (default: tests)",
    )
    parser.add_argument(
        "--output", "-o",
        help="Output path for TEST-COVERAGE.md",
    )
    parser.add_argument(
        "--project-name",
        help="Project name for the report header",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Print summary only (no full report)",
    )

    args = parser.parse_args()

    report = analyze(
        repo_path=args.repo_path,
        test_dirs=args.test_dirs,
        output_path=args.output,
        project_name=args.project_name,
    )

    if args.summary:
        # Print just the summary section
        lines = report.split("\n")
        in_summary = False
        for line in lines:
            if line.startswith("## Coverage Summary"):
                in_summary = True
            elif line.startswith("## ") and in_summary:
                break
            if in_summary:
                print(line)
    elif not args.output:
        # Print full report to stdout
        print(report)


if __name__ == "__main__":
    main()
