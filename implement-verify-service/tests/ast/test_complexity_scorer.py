"""Tests for complexity scoring and triage."""
import pytest
from src.ast.complexity_scorer import score_complexity, triage, _is_trivial
from src.ast.models import (
    StructuralAnalysis, SymbolInfo, SymbolKind,
    InheritanceInfo, ImportInfo, CallInfo,
)


def _trivial_analysis(file_path="trivial.py"):
    """A trivial file: 2 constants, no calls, no inheritance."""
    return StructuralAnalysis(
        file_path=file_path, language="python",
        symbols=[
            SymbolInfo(name="VERSION", kind=SymbolKind.VARIABLE, line_start=1, line_end=1),
            SymbolInfo(name="DEBUG", kind=SymbolKind.VARIABLE, line_start=2, line_end=2),
        ],
    )


def _complex_analysis(file_path="complex.py"):
    """A complex file: class with methods, inheritance, calls, imports."""
    return StructuralAnalysis(
        file_path=file_path, language="python",
        symbols=[
            SymbolInfo(name="UserService", kind=SymbolKind.CLASS, line_start=1, line_end=50),
            SymbolInfo(name="__init__", kind=SymbolKind.METHOD, scope="UserService", line_start=5, line_end=10),
            SymbolInfo(name="get_user", kind=SymbolKind.METHOD, scope="UserService", line_start=12, line_end=20),
            SymbolInfo(name="save_user", kind=SymbolKind.METHOD, scope="UserService", line_start=22, line_end=30),
            SymbolInfo(name="delete_user", kind=SymbolKind.METHOD, scope="UserService", line_start=32, line_end=40),
            SymbolInfo(name="list_users", kind=SymbolKind.METHOD, scope="UserService", line_start=42, line_end=50),
            SymbolInfo(name="OrderService", kind=SymbolKind.CLASS, line_start=52, line_end=80),
            SymbolInfo(name="process", kind=SymbolKind.METHOD, scope="OrderService", line_start=55, line_end=70),
        ],
        inheritance=[
            InheritanceInfo(class_name="UserService", bases=["BaseService", "Cacheable"]),
            InheritanceInfo(class_name="OrderService", bases=["BaseService"]),
        ],
        imports=[
            ImportInfo(module="sqlalchemy", names=["Session"]),
            ImportInfo(module="fastapi", names=["APIRouter"]),
            ImportInfo(module="pydantic", names=["BaseModel"]),
            ImportInfo(module="logging", names=[]),
            ImportInfo(module="typing", names=["Optional"]),
        ],
        calls=[
            CallInfo(caller_file="complex.py", caller_name="UserService.get_user",
                     callee_file="db.py", callee_name="Database.query", line=15),
            CallInfo(caller_file="complex.py", caller_name="UserService.save_user",
                     callee_file="db.py", callee_name="Database.execute", line=25),
            CallInfo(caller_file="complex.py", caller_name="UserService.delete_user",
                     callee_file="db.py", callee_name="Database.execute", line=35),
            CallInfo(caller_file="complex.py", caller_name="UserService.list_users",
                     callee_file="db.py", callee_name="Database.query", line=45),
            CallInfo(caller_file="complex.py", caller_name="OrderService.process",
                     callee_file="complex.py", callee_name="UserService.get_user", line=60),
        ] + [
            CallInfo(caller_file="complex.py", caller_name=f"f{i}",
                     callee_file="-", callee_name=f"g{i}", line=i)
            for i in range(10)
        ],
    )


class TestComplexityScoring:
    def test_trivial_file_low_score(self):
        score = score_complexity(_trivial_analysis())
        assert score < 0.3, f"Trivial file scored {score}, expected < 0.3"

    def test_complex_file_high_score(self):
        score = score_complexity(_complex_analysis())
        assert score > 0.5, f"Complex file scored {score}, expected > 0.5"

    def test_empty_file_zero(self):
        analysis = StructuralAnalysis(file_path="empty.py", language="python", symbols=[])
        assert score_complexity(analysis) == 0.0

    def test_score_range(self):
        """Score must be between 0.0 and 1.0."""
        for analysis in [_trivial_analysis(), _complex_analysis()]:
            score = score_complexity(analysis)
            assert 0.0 <= score <= 1.0

    def test_more_calls_increases_score(self):
        """Files with more calls should score higher."""
        few_calls = StructuralAnalysis(
            file_path="a.py", language="python",
            symbols=[SymbolInfo(name="f", kind=SymbolKind.FUNCTION, line_start=1, line_end=5)],
            calls=[CallInfo("a.py", "f", "-", "g", 2)],
        )
        many_calls = StructuralAnalysis(
            file_path="b.py", language="python",
            symbols=[SymbolInfo(name="f", kind=SymbolKind.FUNCTION, line_start=1, line_end=5)],
            calls=[CallInfo("b.py", "f", "-", f"g{i}", i) for i in range(20)],
        )
        assert score_complexity(many_calls) > score_complexity(few_calls)


class TestTriage:
    def test_trivial_files_skipped(self):
        results = {
            "trivial.py": _trivial_analysis("trivial.py"),
            "complex.py": _complex_analysis("complex.py"),
        }
        skip, analyze = triage(results, threshold=0.3)
        assert "trivial.py" in skip
        assert "complex.py" in analyze

    def test_init_file_always_skipped(self):
        init = StructuralAnalysis(
            file_path="__init__.py", language="python",
            symbols=[SymbolInfo(name="__all__", kind=SymbolKind.VARIABLE, line_start=1, line_end=1)],
        )
        results = {"__init__.py": init}
        skip, analyze = triage(results)
        assert "__init__.py" in skip

    def test_constants_file_always_skipped(self):
        constants = StructuralAnalysis(
            file_path="constants.py", language="python",
            symbols=[
                SymbolInfo(name="MAX", kind=SymbolKind.CONSTANT, line_start=1, line_end=1),
                SymbolInfo(name="MIN", kind=SymbolKind.CONSTANT, line_start=2, line_end=2),
                SymbolInfo(name="DEFAULT", kind=SymbolKind.CONSTANT, line_start=3, line_end=3),
            ],
        )
        results = {"constants.py": constants}
        skip, analyze = triage(results)
        assert "constants.py" in skip

    def test_threshold_respected(self):
        """Higher threshold = more files skipped."""
        results = {
            "a.py": _trivial_analysis("a.py"),
            "b.py": _complex_analysis("b.py"),
        }
        _, analyze_low = triage(results, threshold=0.1)
        _, analyze_high = triage(results, threshold=0.9)
        assert len(analyze_low) >= len(analyze_high)


class TestTriageIntegration:
    def test_triage_on_real_repo(self):
        """Run triage on this repo's actual source files."""
        from pathlib import Path
        from src.ast.ctags_provider import CtagsProvider
        from src.ast.treesitter_provider import TreeSitterProvider
        from src.ast.provider import ProviderRegistry

        src_files = sorted(str(f) for f in Path("src").rglob("*.py") if "__pycache__" not in str(f))[:30]
        if not src_files:
            return

        ctags = CtagsProvider()
        ts = TreeSitterProvider()
        registry = ProviderRegistry()

        ctags_results = ctags.analyze_batch(src_files)
        ts_results = ts.analyze_batch(src_files)
        merged = registry._merge_results(ctags_results, ts_results)

        skip, analyze = triage(merged, threshold=0.3)

        # Some files should be skipped, some analyzed
        assert len(skip) > 0, "Expected some trivial files to be skipped"
        assert len(analyze) > 0, "Expected some complex files to be analyzed"
        # file_analyzer.py should be in analyze (it's complex)
        analyze_names = [Path(f).name for f in analyze]
        assert "file_analyzer.py" in analyze_names or len(analyze) > 5, \
            f"Expected file_analyzer.py in analyzed files, got: {analyze_names}"
