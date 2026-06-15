"""Unit tests for call graph edge cases NOT covered by integration tests.

Integration coverage (test_treesitter_integration.py + test_diagram_integration.py):
- CallInfo construction, defaults, external callees → real call data from src/ast/
- _calls.txt creation, tab-separated format, grepability → test_calls_file_*
- Registry merge (extends calls, no duplicate symbols, upgrades depth) → pipeline tests
- read_calls from file → test_read_calls_round_trip
- SequenceDiagramBuilder build/entry_points/discovery → test_sequence_diagram_from_real_calls
- All 4 sequence serialisers → test_diagram_integration serialiser tests
"""
import pytest
from pathlib import Path

from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind, CallInfo
from src.ast.store import FileStore
from src.ast.provider import ProviderRegistry
from src.ast.diagram_builders import read_calls, SequenceDiagramBuilder


class TestCallGraphEdgeCases:
    """Cases that need synthetic data — can't trigger on real code."""

    @pytest.fixture
    def store(self, tmp_path):
        return FileStore(
            base_path=str(tmp_path / "structural"),
            config={"diagrams": {"auto_generate": False}},
        )

    def test_calls_header_only_when_no_data(self, store):
        """No calls → header-only file."""
        analyses = {
            "src/api.py": StructuralAnalysis(
                file_path="src/api.py", language="Python",
                symbols=[SymbolInfo(name="main", kind=SymbolKind.FUNCTION, line_start=1)],
                provider_used="ctags",
            ),
        }
        path = store.write_snapshot(
            repo_name="test", commit_sha="abc1234",
            branch="main", provider="ctags",
            analyses=analyses, project_root=".",
        )
        content = (Path(path) / "_calls.txt").read_text()
        data_lines = [l for l in content.splitlines() if not l.startswith("#") and l.strip()]
        assert len(data_lines) == 0

    def test_read_calls_empty_file(self, tmp_path):
        (tmp_path / "_calls.txt").write_text("# caller_file\tcaller\tcallee_file\tcallee\tline\n")
        assert read_calls(tmp_path) == []

    def test_read_calls_missing_file(self, tmp_path):
        assert read_calls(tmp_path) == []

    def test_build_returns_none_without_calls(self, tmp_path):
        assert SequenceDiagramBuilder().build(tmp_path) is None

    def test_build_for_entry_unknown(self, tmp_path):
        calls = "# caller_file\tcaller\tcallee_file\tcallee\tline\na.py\tA.foo\tb.py\tB.bar\t1\n"
        (tmp_path / "_calls.txt").write_text(calls)
        assert SequenceDiagramBuilder().build_for_entry(tmp_path, "nonexistent") is None

    def test_merge_empty_base(self):
        registry = ProviderRegistry()
        result = registry._merge_results({}, {"a.py": StructuralAnalysis(file_path="a.py", language="Python")})
        assert "a.py" in result

    def test_merge_empty_additions(self):
        registry = ProviderRegistry()
        base = {"a.py": StructuralAnalysis(file_path="a.py", language="Python")}
        assert registry._merge_results(base, {}) == base

    def test_cycle_detection(self, tmp_path):
        """Cycles don't cause infinite recursion."""
        calls = "# caller_file\tcaller\tcallee_file\tcallee\tline\na.py\tA.foo\tb.py\tB.bar\t1\nb.py\tB.bar\ta.py\tA.foo\t2\n"
        (tmp_path / "_calls.txt").write_text(calls)
        model = SequenceDiagramBuilder(max_depth=10).build(tmp_path)
        assert model is not None

    def test_max_depth_limiting(self, tmp_path):
        lines = ["# caller_file\tcaller\tcallee_file\tcallee\tline"]
        for i in range(20):
            lines.append(f"f{i}.py\tC{i}.m\tf{i+1}.py\tC{i+1}.m\t{i}")
        (tmp_path / "_calls.txt").write_text("\n".join(lines) + "\n")
        model = SequenceDiagramBuilder(max_depth=3).build(tmp_path)
        assert model is not None and len(model.entities) <= 5
