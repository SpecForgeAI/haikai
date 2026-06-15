"""
Markdown chunker module.

Provides intelligent chunking for Markdown files.
"""

import re
import logging
from typing import List, Dict, Any
from .base_chunker import BaseChunker, ChunkResult

logger = logging.getLogger(__name__)


class MarkdownChunker(BaseChunker):
    """Chunker for Markdown files."""
    
    def __init__(self, chars_per_chunk: int = 50000):
        """
        Initialize markdown chunker.
        
        Args:
            chars_per_chunk: Target characters per chunk
        """
        super().__init__()
        self.chars_per_chunk = chars_per_chunk
    
    def supports(self, file_path: str, content: str) -> bool:
        """Check if file is Markdown."""
        return file_path.endswith(('.md', '.markdown', '.rst'))
    
    def chunk(self, content: str) -> ChunkResult:
        """
        Split Markdown by sections.
        
        Tries to split by ## headers to maintain semantic boundaries.
        """
        # Split by ## headers
        sections = re.split(r'\n##\s+', content)
        
        chunks = []
        current_chunk = sections[0]  # Title/intro
        
        for section in sections[1:]:
            section_with_header = '## ' + section
            
            # If adding this section exceeds chunk size, start new chunk
            if len(current_chunk) + len(section_with_header) > self.chars_per_chunk:
                chunks.append(current_chunk)
                current_chunk = section_with_header
            else:
                current_chunk += '\n' + section_with_header
        
        if current_chunk:
            chunks.append(current_chunk)
        
        logger.info(f"Split markdown into {len(chunks)} chunks")
        
        return ChunkResult(
            chunks=chunks,
            metadata={'chunk_method': 'section_based'}
        )
    
    def merge(self, chunk_analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge technical document analyses."""
        merged = {
            'languages': [],
            'frameworks': [],
            'tools': [],
            'dependencies': [],
            'runtime': None
        }
        
        seen_frameworks = set()
        seen_tools = set()
        seen_langs = set()
        
        for analysis in chunk_analyses:
            # Merge languages
            for lang in analysis.get('languages', []):
                lang_name = lang.get('name') if isinstance(lang, dict) else lang
                if lang_name and lang_name not in seen_langs:
                    merged['languages'].append(lang)
                    seen_langs.add(lang_name)
            
            # Merge frameworks
            for fw in analysis.get('frameworks', []):
                fw_name = fw.get('name') if isinstance(fw, dict) else fw
                if fw_name and fw_name not in seen_frameworks:
                    merged['frameworks'].append(fw)
                    seen_frameworks.add(fw_name)
            
            # Merge tools
            for tool in analysis.get('tools', []):
                tool_name = tool.get('name') if isinstance(tool, dict) else tool
                if tool_name and tool_name not in seen_tools:
                    merged['tools'].append(tool)
                    seen_tools.add(tool_name)
            
            # Keep first runtime
            if not merged['runtime'] and analysis.get('runtime'):
                merged['runtime'] = analysis['runtime']
        
        logger.info(f"Merged {len(chunk_analyses)} markdown chunks: "
                   f"{len(merged['languages'])} languages, "
                   f"{len(merged['frameworks'])} frameworks")
        
        return merged
