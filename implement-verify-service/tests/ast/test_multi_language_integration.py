"""Cross-language integration tests.

Verifies that the TreeSitterProvider correctly handles mixed-language
projects and produces merged output from Python + TypeScript + Go files.
"""
import importlib
import pytest
from pathlib import Path

from src.ast.treesitter_provider import TreeSitterProvider


def _has_grammars(*names: str) -> bool:
    """True if every named tree-sitter grammar package is importable.

    Multi-language tests need the optional `tree_sitter_typescript`,
    `tree_sitter_go`, etc. grammars. The Dockerfile installs them; local
    `.venv` typically does not. Skip rather than fail in that env.
    """
    for n in names:
        try:
            importlib.import_module(n)
        except ImportError:
            return False
    return True


pytestmark = pytest.mark.skipif(
    not _has_grammars("tree_sitter_typescript", "tree_sitter_go"),
    reason=(
        "Optional tree-sitter grammars (typescript, go) missing from this env. "
        "Install via the Dockerfile.dev path; local .venv runs skip these. "
        "Tracked in fix/260504-1127-full-repo-green."
    ),
)


FIXTURES = [
    "tests/fixtures/sample_python.py",
    "tests/fixtures/sample_typescript.ts",
    "tests/fixtures/sample_go.go",
]


@pytest.fixture
def provider():
    return TreeSitterProvider()


class TestCrossLanguageAnalysis:
    """Test mixed-language analysis in a single batch."""

    def test_all_files_analyzed(self, provider):
        """All 3 fixture files produce results."""
        results = provider.analyze_batch(FIXTURES)
        assert len(results) == 3, f"Expected 3 results, got {len(results)}"

    def test_correct_language_per_file(self, provider):
        """Each file tagged with correct language."""
        results = provider.analyze_batch(FIXTURES)
        for fp, analysis in results.items():
            if fp.endswith(".py"):
                assert analysis.language == "python"
            elif fp.endswith(".ts"):
                assert analysis.language == "typescript"
            elif fp.endswith(".go"):
                assert analysis.language == "go"

    def test_all_files_have_calls(self, provider):
        """Each fixture produces call data."""
        results = provider.analyze_batch(FIXTURES)
        for fp, analysis in results.items():
            assert len(analysis.calls) > 0, f"No calls from {fp}"

    def test_all_files_have_imports(self, provider):
        """Each fixture produces import data."""
        results = provider.analyze_batch(FIXTURES)
        for fp, analysis in results.items():
            assert len(analysis.imports) > 0, f"No imports from {fp}"

    def test_provider_used_is_treesitter(self, provider):
        """All results marked as treesitter provider."""
        results = provider.analyze_batch(FIXTURES)
        for analysis in results.values():
            assert analysis.provider_used == "treesitter"

    def test_merged_call_count(self, provider):
        """Total calls from all 3 languages is substantial."""
        results = provider.analyze_batch(FIXTURES)
        total = sum(len(a.calls) for a in results.values())
        assert total >= 50, f"Expected 50+ total calls, got {total}"

    def test_merged_import_count(self, provider):
        """Total imports from all 3 languages."""
        results = provider.analyze_batch(FIXTURES)
        total = sum(len(a.imports) for a in results.values())
        assert total >= 11, f"Expected 11+ total imports, got {total}"

    def test_unsupported_files_skipped(self, provider):
        """Non-supported files silently skipped."""
        mixed = FIXTURES + ["fake.rb", "fake.swift", "fake.kt"]
        results = provider.analyze_batch(mixed)
        assert len(results) == 3, "Only supported files should produce results"

    def test_python_not_regressed(self, provider):
        """Python output hasn't changed from adding TS/Go support."""
        py_results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        mixed_results = provider.analyze_batch(FIXTURES)

        py_only = py_results.get("tests/fixtures/sample_python.py")
        py_mixed = mixed_results.get("tests/fixtures/sample_python.py")

        assert py_only is not None
        assert py_mixed is not None
        assert len(py_only.calls) == len(py_mixed.calls)
        assert len(py_only.imports) == len(py_mixed.imports)
