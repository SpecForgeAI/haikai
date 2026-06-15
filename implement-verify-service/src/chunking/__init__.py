"""
Chunking module for intelligent file splitting.

Provides automatic chunking of large files to avoid LLM timeouts.
"""

from .base_chunker import BaseChunker, ChunkResult
from .chunker_factory import ChunkerFactory
from .package_json_chunker import PackageJsonChunker
from .requirements_chunker import RequirementsChunker
from .markdown_chunker import MarkdownChunker
from .generic_chunker import GenericChunker

__all__ = [
    'BaseChunker',
    'ChunkResult',
    'ChunkerFactory',
    'PackageJsonChunker',
    'RequirementsChunker',
    'MarkdownChunker',
    'GenericChunker'
]
