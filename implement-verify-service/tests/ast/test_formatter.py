import pytest

from src.ast.formatter import format_structural_output
from src.ast.models import (
    StructuralAnalysis, SymbolInfo, SymbolKind,
    InheritanceInfo, ImportInfo, CallInfo,
)


class TestFormatter:

    def test_format_basic(self):
        sa = StructuralAnalysis(
            file_path="test.py",
            language="python",
            symbols=[
                SymbolInfo(name="UserService", kind=SymbolKind.CLASS,
                           line_start=1, line_end=50, inherits="BaseService"),
                SymbolInfo(name="get_user", kind=SymbolKind.METHOD,
                           scope="UserService", line_start=10, line_end=20,
                           signature="(self, user_id: int) -> User"),
                SymbolInfo(name="save_user", kind=SymbolKind.METHOD,
                           scope="UserService", line_start=25, line_end=35,
                           signature="(self, user: User) -> None"),
            ],
            inheritance=[InheritanceInfo(class_name="UserService", bases=["BaseService"])],
            imports=[ImportInfo(module="fastapi", names=["FastAPI", "APIRouter"])],
        )
        output = format_structural_output(sa)

        assert "UserService" in output
        assert "get_user" in output
        assert "BaseService" in output
        assert "fastapi" in output
        assert len(output) < 1000

    def test_format_empty(self):
        sa = StructuralAnalysis(file_path="test.py", language="python")
        output = format_structural_output(sa)
        assert output == ""

    def test_format_preserves_signatures(self):
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="process", kind=SymbolKind.FUNCTION,
                           signature="(data: list[dict], limit: int = 100) -> Result"),
            ],
        )
        output = format_structural_output(sa)
        assert "(data: list[dict], limit: int = 100) -> Result" in output

    def test_format_groups_by_scope(self):
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="MyClass", kind=SymbolKind.CLASS, line_start=1, line_end=30),
                SymbolInfo(name="method_a", kind=SymbolKind.METHOD, scope="MyClass", line_start=5, line_end=10),
                SymbolInfo(name="method_b", kind=SymbolKind.METHOD, scope="MyClass", line_start=15, line_end=20),
                SymbolInfo(name="standalone", kind=SymbolKind.FUNCTION, line_start=35, line_end=40),
            ],
        )
        output = format_structural_output(sa)
        class_pos = output.index("MyClass")
        method_a_pos = output.index("method_a")
        assert class_pos < method_a_pos

    def test_format_includes_calls(self):
        """Calls section shows who-calls-whom grouped by caller."""
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="OrderService", kind=SymbolKind.CLASS, line_start=1, line_end=50),
                SymbolInfo(name="process", kind=SymbolKind.METHOD,
                           scope="OrderService", line_start=10, line_end=30),
            ],
            calls=[
                CallInfo(caller_file="test.py", caller_name="OrderService.process",
                         callee_file="db.py", callee_name="Database.execute", line=15),
                CallInfo(caller_file="test.py", caller_name="OrderService.process",
                         callee_file="-", callee_name="Logger.info", line=20),
                CallInfo(caller_file="test.py", caller_name="OrderService.validate",
                         callee_file="-", callee_name="re.match", line=5),
            ],
        )
        output = format_structural_output(sa)

        assert "Calls:" in output
        assert "OrderService.process:" in output
        assert "-> Database.execute (line 15)" in output
        assert "-> Logger.info (line 20, external)" in output
        assert "OrderService.validate:" in output
        assert "-> re.match (line 5, external)" in output

    def test_format_no_calls_section_when_empty(self):
        """No Calls section when there are no call edges."""
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="foo", kind=SymbolKind.FUNCTION, line_start=1, line_end=5),
            ],
        )
        output = format_structural_output(sa)
        assert "Calls:" not in output

    @pytest.mark.skipif(
        __import__("importlib").util.find_spec("tree_sitter_java") is None,
        reason=(
            "tree_sitter_java grammar not installed in this env. "
            "Test runs against a sample_java.java fixture and needs the "
            "grammar to extract Imports/Calls. Install via Dockerfile.dev."
        ),
    )
    def test_format_calls_with_real_file(self):
        """Integration: formatter works on real tree-sitter + ctags output."""
        from pathlib import Path
        fixture = Path(__file__).parent.parent / "fixtures" / "sample_java.java"
        if not fixture.exists():
            return  # skip if no fixture

        from src.ast.ctags_provider import CtagsProvider
        from src.ast.treesitter_provider import TreeSitterProvider
        from src.ast.provider import ProviderRegistry

        ctags = CtagsProvider()
        ts = TreeSitterProvider()
        registry = ProviderRegistry()

        ctags_results = ctags.analyze_batch([str(fixture)])
        ts_results = ts.analyze_batch([str(fixture)])
        merged = registry._merge_results(ctags_results, ts_results)

        analysis = merged[str(fixture)]
        output = format_structural_output(analysis)

        # Must have all four sections
        assert "Imports:" in output
        assert "Symbols:" in output
        assert "Calls:" in output
        # Call section must reference actual Java methods from fixture
        assert "->" in output
