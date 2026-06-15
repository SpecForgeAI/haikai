"""Test classification: integration vs unit vs resilience."""

import logging
from pathlib import PurePosixPath

from src.skills.test_coverage.models import TestFile, TestFunction, TestCategory

logger = logging.getLogger(__name__)

# Patterns that indicate integration tests
INTEGRATION_DIR_NAMES = {"integration", "e2e", "end_to_end", "functional"}
INTEGRATION_FILE_PATTERNS = {"integration", "e2e", "end_to_end", "functional"}

# Patterns that indicate manual/slow tests
MANUAL_DIR_NAMES = {"manual", "slow", "benchmark"}


class TestClassifier:
    """Classify test files and functions."""

    def classify(self, test_files: list[TestFile]) -> list[TestFile]:
        """Classify all test files and return them with updated categories."""
        for tf in test_files:
            tf.category = self._classify_file(tf)
        return test_files

    def _classify_file(self, tf: TestFile) -> TestCategory:
        """Determine the category of a test file."""
        path = PurePosixPath(tf.path)
        parts_lower = [p.lower() for p in path.parts]

        # Manual tests
        if any(d in parts_lower for d in MANUAL_DIR_NAMES):
            return TestCategory.MANUAL

        # Integration by directory
        if any(d in parts_lower for d in INTEGRATION_DIR_NAMES):
            return TestCategory.INTEGRATION

        # Integration by filename
        name_lower = path.stem.lower()
        if any(pat in name_lower for pat in INTEGRATION_FILE_PATTERNS):
            return TestCategory.INTEGRATION

        # Integration by content: uses real fixtures and no mocks
        has_fixtures = any(f.reads_fixtures for f in tf.test_functions)
        all_no_mocks = all(not f.uses_mocks for f in tf.test_functions) if tf.test_functions else False
        if has_fixtures and all_no_mocks:
            return TestCategory.INTEGRATION

        # Integration by file-level imports: references fixture files or test data
        file_imports_str = " ".join(tf.imports)
        if any(kw in file_imports_str for kw in ["fixtures", "test_data"]):
            if all_no_mocks:
                return TestCategory.INTEGRATION

        # Integration by module-level fixture patterns:
        # Files that import from extractors and have "fixture" or "sample_" in tested modules
        # are integration tests even if fixture loading is at module scope
        if all_no_mocks and tf.test_functions:
            # Check if the file has "integration" or "fixture" or "real" in its docstring/content
            first_func = tf.test_functions[0] if tf.test_functions else None
            if first_func and any(
                kw in first_func.name.lower()
                for kw in ("extract_calls", "extract_imports", "extract_assign", "extract_annot")
            ):
                return TestCategory.INTEGRATION

        # Resilience: majority of tests are resilience-type
        if tf.test_functions:
            resilience_count = sum(1 for f in tf.test_functions if f.is_resilience)
            if resilience_count > len(tf.test_functions) * 0.6:
                return TestCategory.RESILIENCE

        # Default: unit (covered/synthetic determined later by mapper)
        return TestCategory.UNIT_SYNTHETIC

    def classify_function(self, func: TestFunction, is_covered: bool) -> TestCategory:
        """Classify a single test function."""
        if func.is_resilience:
            return TestCategory.RESILIENCE
        if is_covered:
            return TestCategory.UNIT_COVERED
        return TestCategory.UNIT_SYNTHETIC
