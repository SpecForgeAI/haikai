"""Coverage mapping: unit test ↔ integration test relationships."""

import logging
from collections import defaultdict

from src.skills.test_coverage.models import (
    TestFile, TestCategory, CoverageMapping,
)

logger = logging.getLogger(__name__)


class CoverageMapper:
    """Map unit tests to integration test coverage."""

    def map_coverage(self, test_files: list[TestFile]) -> list[CoverageMapping]:
        """Build coverage mappings from classified test files.

        For each unit test file, find integration tests that cover the same
        source modules. Update unit file categories to UNIT_COVERED when
        integration coverage exists.
        """
        # Build module → integration file index
        integration_by_module = self._build_integration_index(test_files)

        # Map each unit test file to its integration coverage
        mappings = []
        for tf in test_files:
            if tf.category in (TestCategory.INTEGRATION, TestCategory.MANUAL):
                continue

            integration_files = self._find_coverage(tf, integration_by_module)
            covered_count = self._count_covered_functions(tf, integration_files, test_files)

            mapping = CoverageMapping(
                unit_file=tf.path,
                unit_count=tf.test_count,
                covered_count=covered_count,
                gap_count=tf.test_count - covered_count,
                integration_files=[f for f in integration_files],
            )
            mappings.append(mapping)

            # Update category if any coverage exists
            if covered_count > 0 and tf.category == TestCategory.UNIT_SYNTHETIC:
                tf.category = TestCategory.UNIT_COVERED

        return mappings

    def _build_integration_index(
        self, test_files: list[TestFile]
    ) -> dict[str, list[str]]:
        """Build index: source module → [integration test files]."""
        index: dict[str, list[str]] = defaultdict(list)
        for tf in test_files:
            if tf.category != TestCategory.INTEGRATION:
                continue
            for module in tf.tested_modules:
                index[module].append(tf.path)
        return index

    def _find_coverage(
        self,
        unit_file: TestFile,
        integration_by_module: dict[str, list[str]],
    ) -> list[str]:
        """Find integration test files that cover the same modules as this unit file."""
        coverage = set()
        for module in unit_file.tested_modules:
            if module in integration_by_module:
                coverage.update(integration_by_module[module])
            # Also check parent modules (e.g., src.ast covers src.ast.store)
            parts = module.split(".")
            for i in range(len(parts) - 1, 0, -1):
                parent = ".".join(parts[:i])
                if parent in integration_by_module:
                    coverage.update(integration_by_module[parent])
        return sorted(coverage)

    def _count_covered_functions(
        self,
        unit_file: TestFile,
        integration_files: list[str],
        all_files: list[TestFile],
    ) -> int:
        """Count how many unit test functions are covered by integration tests.

        A unit test function is 'covered' if an integration test exercises
        the same source module. This is a module-level heuristic — if the
        integration test imports and tests the same module, we consider the
        unit test's happy-path behavior covered.

        Resilience tests (error/edge cases) are NOT counted as covered even
        if module coverage exists — they test paths that real data can't trigger.
        """
        if not integration_files:
            return 0

        covered = 0
        for func in unit_file.test_functions:
            if func.is_resilience:
                continue  # Edge cases aren't "covered" by integration
            if func.uses_mocks and integration_files:
                # If it uses mocks but integration exists for the module → covered
                covered += 1
            elif not func.uses_mocks:
                # Non-mock test with integration coverage → covered
                covered += 1

        return covered
