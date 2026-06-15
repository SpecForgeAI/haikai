"""Parametrized integration tests for all tree-sitter language extractors.

Auto-discovers languages from treesitter_languages.yaml. Adding a new
language to the config + dropping a fixture file = tests run automatically.
No manual test updates needed.
"""

from pathlib import Path

import pytest

from src.ast.treesitter_config import load_extractors

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
REPO_ROOT = Path(__file__).parent.parent.parent

# Fixture file convention: sample_<language>.<ext>
# Falls back to real source files in the repo if no fixture exists
FIXTURE_OVERRIDES = {
    ".py": REPO_ROOT / "src" / "ast" / "treesitter_provider.py",
}


def _discover_languages():
    """Build (language_name, extractor, fixture_path) from YAML config.

    Groups extensions by extractor class (so .cpp/.cc/.hpp share one entry).
    Finds fixture files by convention: sample_*.<ext> in fixtures dir.
    """
    ext_map = load_extractors()
    # Group by extractor instance (dedupe across extensions)
    seen_classes = {}
    for ext_str, extractor in ext_map.items():
        cls_name = type(extractor).__name__
        if cls_name not in seen_classes:
            seen_classes[cls_name] = (extractor, ext_str)

    languages = []
    for cls_name, (extractor, sample_ext) in seen_classes.items():
        # Derive language name from class: PythonExtractor → python
        lang_name = cls_name.replace("Extractor", "").lower()

        # Find a fixture file
        fixture = _find_fixture(sample_ext, extractor.file_extensions)
        if fixture is None:
            pytest.skip(f"No fixture for {lang_name} (extensions: {extractor.file_extensions})")
            continue

        languages.append(pytest.param(
            (lang_name, extractor, fixture),
            id=lang_name,
        ))

    return languages


def _find_fixture(primary_ext: str, all_exts: list[str]) -> Path | None:
    """Find a fixture file for the given extensions."""
    # Check overrides first
    for ext in all_exts:
        if ext in FIXTURE_OVERRIDES:
            override = FIXTURE_OVERRIDES[ext]
            if override.exists():
                return override

    # Search fixtures dir for sample_*.<ext>
    for ext in all_exts:
        for path in FIXTURES_DIR.glob(f"sample_*{ext}"):
            return path

    return None


# Auto-discover at collection time
LANGUAGE_PARAMS = _discover_languages()


@pytest.fixture(params=LANGUAGE_PARAMS)
def lang(request):
    """Yield (name, extractor, source_bytes, file_path) for each configured language."""
    name, extractor, fixture_path = request.param
    source = fixture_path.read_bytes()
    rel_path = fixture_path.name
    return name, extractor, source, rel_path


# ============================================================
# Core tests — run for every configured language
# ============================================================

class TestExtractorInterface:
    """Every configured extractor must satisfy the LanguageExtractor contract."""

    def test_extract_calls_returns_results(self, lang):
        name, ext, source, path = lang
        calls = ext.extract_calls(source, path)
        assert isinstance(calls, list)
        assert len(calls) > 0, f"{name}: should find at least one call"

    def test_calls_have_line_numbers(self, lang):
        name, ext, source, path = lang
        for c in ext.extract_calls(source, path):
            assert c.line > 0, f"{name}: call {c.method} has no line number"

    def test_calls_have_method_names(self, lang):
        name, ext, source, path = lang
        for c in ext.extract_calls(source, path):
            assert c.method, f"{name}: call at line {c.line} has empty method"

    def test_calls_have_caller_scope(self, lang):
        name, ext, source, path = lang
        for c in ext.extract_calls(source, path):
            assert c.caller_name, f"{name}: call {c.method} has empty caller"

    def test_extract_imports_returns_tuples(self, lang):
        name, ext, source, path = lang
        imports = ext.extract_imports(source)
        assert isinstance(imports, list)
        assert len(imports) > 0, f"{name}: should find at least one import"
        for module, names, is_relative in imports:
            assert isinstance(module, str)
            assert isinstance(names, list)
            assert isinstance(is_relative, bool)

    def test_extract_assignments_returns_dict(self, lang):
        name, ext, source, path = lang
        assert isinstance(ext.extract_assignments(source), dict)

    def test_extract_annotations_returns_dict(self, lang):
        name, ext, source, path = lang
        assert isinstance(ext.extract_annotations(source), dict)

    def test_file_extensions_not_empty(self, lang):
        _, ext, _, _ = lang
        assert len(ext.file_extensions) > 0

    def test_grammar_loaded(self, lang):
        _, ext, _, _ = lang
        assert ext.grammar is not None

    def test_empty_source_no_crash(self, lang):
        name, ext, _, path = lang
        assert ext.extract_calls(b"", path) == []
        assert ext.extract_imports(b"") == []
        assert ext.extract_assignments(b"") == {}
        assert ext.extract_annotations(b"") == {}


# ============================================================
# Language-specific tests — only where behavior genuinely differs
# ============================================================

class TestJavaSpecific:
    def test_wildcard_import(self):
        ext_map = load_extractors()
        ext = ext_map.get(".java")
        if not ext:
            pytest.skip("Java not configured")
        source = (FIXTURES_DIR / "sample_java.java").read_bytes()
        wildcard = [imp for imp in ext.extract_imports(source) if "*" in imp[1]]
        assert len(wildcard) >= 1

    def test_constructor_calls(self):
        ext = load_extractors().get(".java")
        if not ext:
            pytest.skip("Java not configured")
        calls = ext.extract_calls((FIXTURES_DIR / "sample_java.java").read_bytes(), "x.java")
        assert any(c.method.startswith("new ") for c in calls)


class TestCSharpSpecific:
    def test_var_inference(self):
        ext = load_extractors().get(".cs")
        if not ext:
            pytest.skip("C# not configured")
        assignments = ext.extract_assignments((FIXTURES_DIR / "sample_csharp.cs").read_bytes())
        assert any(v == "UserValidator" for v in assignments.values())


class TestCSpecific:
    def test_include_relative_flag(self):
        ext = load_extractors().get(".c")
        if not ext:
            pytest.skip("C not configured")
        imports = ext.extract_imports((FIXTURES_DIR / "sample_c.c").read_bytes())
        by_path = {imp[0]: imp for imp in imports}
        assert by_path["stdio.h"][2] is False
        assert by_path["mylib.h"][2] is True

    def test_pointer_member_calls(self):
        ext = load_extractors().get(".c")
        if not ext:
            pytest.skip("C not configured")
        calls = ext.extract_calls((FIXTURES_DIR / "sample_c.c").read_bytes(), "x.c")
        assert sum(1 for c in calls if c.receiver and "handler" in c.receiver) >= 2


class TestRustSpecific:
    def test_nested_use_tree(self):
        ext = load_extractors().get(".rs")
        if not ext:
            pytest.skip("Rust not configured")
        imports = ext.extract_imports((FIXTURES_DIR / "sample_rust.rs").read_bytes())
        all_names = [n for imp in imports for n in imp[1]]
        assert "Read" in all_names and "Write" in all_names

    def test_macro_calls(self):
        ext = load_extractors().get(".rs")
        if not ext:
            pytest.skip("Rust not configured")
        calls = ext.extract_calls((FIXTURES_DIR / "sample_rust.rs").read_bytes(), "x.rs")
        assert any(c.method.endswith("!") for c in calls)

    def test_impl_scope(self):
        ext = load_extractors().get(".rs")
        if not ext:
            pytest.skip("Rust not configured")
        calls = ext.extract_calls((FIXTURES_DIR / "sample_rust.rs").read_bytes(), "x.rs")
        assert any("Database" in c.caller_name for c in calls)


class TestCppSpecific:
    def test_ifdef_guarded_includes(self):
        ext = load_extractors().get(".hpp")
        if not ext:
            pytest.skip("C++ not configured")
        imports = ext.extract_imports((FIXTURES_DIR / "sample_cpp.hpp").read_bytes())
        paths = [imp[0] for imp in imports]
        assert "string" in paths and "vector" in paths

    def test_new_expression(self):
        ext = load_extractors().get(".cpp")
        if not ext:
            pytest.skip("C++ not configured")
        calls = ext.extract_calls((FIXTURES_DIR / "sample_cpp.cpp").read_bytes(), "x.cpp")
        assert any(c.method.startswith("new ") for c in calls)
