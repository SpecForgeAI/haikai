"""Test coverage analysis skill.

Analyzes a Python test suite to map unit tests to integration tests,
classify coverage, identify gaps, and generate TEST-COVERAGE.md reports.
"""

from src.skills.test_coverage.discovery import TestDiscovery
from src.skills.test_coverage.classifier import TestClassifier
from src.skills.test_coverage.mapper import CoverageMapper
from src.skills.test_coverage.gap_analyzer import GapAnalyzer
from src.skills.test_coverage.report import ReportGenerator

__all__ = [
    "TestDiscovery",
    "TestClassifier",
    "CoverageMapper",
    "GapAnalyzer",
    "ReportGenerator",
]
