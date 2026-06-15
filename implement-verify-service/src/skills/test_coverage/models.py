"""Data models for test coverage analysis."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class TestCategory(Enum):
    """Classification of a test file or function."""
    INTEGRATION = "integration"
    UNIT_COVERED = "unit_covered"
    UNIT_SYNTHETIC = "unit_synthetic"
    RESILIENCE = "resilience"
    MANUAL = "manual"


class GapReason(Enum):
    """Why a unit test has no integration coverage."""
    EDGE_CASE = "edge_case"
    ERROR_HANDLING = "error_handling"
    GENUINE_GAP = "genuine_gap"


@dataclass
class TestFunction:
    """A single test function or method."""
    name: str
    file_path: str
    class_name: Optional[str] = None
    imports: list[str] = field(default_factory=list)
    uses_mocks: bool = False
    reads_fixtures: bool = False
    tested_module: Optional[str] = None
    decorators: list[str] = field(default_factory=list)
    is_resilience: bool = False


@dataclass
class TestFile:
    """A test file with its functions and classification."""
    path: str
    test_functions: list[TestFunction] = field(default_factory=list)
    category: TestCategory = TestCategory.UNIT_SYNTHETIC
    imports: list[str] = field(default_factory=list)
    tested_modules: list[str] = field(default_factory=list)

    @property
    def is_integration(self) -> bool:
        return self.category == TestCategory.INTEGRATION

    @property
    def test_count(self) -> int:
        return len(self.test_functions)


@dataclass
class CoverageMapping:
    """Maps a unit test file to its integration coverage."""
    unit_file: str
    unit_count: int
    covered_count: int
    gap_count: int
    integration_files: list[str] = field(default_factory=list)


@dataclass
class CoverageGap:
    """A unit test with no integration coverage."""
    test_name: str
    file_path: str
    reason: GapReason = GapReason.GENUINE_GAP
    description: str = ""


@dataclass
class CoverageReport:
    """Complete coverage analysis results."""
    total_tests: int = 0
    integration_count: int = 0
    unit_covered_count: int = 0
    unit_synthetic_count: int = 0
    resilience_count: int = 0
    manual_count: int = 0
    integration_files: list[TestFile] = field(default_factory=list)
    coverage_mappings: list[CoverageMapping] = field(default_factory=list)
    gaps: list[CoverageGap] = field(default_factory=list)
    branch_name: str = ""
    date: str = ""
    project_name: str = ""
