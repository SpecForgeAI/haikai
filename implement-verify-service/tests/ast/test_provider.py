from src.ast.provider import AnalysisProvider, ProviderRegistry
from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind


class MockProvider(AnalysisProvider):
    """Mock provider for testing registry behavior."""

    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        return {
            fp: StructuralAnalysis(
                file_path=fp, language="python", provider_used="mock",
                symbols=[SymbolInfo(name="MockClass", kind=SymbolKind.CLASS, line_start=1, line_end=10)]
            )
            for fp in file_paths
        }

    def is_available(self) -> bool:
        return True

    @property
    def name(self) -> str:
        return "mock"


class UnavailableProvider(AnalysisProvider):
    def analyze_batch(self, file_paths): return {}
    def is_available(self): return False
    @property
    def name(self): return "unavailable"


def test_registry_batch_returns_results():
    registry = ProviderRegistry()
    registry.register(MockProvider())
    results = registry.analyze_batch(["test.py", "test2.py"])
    assert "test.py" in results
    assert "test2.py" in results
    assert results["test.py"].provider_used == "mock"


def test_registry_single_file_via_batch():
    """Single file goes through batch API — no separate analyze() method."""
    registry = ProviderRegistry()
    registry.register(MockProvider())
    results = registry.analyze_batch(["test.py"])
    assert len(results) == 1
    assert results["test.py"].provider_used == "mock"


def test_registry_returns_empty_when_no_providers():
    registry = ProviderRegistry()
    results = registry.analyze_batch(["test.py"])
    assert results == {}


def test_registry_skips_unavailable_provider():
    registry = ProviderRegistry()
    registry.register(UnavailableProvider())
    results = registry.analyze_batch(["test.py"])
    assert results == {}


def test_env_var_disables_provider(monkeypatch):
    monkeypatch.setenv("AST_CTAGS_ENABLED", "false")
    registry = ProviderRegistry()
    assert registry.is_provider_enabled("ctags") is False


def test_env_var_enables_provider(monkeypatch):
    monkeypatch.setenv("AST_CTAGS_ENABLED", "true")
    registry = ProviderRegistry()
    assert registry.is_provider_enabled("ctags") is True
