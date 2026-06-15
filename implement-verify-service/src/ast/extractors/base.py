"""Abstract base class for language-specific tree-sitter extractors.

Each language implements this interface. The TreeSitterProvider routes
files to the correct extractor based on file extension.
"""
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from src.ast.treesitter_models import RawCallSite
from src.ast.models import EndpointInfo, InteractionInfo


class LanguageExtractor(ABC):
    """Per-language AST walking. Implementations know about tree-sitter node types."""

    @abstractmethod
    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        """Extract all call sites from source."""
        pass

    @abstractmethod
    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract imports. Returns [(module, [names], is_relative)]."""
        pass

    @abstractmethod
    def extract_assignments(self, source: bytes) -> dict[str, str]:
        """Extract variable assignments for type resolution.
        Returns {qualified_name: type_name} e.g. {"MyClass.db": "Database"}."""
        pass

    @abstractmethod
    def extract_annotations(self, source: bytes) -> dict[str, str]:
        """Extract type annotations.
        Returns {qualified_name: type_name} e.g. {"MyClass.db": "Database"}."""
        pass

    def extract_endpoints(self, source: bytes, file_path: str) -> list[EndpointInfo]:
        """Extract API endpoints from source. Override in language extractors."""
        return []

    def extract_interactions(self, source: bytes, file_path: str) -> list[InteractionInfo]:
        """Extract data movements from source. Override in language extractors."""
        return []

    @staticmethod
    def module_name_from_path(file_path: str) -> str:
        """Derive a module/class name from a file path when no class scope exists.
        'src/api.py' → 'api', 'internal/delivery/routes.go' → 'routes'."""
        return Path(file_path).stem

    @property
    @abstractmethod
    def file_extensions(self) -> list[str]:
        """File extensions this extractor handles, e.g. ['.py', '.pyi']."""
        pass

    @property
    @abstractmethod
    def grammar(self) -> Any:
        """Return the tree-sitter Language object for this language."""
        pass
