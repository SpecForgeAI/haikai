"""Tests for framework detection from import patterns."""
import pytest
from src.ast.framework_detector import detect_frameworks, detect_languages, FrameworkMatch
from src.ast.models import StructuralAnalysis, ImportInfo


def _make_analysis(language: str, imports: list[str]) -> StructuralAnalysis:
    """Helper: build StructuralAnalysis with given imports."""
    return StructuralAnalysis(
        file_path="test.py",
        language=language,
        symbols=[],
        imports=[ImportInfo(module=m, names=[], is_relative=False) for m in imports],
    )


class TestFrameworkDetection:
    """Unit tests for framework detection."""

    def test_detects_fastapi(self):
        results = {
            "a.py": _make_analysis("python", ["fastapi", "fastapi.responses"]),
            "b.py": _make_analysis("python", ["fastapi"]),
        }
        matches = detect_frameworks(results)
        names = [m.name for m in matches]
        assert "FastAPI" in names

    def test_detects_django(self):
        results = {"a.py": _make_analysis("python", ["django.db", "django.http"])}
        matches = detect_frameworks(results)
        assert any(m.name == "Django" for m in matches)

    def test_detects_react(self):
        results = {"a.tsx": _make_analysis("typescript", ["react", "react-dom"])}
        matches = detect_frameworks(results)
        assert any(m.name == "React" for m in matches)

    def test_detects_spring(self):
        results = {"a.java": _make_analysis("java", ["org.springframework.boot"])}
        matches = detect_frameworks(results)
        assert any(m.name == "Spring" for m in matches)

    def test_detects_ef_core(self):
        results = {"a.cs": _make_analysis("csharp", ["Microsoft.EntityFrameworkCore"])}
        matches = detect_frameworks(results)
        assert any(m.name == "EF Core" for m in matches)

    def test_detects_multiple_frameworks(self):
        results = {
            "a.py": _make_analysis("python", ["fastapi", "sqlalchemy.orm"]),
            "b.py": _make_analysis("python", ["pydantic", "pytest"]),
        }
        matches = detect_frameworks(results)
        names = {m.name for m in matches}
        assert {"FastAPI", "SQLAlchemy", "Pydantic", "pytest"} <= names

    def test_no_frameworks(self):
        results = {"a.py": _make_analysis("python", ["os", "sys", "pathlib"])}
        matches = detect_frameworks(results)
        assert len(matches) == 0

    def test_confidence_scales_with_usage(self):
        results = {
            f"f{i}.py": _make_analysis("python", ["fastapi"])
            for i in range(10)
        }
        matches = detect_frameworks(results)
        fw = next(m for m in matches if m.name == "FastAPI")
        assert fw.confidence == 1.0
        assert fw.import_count == 10

    def test_category_assigned(self):
        results = {"a.py": _make_analysis("python", ["sqlalchemy"])}
        matches = detect_frameworks(results)
        fw = next(m for m in matches if m.name == "SQLAlchemy")
        assert fw.category == "orm"

    def test_sorted_by_import_count(self):
        results = {
            "a.py": _make_analysis("python", ["fastapi", "pydantic"]),
            "b.py": _make_analysis("python", ["fastapi"]),
        }
        matches = detect_frameworks(results)
        assert matches[0].import_count >= matches[-1].import_count


class TestFrameworkDetectionIntegration:
    """Integration test on real repo."""

    def test_detect_on_real_repo(self):
        """Run framework detection on this repo's actual source files."""
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

        matches = detect_frameworks(merged)
        names = {m.name for m in matches}

        # This repo uses FastAPI, Pydantic, SQLAlchemy
        assert "FastAPI" in names or "Pydantic" in names, f"Expected framework detection, got: {names}"


class TestLanguageDetection:
    def test_detects_languages(self):
        results = {
            "a.py": _make_analysis("python", []),
            "b.py": _make_analysis("python", []),
            "c.ts": _make_analysis("typescript", []),
        }
        langs = detect_languages(results)
        assert langs[0] == ("python", 2)
        assert langs[1] == ("typescript", 1)
