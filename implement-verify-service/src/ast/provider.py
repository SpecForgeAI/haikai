from abc import ABC, abstractmethod
from typing import Optional
import logging
import yaml
import os

from src.ast.models import StructuralAnalysis

logger = logging.getLogger(__name__)


class AnalysisProvider(ABC):
    """Base class for structural analysis providers.

    Public API is analyze_batch() only. Single-file analysis
    goes through analyze_batch([file]). This ensures we always
    use the efficient batch path — no accidental per-file subprocess spawning.
    """

    @abstractmethod
    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Analyze multiple files. This is the ONLY public analysis method.
        For single files, call analyze_batch([path]).
        Returns dict of file_path → StructuralAnalysis."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if provider binary/service is available."""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging and caching."""
        pass


class ProviderRegistry:
    def __init__(self, config_path: Optional[str] = None):
        self._providers: list[AnalysisProvider] = []
        self._config = self._load_config(config_path)

    def _load_config(self, config_path: Optional[str]) -> dict:
        if config_path and os.path.exists(config_path):
            with open(config_path, encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        return {
            "providers": {
                "ctags": {"enabled": os.environ.get("AST_CTAGS_ENABLED", "true").lower() == "true"},
                "lsp": {"enabled": os.environ.get("AST_LSP_ENABLED", "false").lower() == "true"},
                "llm": {"enabled": os.environ.get("AST_LLM_ENABLED", "true").lower() == "true"},
            }
        }

    def is_provider_enabled(self, provider_name: str) -> bool:
        providers = self._config.get("providers", {})
        # Default to True for providers not in config (they were explicitly registered)
        return providers.get(provider_name, {}).get("enabled", True)

    def register(self, provider: AnalysisProvider) -> None:
        self._providers.append(provider)
        logger.info(f"Registered analysis provider: {provider.name}")

    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Analyze files using all enabled providers, merging results.

        Provider order matters: earlier providers supply the baseline
        (symbols, inheritance), later providers enrich (calls, type info).
        Registration order: ctags first, LSP second.
        """
        merged: dict[str, StructuralAnalysis] = {}
        for provider in self._providers:
            if not self.is_provider_enabled(provider.name):
                continue
            if not provider.is_available():
                logger.warning(f"Provider {provider.name} not available, skipping")
                continue
            try:
                results = provider.analyze_batch(file_paths)
                if results:
                    merged = self._merge_results(merged, results)
            except Exception as e:
                logger.error(
                    f"Provider {provider.name} failed: {e}",
                    exc_info=True,
                )
                continue
        return merged

    def _merge_results(
        self,
        base: dict[str, StructuralAnalysis],
        additions: dict[str, StructuralAnalysis],
    ) -> dict[str, StructuralAnalysis]:
        """Merge analysis results. Later providers enrich, not replace.

        Rules:
        - symbols: keep base (ctags), don't duplicate
        - inheritance: keep base, don't duplicate
        - imports: keep base, don't duplicate
        - calls: EXTEND from additions (LSP provides these, ctags doesn't)
        - analysis_depth: upgrade to 'rich' if additions provide rich data
        - language_version: take from additions if base doesn't have it
        """
        if not base:
            return dict(additions)
        if not additions:
            return base

        result = dict(base)
        for file_path, addition in additions.items():
            if file_path not in result:
                result[file_path] = addition
                continue

            existing = result[file_path]
            # Extend calls from the new provider
            if addition.calls:
                existing.calls.extend(addition.calls)
            # Extend imports if base has none
            if addition.imports and not existing.imports:
                existing.imports = addition.imports
            # Extend endpoints and data movements from the new provider
            if addition.endpoints:
                existing.endpoints.extend(addition.endpoints)
            if addition.interactions:
                existing.interactions.extend(addition.interactions)
            # Upgrade depth
            if addition.analysis_depth == "rich":
                existing.analysis_depth = "rich"
            # Take language_version if we don't have it
            if addition.language_version and not existing.language_version:
                existing.language_version = addition.language_version

        return result
