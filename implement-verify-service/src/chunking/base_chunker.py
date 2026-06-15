"""
Base chunker module for intelligent file chunking.

Provides abstract base class for all file chunkers.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any
from dataclasses import dataclass


@dataclass
class ChunkResult:
    """Result of chunking operation."""
    chunks: List[str]
    metadata: Dict[str, Any]
    
    @property
    def chunk_count(self) -> int:
        """Get number of chunks."""
        return len(self.chunks)


class BaseChunker(ABC):
    """
    Abstract base class for file chunkers.
    
    Each chunker knows how to split a specific file type
    into manageable chunks for LLM processing.
    """
    
    def __init__(self, chunk_threshold_tokens: int = 3000):
        """
        Initialize chunker.
        
        Args:
            chunk_threshold_tokens: Files larger than this will be chunked
        """
        self.chunk_threshold_tokens = chunk_threshold_tokens
    
    def should_chunk(self, content: str) -> bool:
        """
        Determine if content needs chunking.
        
        Args:
            content: File content to check
            
        Returns:
            True if content should be chunked
        """
        estimated_tokens = self._estimate_tokens(content)
        return estimated_tokens > self.chunk_threshold_tokens
    
    def _estimate_tokens(self, content: str) -> int:
        """
        Estimate token count from character count.
        
        Rough estimate: 4 characters = 1 token
        
        Args:
            content: Text content
            
        Returns:
            Estimated token count
        """
        return len(content) // 4
    
    @abstractmethod
    def chunk(self, content: str) -> ChunkResult:
        """
        Split content into chunks.
        
        Args:
            content: File content to chunk
            
        Returns:
            ChunkResult with chunks and metadata
        """
        pass
    
    @abstractmethod
    def merge(self, chunk_analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Merge analysis results from multiple chunks.
        
        Args:
            chunk_analyses: List of analysis results from each chunk
            
        Returns:
            Merged analysis result
        """
        pass
    
    @abstractmethod
    def supports(self, file_path: str, content: str) -> bool:
        """
        Check if this chunker supports the given file.
        
        Args:
            file_path: Path to the file
            content: File content
            
        Returns:
            True if this chunker can handle this file
        """
        pass
