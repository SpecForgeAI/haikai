"""Unit tests for tree-sitter edge cases NOT covered by integration tests.

Integration coverage (test_treesitter_integration.py on real src/ast/*.py):
- Call extraction: method calls, bare functions, constructors, chained, nested,
  class method scoping, function scoping, super calls, line numbers, fixture files
- Import extraction: import statements, from imports, multiple names, relative imports
- Assignment tracking: self.attr = Constructor() patterns, multiple assignments
- Type annotations: parameter annotations
- Resolution pipeline: assignment (0.95), annotation (0.90), import (0.85),
  ctags single (0.70), ctags same-dir bonus (0.80), convention snake_to_pascal (0.30),
  unresolved fallback (0.20), self-call (0.95), self.attr not self-call, short-circuit
- Provider: is_available, name, analyze_batch, skips non-python, empty input
"""
import pytest
from src.ast.extractors.python import PythonExtractor as CallExtractor


class TestEdgeCasesNotInRealCode:
    """Cases that can't be triggered by analyzing real src/ast/*.py files."""

    @pytest.fixture
    def extractor(self):
        return CallExtractor()

    def test_enclosing_scope_top_level(self, extractor):
        """Module-level calls → caller is '<module>'. No module-level calls in src/ast/."""
        source = b"print('hello')\n"
        calls = extractor.extract_calls(source, "a.py")
        assert len(calls) == 1
        assert calls[0].caller_name == "<module>"

    def test_local_var_not_tracked(self, extractor):
        """Only self.x assignments tracked — negative test (can't prove from real code)."""
        source = b"class A:\n    def f(self):\n        db = Database()\n"
        assignments = extractor.extract_assignments(source)
        assert "A.db" not in assignments

    def test_factory_call_not_resolved(self, extractor):
        """self.db = get_db() is NOT resolved — negative test."""
        source = b"class A:\n    def __init__(self):\n        self.db = get_db()\n"
        assignments = extractor.extract_assignments(source)
        assert "A.db" not in assignments

    def test_skips_self_param(self, extractor):
        """'self' parameter annotations are skipped — negative test."""
        source = b"class A:\n    def f(self, x: int):\n        pass\n"
        annotations = extractor.extract_annotations(source)
        assert "A.self" not in annotations

    def test_ctags_ambiguous_confidence(self):
        """Ambiguous ctags match → 0.40 confidence. Hard to guarantee on real code."""
        from src.ast.treesitter_resolver import CallResolver
        from src.ast.treesitter_models import RawCallSite, ResolutionContext
        resolver = CallResolver()
        call = RawCallSite("src/api.py", "App.handle", "self.svc", "process", 20)
        ctx = ResolutionContext(symbol_index={"process": [
            ("ServiceA", "lib/a.py"), ("ServiceB", "lib/b.py"),
        ]})
        result = resolver.resolve(call, ctx)
        assert result.confidence == 0.40
