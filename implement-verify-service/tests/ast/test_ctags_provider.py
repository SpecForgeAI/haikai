import shutil
import pytest
from src.ast.ctags_provider import CtagsProvider
from src.ast.models import SymbolKind


@pytest.fixture
def provider():
    return CtagsProvider()


skip_if_no_ctags = pytest.mark.skipif(
    not shutil.which("ctags"),
    reason="ctags not installed"
)


# ── Mapping layer tests (NO ctags binary needed) ──

class TestKindMapping:
    """Test the mapping layer in isolation. These are pure unit tests
    that validate our contract boundary with ctags."""

    def test_member_maps_to_method(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "get_user", "kind": "member", "line": 10})
        assert sym.kind == SymbolKind.METHOD

    def test_function_maps_to_function(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "main", "kind": "function", "line": 1})
        assert sym.kind == SymbolKind.FUNCTION

    def test_unknown_kind_maps_to_unknown(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "x", "kind": "somethingnew", "line": 1})
        assert sym.kind == SymbolKind.UNKNOWN

    def test_field_maps_to_variable(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "count", "kind": "field", "line": 5})
        assert sym.kind == SymbolKind.VARIABLE

    def test_class_maps_to_class(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "Foo", "kind": "class", "line": 1})
        assert sym.kind == SymbolKind.CLASS


# ── Integration tests (need ctags binary) ──

class TestBatchAnalyze:
    """Test the batch API — the only public analysis method."""

    @skip_if_no_ctags
    def test_batch_single_file(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        assert "tests/fixtures/sample_python.py" in results
        result = results["tests/fixtures/sample_python.py"]
        assert result.provider_used == "ctags"

    @skip_if_no_ctags
    def test_batch_multiple_files(self, provider):
        results = provider.analyze_batch([
            "tests/fixtures/sample_python.py",
            "src/ast/models.py",
        ])
        assert len(results) >= 1

    @skip_if_no_ctags
    def test_batch_finds_expected_symbols(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        names = [s.name for s in result.symbols]
        assert "BaseService" in names
        assert "UserService" in names
        assert "get_user" in names
        assert "save_user" in names
        assert "standalone_function" in names

    def test_batch_empty_list(self, provider):
        results = provider.analyze_batch([])
        assert results == {}


class TestContractCompliance:
    """All symbols must use our canonical kinds, not ctags labels."""

    @skip_if_no_ctags
    def test_all_kinds_are_canonical(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        for symbol in result.symbols:
            assert symbol.kind in SymbolKind.ALL, (
                f"Symbol '{symbol.name}' has non-canonical kind '{symbol.kind}'. "
                f"CtagsProvider must map this to a SymbolKind value."
            )

    @skip_if_no_ctags
    def test_classes_are_classes(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        user_service = next(s for s in result.symbols if s.name == "UserService")
        assert user_service.kind == SymbolKind.CLASS

    @skip_if_no_ctags
    def test_methods_are_methods(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        get_user = next(s for s in result.symbols if s.name == "get_user")
        assert get_user.kind == SymbolKind.METHOD
        assert get_user.scope is not None

    @skip_if_no_ctags
    def test_standalone_functions(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        func = next(s for s in result.symbols if s.name == "standalone_function")
        assert func.kind == SymbolKind.FUNCTION

    @skip_if_no_ctags
    def test_inheritance_detected(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        user_service = next(s for s in result.symbols if s.name == "UserService")
        assert "BaseService" in (user_service.inherits or "")


class TestAvailability:
    @skip_if_no_ctags
    def test_is_available(self, provider):
        assert provider.is_available() is True

    def test_unavailable_when_no_binary(self, monkeypatch):
        monkeypatch.setattr("shutil.which", lambda x: None)
        provider = CtagsProvider()
        assert provider.is_available() is False
