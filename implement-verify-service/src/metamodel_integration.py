"""
Metamodel Integration Module

Integrates metamodel JSON parsing into the standards-extractor pipeline.
This module provides the bridge between metamodel files and tech-stack generation.
"""

import json
from pathlib import Path
from typing import List, Optional, Dict
try:
    from .metamodel_parser import MetamodelParser, TechStackInfo, parse_metamodel_files
except ImportError:
    from metamodel_parser import MetamodelParser, TechStackInfo, parse_metamodel_files


class MetamodelIntegration:
    """
    Integration layer for metamodel JSON files in the standards extraction pipeline.
    
    This class handles:
    1. Discovery of metamodel JSON files
    2. Parsing and extraction of tech-stack information
    3. Merging metamodel data with existing tech-stack sources
    4. Generating tech-stack.md output
    """
    
    def __init__(self, metamodel_dir: Optional[str] = None):
        """
        Initialize metamodel integration.
        
        Args:
            metamodel_dir: Directory containing metamodel JSON files.
                          If None, looks for 'metamodel' directory in project root.
        """
        self.metamodel_dir = metamodel_dir
        self.tech_stack_info: Optional[TechStackInfo] = None
    
    def discover_metamodel_files(self, search_paths: Optional[List[str]] = None) -> List[str]:
        """
        Discover metamodel JSON files in the specified paths.
        
        Args:
            search_paths: List of directories to search. If None, uses self.metamodel_dir
            
        Returns:
            List of paths to metamodel JSON files
        """
        if search_paths is None:
            if self.metamodel_dir is None:
                return []
            search_paths = [self.metamodel_dir]
        
        metamodel_files = []
        
        for search_path in search_paths:
            path = Path(search_path)
            if not path.exists():
                continue
            
            # Look for JSON files
            if path.is_file() and path.suffix == '.json':
                # Validate it's a metamodel file
                if self._is_metamodel_file(str(path)):
                    metamodel_files.append(str(path))
            elif path.is_dir():
                # Search directory for JSON files
                for json_file in path.rglob('*.json'):
                    if self._is_metamodel_file(str(json_file)):
                        metamodel_files.append(str(json_file))
        
        return metamodel_files
    
    def _is_metamodel_file(self, file_path: str) -> bool:
        """
        Check if a JSON file is a metamodel file by examining its structure.
        
        Args:
            file_path: Path to JSON file
            
        Returns:
            True if file contains metamodel structure
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Check for metamodel signature
            if 'metaModel' in data:
                meta_model = data['metaModel']
                if 'entities' in meta_model:
                    return True
            
            return False
        except (json.JSONDecodeError, IOError):
            return False
    
    def extract_tech_stack(self, file_paths: List[str]) -> TechStackInfo:
        """
        Extract tech-stack information from metamodel files.
        
        Args:
            file_paths: List of metamodel JSON file paths
            
        Returns:
            Merged TechStackInfo from all files
        """
        self.tech_stack_info = parse_metamodel_files(file_paths)
        return self.tech_stack_info
    
    def generate_tech_stack_markdown(
        self,
        output_path: str,
        include_template: bool = True,
        template_path: Optional[str] = None
    ):
        """
        Generate tech-stack.md file from extracted metamodel data.
        
        Args:
            output_path: Path where tech-stack.md should be written
            include_template: Whether to include template structure
            template_path: Path to tech-stack template (if include_template=True)
        """
        if self.tech_stack_info is None:
            raise ValueError("No tech-stack info available. Run extract_tech_stack first.")
        
        lines = []
        
        # Add template header if requested
        if include_template and template_path:
            lines.append("## Tech Stack")
            lines.append("")
            lines.append("This document combines information from:")
            lines.append("1. User input and preferences")
            lines.append("2. Global standards and templates")
            lines.append("3. Architecture metamodel JSON files (extracted below)")
            lines.append("")
            lines.append("---")
            lines.append("")
        
        # Add metamodel-extracted content
        parser = MetamodelParser()
        parser.tech_stack_info = self.tech_stack_info
        lines.append(parser.to_markdown())
        
        # Write to file
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
    
    def merge_with_existing_tech_stack(
        self,
        existing_tech_stack_path: str,
        output_path: str
    ):
        """
        Merge metamodel tech-stack with existing tech-stack.md file.
        
        This creates a combined tech-stack document that includes:
        1. Existing user/template content
        2. Metamodel-extracted information
        
        Args:
            existing_tech_stack_path: Path to existing tech-stack.md
            output_path: Path where merged tech-stack.md should be written
        """
        if self.tech_stack_info is None:
            raise ValueError("No tech-stack info available. Run extract_tech_stack first.")
        
        lines = []
        
        # Read existing content if available
        existing_path = Path(existing_tech_stack_path)
        if existing_path.exists():
            with open(existing_path, 'r', encoding='utf-8') as f:
                existing_content = f.read()
            lines.append(existing_content)
            lines.append("")
            lines.append("---")
            lines.append("")
        
        # Add metamodel section
        lines.append("## Tech Stack from Architecture Metamodel")
        lines.append("")
        lines.append("The following tech stack information was automatically extracted from architecture metamodel JSON files:")
        lines.append("")
        
        parser = MetamodelParser()
        parser.tech_stack_info = self.tech_stack_info
        lines.append(parser.to_markdown())
        
        # Write merged content
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
    
    def get_tech_stack_summary(self) -> Dict:
        """
        Get a summary of extracted tech-stack information.
        
        Returns:
            Dictionary with tech-stack summary
        """
        if self.tech_stack_info is None:
            return {}
        
        parser = MetamodelParser()
        parser.tech_stack_info = self.tech_stack_info
        return parser.to_dict()


def integrate_metamodel_into_pipeline(
    metamodel_paths: List[str],
    output_dir: str,
    template_dir: Optional[str] = None
) -> Dict:
    """
    Main integration function to add metamodel tech-stack extraction to the pipeline.
    
    This function:
    1. Discovers metamodel JSON files
    2. Extracts tech-stack information
    3. Generates tech-stack.md output
    4. Returns summary for reporting
    
    Args:
        metamodel_paths: List of paths to search for metamodel JSON files
        output_dir: Directory where tech-stack.md should be written
        template_dir: Optional template directory for tech-stack template
        
    Returns:
        Dictionary with extraction summary and statistics
    """
    integration = MetamodelIntegration()
    
    # Discover files
    metamodel_files = integration.discover_metamodel_files(metamodel_paths)
    
    if not metamodel_files:
        return {
            'status': 'no_files_found',
            'message': 'No metamodel JSON files found in specified paths',
            'files_processed': 0
        }
    
    # Extract tech-stack
    tech_stack_info = integration.extract_tech_stack(metamodel_files)
    
    # Generate output
    output_path = Path(output_dir) / 'global' / 'tech-stack-metamodel.md'
    integration.generate_tech_stack_markdown(
        str(output_path),
        include_template=True,
        template_path=template_dir
    )
    
    # Return summary
    return {
        'status': 'success',
        'files_processed': len(metamodel_files),
        'metamodel_files': metamodel_files,
        'output_file': str(output_path),
        'tech_stack_summary': integration.get_tech_stack_summary()
    }


# CLI usage example
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 3:
        print("Usage: python metamodel_integration.py <metamodel_dir> <output_dir>")
        sys.exit(1)
    
    metamodel_dir = sys.argv[1]
    output_dir = sys.argv[2]
    
    result = integrate_metamodel_into_pipeline(
        metamodel_paths=[metamodel_dir],
        output_dir=output_dir
    )
    
    print(json.dumps(result, indent=2))
