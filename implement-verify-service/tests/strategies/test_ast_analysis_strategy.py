"""Tests for AstAnalysisStrategy — structural data to LLM, not raw code."""
import json
import pytest
from unittest.mock import MagicMock

from src.strategies.ast_analysis_strategy import AstAnalysisStrategy
from src.ast.models import (
    StructuralAnalysis, SymbolInfo, SymbolKind,
    InheritanceInfo, ImportInfo, CallInfo,
)


def _make_results() -> dict[str, StructuralAnalysis]:
    """Build realistic structural results for testing."""
    return {
        "src/service.py": StructuralAnalysis(
            file_path="src/service.py", language="python",
            symbols=[
                SymbolInfo(name="UserService", kind=SymbolKind.CLASS, line_start=1, line_end=50),
                SymbolInfo(name="__init__", kind=SymbolKind.METHOD, scope="UserService", line_start=5, line_end=10),
                SymbolInfo(name="get_user", kind=SymbolKind.METHOD, scope="UserService", line_start=12, line_end=20),
                SymbolInfo(name="save_user", kind=SymbolKind.METHOD, scope="UserService", line_start=22, line_end=30),
                SymbolInfo(name="delete_user", kind=SymbolKind.METHOD, scope="UserService", line_start=32, line_end=40),
            ],
            inheritance=[InheritanceInfo(class_name="UserService", bases=["BaseService"])],
            imports=[
                ImportInfo(module="fastapi", names=["APIRouter"]),
                ImportInfo(module="sqlalchemy", names=["Session"]),
                ImportInfo(module="pydantic", names=["BaseModel"]),
            ],
            calls=[
                CallInfo("src/service.py", "UserService.get_user", "db.py", "Database.query", 15),
                CallInfo("src/service.py", "UserService.save_user", "db.py", "Database.execute", 25),
                CallInfo("src/service.py", "UserService.delete_user", "db.py", "Database.execute", 35),
                CallInfo("src/service.py", "UserService.__init__", "-", "BaseService.__init__", 6),
                CallInfo("src/service.py", "UserService.get_user", "-", "Logger.info", 16),
                CallInfo("src/service.py", "UserService.save_user", "-", "Logger.info", 26),
                CallInfo("src/service.py", "UserService.delete_user", "-", "Logger.warning", 36),
                CallInfo("src/service.py", "UserService.get_user", "-", "validate_id", 14),
                CallInfo("src/service.py", "UserService.save_user", "-", "validate_user", 23),
                CallInfo("src/service.py", "UserService.delete_user", "-", "audit_log", 37),
            ],
        ),
        "src/models.py": StructuralAnalysis(
            file_path="src/models.py", language="python",
            symbols=[
                SymbolInfo(name="User", kind=SymbolKind.CLASS, line_start=1, line_end=10),
                SymbolInfo(name="name", kind=SymbolKind.VARIABLE, scope="User", line_start=3, line_end=3),
            ],
            imports=[ImportInfo(module="pydantic", names=["BaseModel"])],
        ),
        "src/__init__.py": StructuralAnalysis(
            file_path="src/__init__.py", language="python", symbols=[],
        ),
    }


class TestDeterministicSections:
    """Test pure structural analysis — no LLM needed."""

    def test_builds_sections(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        results = _make_results()
        sections = strategy.build_deterministic_sections(results)

        assert sections["total_symbols"] == 7
        assert sections["total_calls"] == 10
        assert sections["total_imports"] == 4
        assert sections["inheritance_count"] == 1

    def test_top_imports(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        sections = strategy.build_deterministic_sections(_make_results())
        import_mods = [mod for mod, _ in sections["top_imports"]]
        assert "pydantic" in import_mods
        assert "fastapi" in import_mods

    def test_call_hotspots(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        sections = strategy.build_deterministic_sections(_make_results())
        callee_names = [c for c, _ in sections["top_callees"]]
        assert "Database.execute" in callee_names
        assert "Database.query" in callee_names

    def test_baseline_practices(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        sections = strategy.build_deterministic_sections(_make_results())
        assert isinstance(sections["baseline_practices"], list)


class TestDeterministicSynthesis:
    """Test full deterministic document generation — zero LLM calls."""

    def test_generates_markdown(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        results = _make_results()
        strategy.build_context_from_structural(results)
        doc = strategy.synthesize_deterministic(results)

        assert "# Structural Analysis Standards" in doc
        assert "## Overview" in doc
        assert "## Languages" in doc
        assert "## Frameworks" in doc
        assert "## Dependency Graph" in doc
        assert "## Call Graph Hotspots" in doc
        assert "## Triage Summary" in doc

    def test_no_llm_calls(self):
        """Deterministic mode must never call LLM."""
        strategy = AstAnalysisStrategy(deterministic_only=True)
        results = _make_results()
        strategy.build_context_from_structural(results)
        doc = strategy.synthesize_deterministic(results)
        # llm_client is None — if it were called, it would raise
        assert strategy.llm_client is None
        assert len(doc) > 100

    def test_frameworks_detected(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        results = _make_results()
        strategy.build_context_from_structural(results)
        doc = strategy.synthesize_deterministic(results)
        assert "FastAPI" in doc or "Pydantic" in doc or "SQLAlchemy" in doc

    def test_triage_in_output(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        results = _make_results()
        strategy.build_context_from_structural(results)
        doc = strategy.synthesize_deterministic(results)
        assert "Trivial files (SKIP)" in doc
        assert "Complex files (ANALYZE)" in doc


class TestContextBuilding:
    """Test context building from structural data."""

    def test_deterministic_context(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        ctx = strategy.build_context_from_structural(_make_results())

        assert ctx.standard_name == "structural_analysis"
        assert "python" in ctx.languages
        assert len(ctx.frameworks) > 0

    def test_llm_context_with_mock(self):
        mock_llm = MagicMock()
        mock_llm.generate.return_value = json.dumps({
            "tech_stack": "Python web backend",
            "languages": ["python"],
            "frameworks": ["FastAPI"],
            "baseline_practices": ["Async handlers"],
            "distinctive_patterns_to_look_for": ["Repository pattern"],
            "filtering_guidance": "Focus on services",
        })

        strategy = AstAnalysisStrategy(
            llm_client=mock_llm, content_extractor=None
        )
        ctx = strategy.build_context_from_structural(_make_results())

        assert ctx.tech_stack == "Python web backend"
        assert "FastAPI" in ctx.frameworks
        mock_llm.generate.assert_called_once()

    def test_llm_failure_falls_back(self):
        mock_llm = MagicMock()
        mock_llm.generate.side_effect = Exception("LLM down")

        strategy = AstAnalysisStrategy(
            llm_client=mock_llm, content_extractor=None
        )
        ctx = strategy.build_context_from_structural(_make_results())

        # Should still produce valid context from deterministic data
        assert ctx.standard_name == "structural_analysis"
        assert len(ctx.languages) > 0


class TestExtractionPrompts:
    """Test that prompts send structural data, not raw code."""

    def test_prompts_contain_structural_content(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        strategy.build_context_from_structural(_make_results())

        structural_output = "Symbols:\n  class UserService\n    method get_user"
        system, user = strategy.get_extraction_prompts(
            "src/service.py", structural_output, False
        )

        assert "interpreting pre-parsed structural data" in system
        assert "UserService" in user
        assert "get_user" in user

    def test_prompts_never_contain_raw_code(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        strategy.build_context_from_structural(_make_results())

        structural_output = "Imports:\n  fastapi\nSymbols:\n  class UserService"
        _, user = strategy.get_extraction_prompts(
            "src/service.py", structural_output, False
        )

        # Should NOT contain Python syntax
        assert "def " not in user
        assert "import " not in user
        assert "class UserService:" not in user


class TestTriage:
    def test_init_file_skipped(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        results = _make_results()
        skip, analyze = strategy.triage_files(results)

        skip_names = [f.split("/")[-1] for f in skip]
        assert "__init__.py" in skip_names

    def test_complex_file_analyzed(self):
        strategy = AstAnalysisStrategy(deterministic_only=True)
        results = _make_results()
        skip, analyze = strategy.triage_files(results)

        analyze_names = [f.split("/")[-1] for f in analyze]
        assert "service.py" in analyze_names


class TestIntegration:
    """Integration test on real repo files."""

    def test_deterministic_on_real_repo(self):
        from pathlib import Path
        from src.ast.ctags_provider import CtagsProvider
        from src.ast.treesitter_provider import TreeSitterProvider
        from src.ast.provider import ProviderRegistry

        src_files = sorted(
            str(f) for f in Path("src").rglob("*.py")
            if "__pycache__" not in str(f)
        )[:20]
        if not src_files:
            return

        ctags = CtagsProvider()
        ts = TreeSitterProvider()
        registry = ProviderRegistry()

        ctags_results = ctags.analyze_batch(src_files)
        ts_results = ts.analyze_batch(src_files)
        merged = registry._merge_results(ctags_results, ts_results)

        strategy = AstAnalysisStrategy(deterministic_only=True)
        strategy.build_context_from_structural(merged)
        doc = strategy.synthesize_deterministic(merged)

        assert "# Structural Analysis Standards" in doc
        assert "python" in doc.lower()
        assert len(doc) > 500

        # Triage should have results
        skip, analyze = strategy.triage_files(merged)
        assert len(skip) + len(analyze) == len(merged)
