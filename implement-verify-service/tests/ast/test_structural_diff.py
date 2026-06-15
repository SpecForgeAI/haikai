"""Tests for the StructuralDiff module."""
from pathlib import Path

import pytest

from src.ast.models import (
    StructuralAnalysis, SymbolInfo, SymbolKind, InheritanceInfo, ImportInfo
)
from src.ast.store import FileStore
from src.ast.structural_diff import StructuralDiff


def _make_snapshot(store, commit_sha, analyses):
    """Helper to create a snapshot."""
    return Path(store.write_snapshot(
        repo_name="test-repo",
        commit_sha=commit_sha,
        branch="main",
        provider="ctags",
        analyses=analyses,
        project_root=".",
    ))


@pytest.fixture
def store(tmp_path):
    return FileStore(
        base_path=str(tmp_path / "structural"),
        config={"diagrams": {"auto_generate": False}},
    )


@pytest.fixture
def base_analyses():
    return {
        "src/api.py": StructuralAnalysis(
            file_path="src/api.py",
            language="Python",
            symbols=[
                SymbolInfo(name="App", kind=SymbolKind.CLASS, line_start=1),
                SymbolInfo(name="run", kind=SymbolKind.METHOD, scope="App",
                           line_start=10, signature="(self)"),
            ],
            inheritance=[InheritanceInfo(class_name="App", bases=["BaseApp"])],
            imports=[ImportInfo(module="base", names=["BaseApp"])],
            provider_used="ctags",
        ),
        "src/utils.py": StructuralAnalysis(
            file_path="src/utils.py",
            language="Python",
            symbols=[
                SymbolInfo(name="helper", kind=SymbolKind.FUNCTION, line_start=1, signature="(x)"),
            ],
            imports=[],
            provider_used="ctags",
        ),
    }


class TestStructuralDiff:

    def test_detects_added_symbols(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)

        # Add a new symbol
        new_analyses = dict(base_analyses)
        new_symbols = list(base_analyses["src/api.py"].symbols) + [
            SymbolInfo(name="shutdown", kind=SymbolKind.METHOD, scope="App",
                       line_start=20, signature="(self)"),
        ]
        new_analyses["src/api.py"] = StructuralAnalysis(
            file_path="src/api.py",
            language="Python",
            symbols=new_symbols,
            inheritance=base_analyses["src/api.py"].inheritance,
            imports=base_analyses["src/api.py"].imports,
            provider_used="ctags",
        )
        curr = _make_snapshot(store, "bbb2222", new_analyses)

        differ = StructuralDiff()
        content = differ.generate_diff(prev, curr)

        assert "Added Symbols:" in content
        assert "shutdown" in content

    def test_detects_removed_symbols(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)

        # Remove utils.py entirely
        new_analyses = {"src/api.py": base_analyses["src/api.py"]}
        curr = _make_snapshot(store, "bbb2222", new_analyses)

        differ = StructuralDiff()
        content = differ.generate_diff(prev, curr)

        assert "Removed Symbols:" in content
        assert "helper" in content

    def test_detects_modified_signatures(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)

        # Modify signature
        new_analyses = dict(base_analyses)
        new_symbols = [
            SymbolInfo(name="App", kind=SymbolKind.CLASS, line_start=1),
            SymbolInfo(name="run", kind=SymbolKind.METHOD, scope="App",
                       line_start=10, signature="(self, debug: bool = False)"),
        ]
        new_analyses["src/api.py"] = StructuralAnalysis(
            file_path="src/api.py",
            language="Python",
            symbols=new_symbols,
            inheritance=base_analyses["src/api.py"].inheritance,
            imports=base_analyses["src/api.py"].imports,
            provider_used="ctags",
        )
        curr = _make_snapshot(store, "bbb2222", new_analyses)

        differ = StructuralDiff()
        content = differ.generate_diff(prev, curr)

        assert "Modified Signatures:" in content
        assert "run" in content

    def test_detects_inheritance_changes(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)

        # Add new inheritance
        new_analyses = dict(base_analyses)
        new_analyses["src/api.py"] = StructuralAnalysis(
            file_path="src/api.py",
            language="Python",
            symbols=base_analyses["src/api.py"].symbols,
            inheritance=[
                InheritanceInfo(class_name="App", bases=["BaseApp"]),
                InheritanceInfo(class_name="App", bases=["Configurable"]),
            ],
            imports=base_analyses["src/api.py"].imports,
            provider_used="ctags",
        )
        curr = _make_snapshot(store, "bbb2222", new_analyses)

        differ = StructuralDiff()
        content = differ.generate_diff(prev, curr)

        assert "Added Inheritance:" in content
        assert "Configurable" in content

    def test_detects_import_changes(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)

        # Add new import
        new_analyses = dict(base_analyses)
        new_analyses["src/api.py"] = StructuralAnalysis(
            file_path="src/api.py",
            language="Python",
            symbols=base_analyses["src/api.py"].symbols,
            inheritance=base_analyses["src/api.py"].inheritance,
            imports=[
                ImportInfo(module="base", names=["BaseApp"]),
                ImportInfo(module="logging", names=["getLogger"]),
            ],
            provider_used="ctags",
        )
        curr = _make_snapshot(store, "bbb2222", new_analyses)

        differ = StructuralDiff()
        content = differ.generate_diff(prev, curr)

        assert "Added Imports:" in content
        assert "logging" in content

    def test_no_changes_produces_summary(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)
        curr = _make_snapshot(store, "bbb2222", base_analyses)

        differ = StructuralDiff()
        content = differ.generate_diff(prev, curr)

        assert "Summary:" in content
        assert "No structural changes" in content

    def test_diff_written_to_file(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)
        curr = _make_snapshot(store, "bbb2222", base_analyses)

        differ = StructuralDiff()
        differ.generate_diff(prev, curr)

        diff_file = curr / "_diff.txt"
        assert diff_file.exists()
        content = diff_file.read_text()
        assert "Diff:" in content

    def test_diff_header_shows_shas(self, store, base_analyses):
        prev = _make_snapshot(store, "aaa1111", base_analyses)
        curr = _make_snapshot(store, "bbb2222", base_analyses)

        differ = StructuralDiff()
        content = differ.generate_diff(prev, curr)

        assert "aaa1111" in content
        assert "bbb2222" in content
