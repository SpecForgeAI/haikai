"""Gap analysis: identify unit tests without integration coverage."""

import logging

from src.skills.test_coverage.models import (
    TestFile, TestFunction, TestCategory, CoverageMapping,
    CoverageGap, GapReason,
)

logger = logging.getLogger(__name__)

# Keywords in test names that indicate edge/defensive cases
EDGE_CASE_KEYWORDS = {
    "empty", "none", "null", "missing", "default", "zero",
    "boundary", "limit", "max", "min", "overflow", "truncat",
}

ERROR_HANDLING_KEYWORDS = {
    "error", "invalid", "corrupt", "malformed", "broken",
    "fail", "timeout", "unavailable", "unknown", "bad",
    "wrong", "negative", "exception", "crash", "panic",
}


class GapAnalyzer:
    """Analyze coverage gaps and classify them."""

    def analyze(
        self,
        test_files: list[TestFile],
        mappings: list[CoverageMapping],
    ) -> list[CoverageGap]:
        """Find and classify all coverage gaps."""
        gaps = []

        # Build lookup: file path → mapping
        mapping_by_file = {m.unit_file: m for m in mappings}

        for tf in test_files:
            if tf.category in (TestCategory.INTEGRATION, TestCategory.MANUAL):
                continue

            mapping = mapping_by_file.get(tf.path)
            if not mapping:
                continue

            if mapping.gap_count == 0:
                continue

            # Find which specific functions are uncovered
            for func in tf.test_functions:
                if self._is_uncovered(func, mapping):
                    gap = self._classify_gap(func)
                    gaps.append(gap)

        return gaps

    def _is_uncovered(self, func: TestFunction, mapping: CoverageMapping) -> bool:
        """Check if a specific function is uncovered."""
        # Resilience tests are always in the gap (by design — can't trigger on real data)
        if func.is_resilience:
            return True
        # If no integration files at all, everything is uncovered
        if not mapping.integration_files:
            return True
        # Mock-using tests with integration coverage are covered
        if func.uses_mocks and mapping.integration_files:
            return False
        # Non-mock tests with integration coverage are covered
        if not func.uses_mocks and mapping.integration_files:
            return False
        return True

    def _classify_gap(self, func: TestFunction) -> CoverageGap:
        """Classify a coverage gap by reason."""
        name_lower = func.name.lower()

        # Check for edge case patterns
        if any(kw in name_lower for kw in EDGE_CASE_KEYWORDS):
            return CoverageGap(
                test_name=f"{func.class_name}.{func.name}" if func.class_name else func.name,
                file_path=func.file_path,
                reason=GapReason.EDGE_CASE,
                description=f"Tests edge case: {self._describe_edge_case(name_lower)}",
            )

        # Check for error handling patterns
        if any(kw in name_lower for kw in ERROR_HANDLING_KEYWORDS):
            return CoverageGap(
                test_name=f"{func.class_name}.{func.name}" if func.class_name else func.name,
                file_path=func.file_path,
                reason=GapReason.ERROR_HANDLING,
                description=f"Tests error handling: {self._describe_error_case(name_lower)}",
            )

        # Check if resilience test
        if func.is_resilience:
            return CoverageGap(
                test_name=f"{func.class_name}.{func.name}" if func.class_name else func.name,
                file_path=func.file_path,
                reason=GapReason.EDGE_CASE,
                description="Resilience/defensive test — cannot trigger on healthy real data",
            )

        # Genuine gap
        return CoverageGap(
            test_name=f"{func.class_name}.{func.name}" if func.class_name else func.name,
            file_path=func.file_path,
            reason=GapReason.GENUINE_GAP,
            description="Normal behavior with no integration test counterpart",
        )

    def _describe_edge_case(self, name: str) -> str:
        """Generate a human-readable description of an edge case."""
        if "empty" in name:
            return "empty input handling"
        if "none" in name or "null" in name:
            return "None/null value handling"
        if "missing" in name:
            return "missing data handling"
        if "default" in name:
            return "default value behavior"
        if "boundary" in name or "limit" in name:
            return "boundary condition"
        if "overflow" in name or "truncat" in name:
            return "overflow/truncation handling"
        return "edge case behavior"

    def _describe_error_case(self, name: str) -> str:
        """Generate a human-readable description of an error case."""
        if "timeout" in name:
            return "timeout handling"
        if "invalid" in name:
            return "invalid input rejection"
        if "corrupt" in name or "malformed" in name:
            return "corrupt/malformed data handling"
        if "unavailable" in name:
            return "unavailability handling"
        if "unknown" in name:
            return "unknown value handling"
        return "error condition handling"
