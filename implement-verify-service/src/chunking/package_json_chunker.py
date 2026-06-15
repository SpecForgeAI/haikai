"""
Package.json chunker module.

Provides intelligent chunking for package.json files.
"""

import json
import logging
from typing import List, Dict, Any
from .base_chunker import BaseChunker, ChunkResult

logger = logging.getLogger(__name__)


class PackageJsonChunker(BaseChunker):
    """
    Chunker for package.json files.
    
    Splits dependencies into groups while preserving metadata.
    """
    
    def __init__(self, dependencies_per_chunk: int = 20):
        """
        Initialize package.json chunker.
        
        Args:
            dependencies_per_chunk: Number of dependencies per chunk
        """
        super().__init__()
        self.dependencies_per_chunk = dependencies_per_chunk
    
    def supports(self, file_path: str, content: str) -> bool:
        """Check if file is package.json."""
        if not file_path.endswith('package.json'):
            return False
        
        try:
            json.loads(content)
            return True
        except (json.JSONDecodeError, ValueError):
            return False
    
    def chunk(self, content: str) -> ChunkResult:
        """
        Split package.json into chunks.
        
        Strategy:
        - Extract metadata (name, version, engines, scripts)
        - Split dependencies into groups
        - Each chunk contains metadata + subset of dependencies
        """
        data = json.loads(content)
        
        # Extract metadata to include in every chunk
        metadata = {}
        for key in ['name', 'version', 'engines', 'type', 'scripts']:
            if key in data:
                metadata[key] = data[key]
        
        chunks = []
        total_deps = 0
        
        # Process each dependency type
        for dep_type in ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']:
            if dep_type not in data:
                continue
            
            deps = data[dep_type]
            dep_items = list(deps.items())
            total_deps += len(dep_items)
            
            # Split into chunks
            for i in range(0, len(dep_items), self.dependencies_per_chunk):
                chunk_deps = dict(dep_items[i:i + self.dependencies_per_chunk])
                
                chunk_data = {**metadata, dep_type: chunk_deps}
                chunks.append(json.dumps(chunk_data, indent=2))
        
        logger.info(f"Split package.json into {len(chunks)} chunks ({total_deps} total dependencies)")
        
        return ChunkResult(
            chunks=chunks,
            metadata={
                'total_dependencies': total_deps,
                'chunk_method': 'dependency_grouping'
            }
        )
    
    def merge(self, chunk_analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Merge dependency analyses from multiple chunks.
        
        Strategy:
        - Combine all dependencies (deduplicate by name+version)
        - Combine frameworks (deduplicate by name)
        - Combine tools (deduplicate by name)
        - Keep first runtime/languages found
        """
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
                   f"{len(merged['frameworks'])} frameworks, "
                   f"{len(merged['tools'])} tools")
        
        return merged
