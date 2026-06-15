"""
LLM-Driven Metamodel Integration Module

Integrates the two-pass LLM metamodel analysis into the standards-extractor pipeline.
"""

import json
import logging
from pathlib import Path
from typing import List, Optional, Dict, Any
from .llm_client import LLMClient
from .metamodel_llm_analyzer import MetamodelLLMAnalyzer

logger = logging.getLogger(__name__)

class MetamodelLLMIntegration:
    """
    Integration layer for LLM-driven metamodel analysis.
    """
    
    def __init__(self, llm_client: LLMClient):
        self.analyzer = MetamodelLLMAnalyzer(llm_client)
        self.analyses: List[Dict[str, Any]] = []
    
    def analyze_metamodel_files(self, file_paths: List[str]) -> List[Dict[str, Any]]:
        """
        Process multiple metamodel files using the two-pass LLM workflow.
        """
        self.analyses = []
        for path in file_paths:
            logger.info(f"Processing metamodel file: {path}")
            try:
                analysis = self.analyzer.analyze_file(path)
                self.analyses.append(analysis)
            except Exception as e:
                logger.error(f"Failed to analyze {path}: {e}")
                
        return self.analyses
    
    def generate_combined_markdown(self, output_path: str):
        """
        Generate a combined tech-stack-metamodel.md from all analyses.
        """
        if not self.analyses:
            logger.warning("No analyses available to generate Markdown.")
            return
            
        combined_lines = []
        combined_lines.append("# Tech Stack from Architecture Metamodels")
        combined_lines.append("")
        combined_lines.append("This document contains tech-stack information intelligently extracted from architectural metamodel JSON files using a two-pass LLM workflow.")
        combined_lines.append("")
        
        for i, analysis in enumerate(self.analyses):
            if i > 0:
                combined_lines.append("\n---\n")
            
            # Get markdown for individual analysis
            md = self.analyzer.to_markdown(analysis)
            # Remove the top-level header from individual markdown to avoid nested # headers
            md_lines = md.split('\n')
            if md_lines and md_lines[0].startswith('# '):
                md_lines[0] = '## ' + md_lines[0][2:]
            
            combined_lines.append("\n".join(md_lines))
            
        # Write to file
        out_path = Path(output_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(combined_lines))
            
        logger.info(f"Combined metamodel tech-stack written to {output_path}")

    def get_merged_tech_stack_data(self) -> Dict[str, Any]:
        """
        Merge tech-stack data from all analyses into a single structure.
        """
        merged = {
            "languages": set(),
            "frameworks": set(),
            "runtimes": set(),
            "frontend": {"frameworks": set(), "libraries": set()},
            "backend": {"service_types": set(), "api_types": set(), "technologies": set()},
            "database": {"systems": set(), "patterns": set()}
        }
        
        for analysis in self.analyses:
            ts = analysis.get('tech_stack_analysis', {}).get('tech_stack', {})
            
            merged["languages"].update(ts.get('languages', []))
            merged["frameworks"].update(ts.get('frameworks', []))
            merged["runtimes"].update(ts.get('runtimes', []))
            
            fe = ts.get('frontend', {})
            merged["frontend"]["frameworks"].update(fe.get('frameworks', []))
            merged["frontend"]["libraries"].update(fe.get('libraries', []))
            
            be = ts.get('backend', {})
            merged["backend"]["service_types"].update(be.get('service_types', []))
            merged["backend"]["api_types"].update(be.get('api_types', []))
            merged["backend"]["technologies"].update(be.get('technologies', []))
            
            db = ts.get('database', {})
            merged["database"]["systems"].update(db.get('systems', []))
            merged["database"]["patterns"].update(db.get('patterns', []))
            
        # Convert sets to sorted lists for JSON serialization
        def sets_to_lists(obj):
            if isinstance(obj, set):
                return sorted(list(obj))
            if isinstance(obj, dict):
                return {k: sets_to_lists(v) for k, v in obj.items()}
            return obj
            
        return sets_to_lists(merged)

def run_metamodel_llm_pipeline(
    file_paths: List[str],
    output_dir: str,
    llm_client: LLMClient
) -> Dict[str, Any]:
    """
    Main entry point for the LLM-driven metamodel pipeline.
    """
    integration = MetamodelLLMIntegration(llm_client)
    
    # Process files
    analyses = integration.analyze_metamodel_files(file_paths)
    
    if not analyses:
        return {"status": "error", "message": "No files successfully analyzed"}
        
    # Generate Markdown
    output_path = Path(output_dir) / 'global' / 'tech-stack-metamodel.md'
    integration.generate_combined_markdown(str(output_path))
    
    # Get merged data
    merged_data = integration.get_merged_tech_stack_data()
    
    return {
        "status": "success",
        "files_processed": len(analyses),
        "output_file": str(output_path),
        "merged_tech_stack": merged_data
    }
