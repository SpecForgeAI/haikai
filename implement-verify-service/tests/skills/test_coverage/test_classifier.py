"""Integration tests for test classification — runs on real standards-extractor test files."""

from pathlib import Path

import pytest

from src.skills.test_coverage.discovery import TestDiscovery
from src.skills.test_coverage.classifier import TestClassifier
from src.skills.test_coverage.models import TestCategory

REPO_ROOT = str(Path(__file__).parent.parent.parent.parent)


class TestClassifierReal:
    """Test classification against actual standards-extractor test files."""

    def setup_method(self):
        discovery = TestDiscovery(REPO_ROOT, ["tests"])
        self.test_files = discovery.discover()
        self.classifier = TestClassifier()
        self.classified = self.classifier.classify(self.test_files)

    def test_classifies_integration_by_directory(self):
        """Files in integration/ directory should be classified as integration."""
        integration_files = [
            tf for tf in self.classified
            if "integration" in tf.path.lower()
        ]
        for tf in integration_files:
            assert tf.category == TestCategory.INTEGRATION, \
                f"{tf.path} should be INTEGRATION (in integration dir), got {tf.category}"

    def test_classifies_integration_by_filename(self):
        """Files with 'integration' in name should be classified as integration."""
        integration_named = [
            tf for tf in self.classified
            if "integration" in Path(tf.path).stem.lower()
        ]
        for tf in integration_named:
            assert tf.category == TestCategory.INTEGRATION, \
                f"{tf.path} should be INTEGRATION (integration in filename), got {tf.category}"

    def test_known_integration_file(self):
        """test_treesitter_integration.py should be classified as integration."""
        treesitter_int = next(
            (tf for tf in self.classified if "test_treesitter_integration" in tf.path),
            None,
        )
        assert treesitter_int is not None, "Should find test_treesitter_integration.py"
        assert treesitter_int.category == TestCategory.INTEGRATION

    def test_has_multiple_categories(self):
        """Should produce multiple categories, not just one."""
        categories = {tf.category for tf in self.classified}
        assert len(categories) >= 2, \
            f"Expected at least 2 categories, got {categories}"

    def test_no_empty_category(self):
        """Integration category should have files."""
        integration = [tf for tf in self.classified if tf.category == TestCategory.INTEGRATION]
        assert len(integration) > 0, "Should have at least one integration test file"

    def test_unit_files_exist(self):
        """Should have some unit test files (not all integration)."""
        unit_files = [
            tf for tf in self.classified
            if tf.category in (TestCategory.UNIT_SYNTHETIC, TestCategory.UNIT_COVERED)
        ]
        assert len(unit_files) > 0, "Should have at least some unit test files"

    def test_resilience_detection(self):
        """Should detect resilience test files (if they exist)."""
        # test_resilience.py should exist and contain resilience tests
        resilience = [
            tf for tf in self.classified
            if "resilience" in tf.path.lower()
        ]
        # If the file exists, it should be classified correctly
        if resilience:
            for tf in resilience:
                assert tf.category in (TestCategory.RESILIENCE, TestCategory.INTEGRATION), \
                    f"{tf.path} should be RESILIENCE or INTEGRATION"

    def test_all_files_classified(self):
        """Every file should have a valid category."""
        for tf in self.classified:
            assert tf.category in TestCategory.__members__.values(), \
                f"{tf.path} has invalid category: {tf.category}"
