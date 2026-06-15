"""
Base strategy classes for file analysis.
Separated to avoid circular imports.
"""

from typing import Dict, Tuple
from dataclasses import dataclass


@dataclass
class FileAnalysisContext:
    """
    Parameter object containing all metadata needed for file analysis.
    Reduces parameter coupling and ensures completeness.
    """
    path: str
    category: str
    standard_file: str
    
    def __post_init__(self):
        """Validate required fields."""
        if not self.path or not self.category or not self.standard_file:
            raise ValueError("FileAnalysisContext requires path, category, and standard_file")


class AnalysisStrategy:
    """Base strategy for different file analysis types."""
    
    def get_prompts(self, file_path: str, content: str, context: FileAnalysisContext) -> Tuple[str, str, int]:
        """
        Get system and user prompts for this analysis type.
        
        Args:
            file_path: Path to the file being analyzed
            content: File content
            context: Analysis context with metadata
        
        Returns:
            Tuple of (system_prompt, user_prompt, max_tokens)
        """
        raise NotImplementedError
    
    def get_metadata(self, file_path: str, content: str, context: FileAnalysisContext) -> Dict:
        """
        Get type-specific metadata to add to analysis result.
        
        Args:
            file_path: Path to the file being analyzed
            content: File content
            context: Analysis context with metadata
        
        Returns:
            Dictionary of metadata fields
        """
        raise NotImplementedError
