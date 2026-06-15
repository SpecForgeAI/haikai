"""
Generic chunker module.

Provides fallback chunking for any file type.
"""

import logging
from typing import List, Dict, Any
from .base_chunker import BaseChunker, ChunkResult

logger = logging.getLogger(__name__)


class GenericChunker(BaseChunker):
    """Generic fallback chunker for any file type."""
    
    def __init__(self, chars_per_chunk: int = 75000):
        """
        Initialize generic chunker.
        
        Args:
            chars_per_chunk: Characters per chunk
        """
        super().__init__()
        self.chars_per_chunk = chars_per_chunk
    
    def supports(self, file_path: str, content: str) -> bool:
        """Always returns True - this is the fallback."""
        return True
    
    def chunk(self, content: str) -> ChunkResult:
        """Split content into fixed-size chunks."""
        chunks = []
        for i in range(0, len(content), self.chars_per_chunk):
            chunks.append(content[i:i + self.chars_per_chunk])
        
        logger.info(f"Split file into {len(chunks)} generic chunks")
        
        return ChunkResult(
            chunks=chunks,
            metadata={'chunk_method': 'fixed_size'}
        )
    
    def merge(self, chunk_analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generic merge - combine all unique items."""
        merged = {
            'languages': [],
            'frameworks': [],
            'tools': [],
            'dependencies': [],
            'runtime': None
        }
        
        seen_items = {
            'languages': set(),
            'frameworks': set(),
            'tools': set(),
            'dependencies': set()
        }
        
        for analysis in chunk_analyses:
            for key in ['languages', 'frameworks', 'tools']:
                for item in analysis.get(key, []):
                    item_name = item.get('name') if isinstance(item, dict) else str(item)
                    if item_name and item_name not in seen_items[key]:
                        merged[key].append(item)
                        seen_items[key].add(item_name)
            
            # Dependencies with version deduplication
            for dep in analysis.get('dependencies', []):
                dep_key = (dep.get('name'), dep.get('version'))
                if dep_key not in seen_items['dependencies']:
                    merged['dependencies'].append(dep)
                    seen_items['dependencies'].add(dep_key)
            
            # Keep first runtime
            if not merged['runtime'] and analysis.get('runtime'):
                merged['runtime'] = analysis['runtime']
        
        logger.info(f"Merged {len(chunk_analyses)} generic chunks")
        
        return merged
