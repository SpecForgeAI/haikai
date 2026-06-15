"""
StandardsSynthesizer module that synthesizes individual file analyses into a single standard document.
"""
import json
import logging
from pathlib import Path
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

class StandardsSynthesizer:
    """Synthesizes individual file analyses into a single standard document."""
    
    def __init__(self, llm_client):
        """
        Initialize the standards synthesizer.
        
        Args:
            llm_client: LLM client for generating content
        """
        self.llm_client = llm_client
        self.templates_dir = Path(__file__).parent.parent / 'templates' / 'standards'

    def load_template(self, standard_file: str) -> str:
        """Load a template for a standard."""
        template_path = self.templates_dir / standard_file
        if template_path.exists():
            with open(template_path, 'r', encoding='utf-8') as f:
                return f.read()
        return f"# {standard_file}\n\nNo template found for this standard."

    def synthesize_standard(self, standard_file: str, analyses: List[Dict]) -> str:
        """
        Synthesize a standard document from individual file analyses.
        
        Args:
            standard_file: Name of the standard file (e.g., 'global/error-handling.md')
            analyses: List of individual file analyses
            
        Returns:
            Synthesized standard document as Markdown string
        """
        template = self.load_template(standard_file)
        
        # Build context for the LLM
        context = ""
        for analysis in analyses:
            context += f"### File: {analysis.get('path')}\n"
            context += f"Category: {analysis.get('category')}\n"
            context += f"Analysis: {json.dumps(analysis.get('analysis'), indent=2)}\n\n"
            
        system_prompt = f"""You are a technical architect responsible for defining company-wide standards.
Your task is to synthesize individual file analyses into a single, cohesive standard document.
The standard you are working on is: {standard_file}

Use the provided template as a guide for the structure and content of the standard.
Incorporate the findings from the individual file analyses into the appropriate sections of the template.
Ensure the final document is professional, consistent, and provides clear guidance for developers."""

        user_prompt = f"""Template:
{template}

Individual File Analyses:
{context}

Synthesize the findings into the template and return the final Markdown document."""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        try:
            response = self.llm_client.generate(messages)
            return response
        except Exception as e:
            logger.error(f"Error synthesizing standard {standard_file}: {e}")
            return f"# {standard_file}\n\nError during synthesis: {str(e)}"
    
    def execute_synthesis_strategy(self, strategy, providers: List) -> str:
        """
        Execute a tech-stack synthesis strategy using the provided providers.
        Following the Strategy Pattern for modular tech-stack generation.
        """
        return strategy.synthesize(self.llm_client, providers)

    def synthesize_global_standard_3pass(self, standard_name: str, pass2_json_path: str, 
                                       context, template: str, chunk_size: int = 25) -> str:
        """
        Synthesize a global standard using a 3-pass approach for large repositories.
        """
        # This is a placeholder for the 3-pass synthesis logic
        # In a real implementation, this would involve multiple LLM calls
        # to summarize, refine, and finalize the standard.
        logger.info(f"Executing 3-pass synthesis for {standard_name}")
        return self.synthesize_standard(f"global/{standard_name}.md", [])

    def build_global_context(self, all_files: Dict[str, List[str]], standard: str):
        """Build context for global standards."""
        # This is a placeholder for building global context
        return {}
