"""Integration tests for test discovery — runs on the real standards-extractor test suite."""

import os
from pathlib import Path

import pytest

from src.skills.test_coverage.discovery import TestDiscovery

# Resolve repo root (this file is at tests/skills/test_coverage/)
REPO_ROOT = str(Path(__file__).parent.parent.parent.parent)


class TestDiscoveryReal:
    """Test discovery against the actual standards-extractor test suite."""

    def setup_method(self):
        self.discovery = TestDiscovery(REPO_ROOT, ["tests"])

    def test_discovers_test_files(self):
        """Should find test files in the real tests/ directory."""
        test_files = self.discovery.discover()
        assert len(test_files) > 0, "Should discover at least one test file"
        # We know there are many test files in this repo
        assert len(test_files) >= 10, f"Expected ≥10 test files, got {len(test_files)}"

    def test_all_files_have_test_functions(self):
        """Every discovered file should have at least one test function."""
        test_files = self.discovery.discover()
        for tf in test_files:
            assert tf.test_count > 0, f"{tf.path} has no test functions"

    def test_file_paths_are_relative(self):
        """All paths should be relative to repo root, regardless of OS path separator."""
        test_files = self.discovery.discover()
        for tf in test_files:
            assert not os.path.isabs(tf.path), f"Path should be relative: {tf.path}"
            # Normalize separator for cross-platform: Windows produces
            # backslashes, Linux produces forward slashes; both are valid.
            assert tf.path.replace("\\", "/").startswith("tests/"), (
                f"Path should start with tests/: {tf.path}"
            )

    def test_discovers_known_integration_file(self):
        """Should find the known integration test file."""
        test_files = self.discovery.discover()
        paths = [tf.path for tf in test_files]
        assert any("test_treesitter_integration" in p for p in paths), \
            "Should discover test_treesitter_integration.py"

    def test_discovers_known_unit_file(self):
        """Should find known unit test files."""
        test_files = self.discovery.discover()
        paths = [tf.path for tf in test_files]
        assert any("test_call_graph" in p for p in paths), \
            "Should discover test_call_graph.py"

    def test_extracts_imports(self):
        """Test files should have imports extracted."""
        test_files = self.discovery.discover()
        files_with_imports = [tf for tf in test_files if tf.imports]
        # Most test files import something
        assert len(files_with_imports) > len(test_files) * 0.5, \
            "Most test files should have imports"

    def test_identifies_tested_modules(self):
        """Should identify which src modules are being tested."""
        test_files = self.discovery.discover()
        files_with_modules = [tf for tf in test_files if tf.tested_modules]
        assert len(files_with_modules) > 0, \
            "Some test files should have identifiable tested modules"

    def test_detects_mock_usage(self):
        """Should detect mock usage in test functions."""
        test_files = self.discovery.discover()
        mock_users = []
        for tf in test_files:
            for func in tf.test_functions:
                if func.uses_mocks:
                    mock_users.append(func.name)
        # We know some tests in this repo use mocks
        assert len(mock_users) > 0, "Should detect at least some mock-using tests"

    def test_skips_pycache(self):
        """Should not include __pycache__ files."""
        test_files = self.discovery.discover()
        for tf in test_files:
            assert "__pycache__" not in tf.path, f"Should skip __pycache__: {tf.path}"

    def test_handles_nonexistent_directory(self):
        """Should handle non-existent test directories gracefully."""
        discovery = TestDiscovery(REPO_ROOT, ["nonexistent_dir"])
        test_files = discovery.discover()
        assert test_files == []
