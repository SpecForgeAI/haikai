"""
Requirements.txt chunker module.

Provides intelligent chunking for Python requirements files.
"""

import logging
from typing import List, Dict, Any
from .base_chunker import BaseChunker, ChunkResult

logger = logging.getLogger(__name__)


class RequirementsChunker(BaseChunker):
    """Chunker for requirements.txt files."""
    
    def __init__(self, packages_per_chunk: int = 30):
        """
        Initialize requirements chunker.
        
        Args:
            packages_per_chunk: Number of packages per chunk
        """
        super().__init__()
        self.packages_per_chunk = packages_per_chunk
    
    def supports(self, file_path: str, content: str) -> bool:
        """Check if file is requirements.txt."""
        return file_path.endswith(('requirements.txt', 'requirements-dev.txt', 'requirements-test.txt'))
    
    def chunk(self, content: str) -> ChunkResult:
        """Split requirements.txt into chunks."""
        lines = [line.strip() for line in content.split('\n') if line.strip() and not line.startswith('#')]
        
        chunks = []
        for i in range(0, len(lines), self.packages_per_chunk):
            chunk_lines = lines[i:i + self.packages_per_chunk]
            chunks.append('\n'.join(chunk_lines))
        
        logger.info(f"Split requirements.txt into {len(chunks)} chunks ({len(lines)} packages)")
        
        return ChunkResult(
            chunks=chunks,
            metadata={
                'total_packages': len(lines),
                'chunk_method': 'line_grouping'
            }
        )
    
    def merge(self, chunk_analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge Python dependency analyses."""
        merged = {
            'languages': [],
            'frameworks': [],
            'tools': [],
            'dependencies': [],
            'runtime': None
        }
        
        seen_deps = set()
        seen_frameworks = set()
        seen_tools = set()
        
        for analysis in chunk_analyses:
            # Merge dependencies
            for dep in analysis.get('dependencies', []):
                dep_key = (dep.get('name'), dep.get('version'))
                if dep_key not in seen_deps:
                    merged['dependencies'].append(dep)
                    seen_deps.add(dep_key)
            
            # Merge frameworks
            for fw in analysis.get('frameworks', []):
                fw_name = fw.get('name')
                if fw_name and fw_name not in seen_frameworks:
                    merged['frameworks'].append(fw)
                    seen_frameworks.add(fw_name)
            
            # Merge tools
            for tool in analysis.get('tools', []):
                tool_name = tool.get('name')
                if tool_name and tool_name not in seen_tools:
                    merged['tools'].append(tool)
                    seen_tools.add(tool_name)
            
            # Keep first runtime
            if not merged['runtime'] and analysis.get('runtime'):
                merged['runtime'] = analysis['runtime']
            
            # Keep first languages
            if not merged['languages'] and analysis.get('languages'):
                merged['languages'] = analysis['languages']
        
        logger.info(f"Merged {len(chunk_analyses)} chunks: "
                   f"{len(merged['dependencies'])} deps, "
                   f"{len(merged['frameworks'])} frameworks")
        
        return merged
