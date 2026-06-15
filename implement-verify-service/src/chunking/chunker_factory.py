"""
Chunker factory module.

Provides factory for creating appropriate chunkers based on file type.
"""

from typing import List
from .base_chunker import BaseChunker


class ChunkerFactory:
    """
    Factory for creating appropriate chunkers based on file type.
    
    Uses Chain of Responsibility pattern to find suitable chunker.
    """
    
    def __init__(self):
        """Initialize factory with all available chunkers."""
        self._chunkers: List[BaseChunker] = []
        self._initialized = False
    
    def _lazy_init(self):
        """Lazy initialization to avoid circular imports."""
        if self._initialized:
            return
        
        from .package_json_chunker import PackageJsonChunker
        from .requirements_chunker import RequirementsChunker
        from .markdown_chunker import MarkdownChunker
        from .generic_chunker import GenericChunker
        
        self._chunkers = [
            PackageJsonChunker(),
            RequirementsChunker(),
            MarkdownChunker(),
            GenericChunker()  # Fallback - always last
        ]
        self._initialized = True
    
    def get_chunker(self, file_path: str, content: str, structural_analysis=None) -> BaseChunker:
        """
        Get appropriate chunker for the given file.

        Args:
            file_path: Path to the file
            content: File content
            structural_analysis: Optional StructuralAnalysis for AST-aware chunking

        Returns:
            Appropriate chunker instance
        """
        # AST chunker takes priority when structural data is available
        if structural_analysis and structural_analysis.symbols:
            from .ast_chunker import ASTChunker
            return ASTChunker(structural_analysis)

        self._lazy_init()

        for chunker in self._chunkers:
            if chunker.supports(file_path, content):
                return chunker

        # Should never reach here due to GenericChunker fallback
        return self._chunkers[-1]
    
    def register_chunker(self, chunker: BaseChunker):
        """
        Register a new chunker.
        
        Args:
            chunker: Chunker instance to register
        """
        self._lazy_init()
        
        # Insert before GenericChunker (always keep it last)
        self._chunkers.insert(-1, chunker)
