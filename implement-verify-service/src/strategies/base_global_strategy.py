"""
Updated Base Global Standard Strategy with 3-pass support.
Replace the existing src/strategies/base_global_strategy.py with this version.
"""

from abc import ABC, abstractmethod
from typing import Tuple, List, Dict, Any
from pathlib import Path
from dataclasses import dataclass, asdict
import random
import json
import logging

from .base_strategy import AnalysisStrategy, FileAnalysisContext
from ..categories import FileCategories

logger = logging.getLogger(__name__)


@dataclass
class GlobalAnalysisContext:
    """
    Parameter object for global standards analysis context.
    Follows existing pattern of using dataclasses for context (FileAnalysisContext).
    """
    standard_name: str
    tech_stack: str
    languages: List[str]
    frameworks: List[str]
    baseline_practices: List[str]
    distinctive_patterns_to_look_for: List[str]
    filtering_guidance: str
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)
    
    def to_json(self, indent: int = 2) -> str:
        """Convert to JSON string."""
        return json.dumps(self.to_dict(), indent=indent)


class BaseGlobalStandardStrategy(AnalysisStrategy):
    """
    Base class for global standard extraction strategies.
    
    Implements unified 3-pass approach:
    - Pass 1: Analyze samples to build context (returns GlobalAnalysisContext)
    - Pass 2: Extract pattern candidates guided by context
    - Pass 3: Filter baseline patterns and synthesize (handled by StandardsSynthesizer)
    
    Both code and documentation follow the same pattern.
    """
    
    def __init__(self, llm_client, content_extractor):
        """
        Initialize strategy.
        
        Args:
            llm_client: LLM client for analysis
            content_extractor: ContentExtractor for filtering documentation
        """
        self.llm_client = llm_client
        self.content_extractor = content_extractor
        self.context: GlobalAnalysisContext = None  # Context from Pass 1
        logger.info(f"{self.__class__.__name__} initialized")
    
    @abstractmethod
    def get_standard_name(self) -> str:
        """
        Return standard name (e.g., 'error_handling').
        Used for ContentExtractor use_case and logging.
        """
        pass
    
    # ==========================================================================
    # PASS 1: BUILD CONTEXT (NEW - returns GlobalAnalysisContext)
    # ==========================================================================
    
    def build_context_from_samples(
        self,
        code_files: List[str],
        doc_files: List[str],
        sample_count: int = 15,
        max_chars_per_file: int = 2000
    ) -> GlobalAnalysisContext:
        """
        Pass 1: Build structured context by analyzing code samples and documentation.
        
        Args:
            code_files: List of all code file paths
            doc_files: List of documentation file paths (already parsed)
            sample_count: Number of code files to sample (default 15)
            max_chars_per_file: Maximum characters to read per file (default 2000)
            
        Returns:
            GlobalAnalysisContext dataclass with structured context
        """
        logger.info(f"Building context for {self.get_standard_name()}...")
        logger.info(f"Total code files: {len(code_files)}, Sample count: {sample_count}")
        
        # Sample random code files
        if len(code_files) <= sample_count:
            sampled_files = code_files
        else:
            sampled_files = random.sample(code_files, sample_count)
        
        logger.info(f"Sampled {len(sampled_files)} files for context building")
        
        # Read sampled code files
        code_samples = []
        for file_path in sampled_files:
            try:
                content = Path(file_path).read_text(encoding='utf-8', errors='ignore')
                truncated = content[:max_chars_per_file]
                code_samples.append(f"=== {file_path} ===\n{truncated}\n")
            except Exception as e:
                logger.warning(f"Failed to read {file_path}: {e}")
        
        code_samples_str = "\n".join(code_samples)
        logger.info(f"Code samples: {len(code_samples_str)} chars")
        
        # Process documentation
        doc_content = ""
        for doc_file in doc_files:
            try:
                parsed_content = Path(doc_file).read_text(encoding='utf-8', errors='ignore')
                filtered = self.content_extractor.extract(
                    parsed_content=parsed_content,
                    use_case=self.get_standard_name()
                )
                doc_content += f"\n\n{filtered}"
                logger.info(f"Processed doc {doc_file}: {len(parsed_content)} → {len(filtered)} chars")
            except Exception as e:
                logger.warning(f"Failed to process {doc_file}: {e}")
        
        logger.info(f"Documentation content: {len(doc_content)} chars")
        
        # Get analysis prompt (import from agent_prompts)
        from ..agent_prompts import (
            ANALYZE_CODEBASE_CONTEXT_SYSTEM_PROMPT,
            ANALYZE_CODEBASE_CONTEXT_USER_PROMPT_TEMPLATE
        )
        
        user_prompt = ANALYZE_CODEBASE_CONTEXT_USER_PROMPT_TEMPLATE.format(
            standard_name=self.get_standard_name(),
            code_samples=code_samples_str,
            documentation=doc_content if doc_content else "No documentation available"
        )
        
        messages = [
            {"role": "system", "content": ANALYZE_CODEBASE_CONTEXT_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ]
        
        logger.info(f"Calling LLM for context building (prompt: {len(user_prompt)} chars)...")
        response = self.llm_client.generate(messages)
        
        # Parse JSON response into GlobalAnalysisContext
        try:
            context_dict = json.loads(response)
            self.context = GlobalAnalysisContext(
                standard_name=self.get_standard_name(),
                tech_stack=context_dict.get('tech_stack', ''),
                languages=context_dict.get('languages', []),
                frameworks=context_dict.get('frameworks', []),
                baseline_practices=context_dict.get('baseline_practices', []),
                distinctive_patterns_to_look_for=context_dict.get('distinctive_patterns_to_look_for', []),
                filtering_guidance=context_dict.get('filtering_guidance', '')
            )
            logger.info(f"Context built for {self.get_standard_name()}")
            logger.info(f"  Tech stack: {self.context.tech_stack}")
            logger.info(f"  Baseline practices: {len(self.context.baseline_practices)}")
            logger.info(f"  Distinctive patterns: {len(self.context.distinctive_patterns_to_look_for)}")
            
            return self.context
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse context JSON: {e}")
            logger.error(f"Response: {response[:500]}")
            # Return minimal context
            return GlobalAnalysisContext(
                standard_name=self.get_standard_name(),
                tech_stack="Unknown",
                languages=[],
                frameworks=[],
                baseline_practices=[],
                distinctive_patterns_to_look_for=[],
                filtering_guidance=""
            )
    
    # ==========================================================================
    # PASS 2: EXTRACT PATTERN CANDIDATES (UPDATED)
    # ==========================================================================
    
    def get_extraction_prompts(
        self,
        file_path: str,
        content: str,
        is_documentation: bool
    ) -> Tuple[str, str]:
        """
        Pass 2: Get prompts for extracting pattern candidates.
        
        Args:
            file_path: Path to file being analyzed
            content: File content
            is_documentation: True if documentation, False if code
            
        Returns:
            (system_prompt, user_prompt)
        """
        from ..agent_prompts import (
            EXTRACT_PATTERN_CANDIDATES_SYSTEM_PROMPT,
            EXTRACT_PATTERN_CANDIDATES_USER_PROMPT_TEMPLATE
        )
        
        # Format baseline practices list
        baseline_list = '\n'.join(f"❌ {p}" for p in self.context.baseline_practices)
        
        # Format distinctive patterns list
        distinctive_list = '\n'.join(f"✅ {p}" for p in self.context.distinctive_patterns_to_look_for)
        
        # Build user prompt
        user_prompt = EXTRACT_PATTERN_CANDIDATES_USER_PROMPT_TEMPLATE.format(
            context_json=self.context.to_json(),
            file_path=file_path,
            file_content=content,
            baseline_practices_list=baseline_list,
            distinctive_patterns_list=distinctive_list
        )
        
        return (EXTRACT_PATTERN_CANDIDATES_SYSTEM_PROMPT, user_prompt)
    
    def get_prompts(
        self,
        file_path: str,
        content: str,
        context: FileAnalysisContext
    ) -> Tuple[str, str, int]:
        """
        Standard interface method (required by AnalysisStrategy).
        
        This is called by FileAnalyzer for Pass 2 extraction.
        
        Args:
            file_path: Path to file being analyzed
            content: File content
            context: Analysis context with metadata
            
        Returns:
            (system_prompt, user_prompt, max_tokens)
        """
        # Determine if this is documentation or code
        is_documentation = context.category == FileCategories.TECHNICAL_DOC
        
        # Get prompts from extraction method
        system_prompt, user_prompt = self.get_extraction_prompts(
            file_path, content, is_documentation
        )
        
        # No token limit (user preference)
        return (system_prompt, user_prompt, None)
    
    def get_metadata(
        self,
        file_path: str,
        content: str,
        context: FileAnalysisContext
    ) -> dict:
        """Return metadata about the analyzed file."""
        return {
            'file_type': 'documentation' if context.category == FileCategories.TECHNICAL_DOC else 'code',
            'standard_name': self.get_standard_name(),
            'context_available': self.context is not None,
            'content_length': len(content)
        }

    def synthesize(self, llm_client, providers: List[Dict[str, Any]]) -> str:
        """
        Synthesize the final global standard markdown from extracted analyses.
        NOTE: 'providers' here are the per-file analyses loaded from staging/*.json
        (naming kept to match the existing StandardsSynthesizer interface).
        """
        standard = self.get_standard_name()  # e.g. "validation"
        template_name = standard.replace("_", "-") + ".md"

        # Try to load template: templates/standards/global/<name>.md
        repo_root = Path(__file__).resolve().parents[2]  # .../src/strategies -> repo root
        template_path = repo_root / "templates" / "standards" / "global" / template_name

        template_text = ""
        if template_path.exists():
            template_text = template_path.read_text(encoding="utf-8")

        # Keep the prompt stable + deterministic
        system_prompt = (
            "You are a technical architect synthesizing a company-wide coding standard document.\n"
            "Use the provided TEMPLATE as the structure. Populate it ONLY with standards evidenced in the ANALYSES.\n"
            "Do not invent new standards.\n"
            "Return ONLY the final Markdown.\n"
        )

        user_prompt = (
            f"Synthesize the final `global/{template_name}` standard.\n\n"
            f"=== TEMPLATE (structure to follow) ===\n"
            f"{template_text if template_text else '(No template found; produce a concise standard with headings.)'}\n\n"
            f"=== ANALYSES (evidence) ===\n"
            f"{json.dumps(providers, indent=2)}\n\n"
            "Rules:\n"
            "- Only include standards that are clearly supported by the analyses.\n"
            "- If the analyses are weak/empty for a section, keep that section minimal or mark it as not observed.\n"
            "- Keep it practical and readable.\n"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        return llm_client.generate(messages)
    # ==========================================================================
    # DEPRECATED METHODS (Keep for backward compatibility)
    # ==========================================================================
    
    def get_context_analysis_prompt(self, code_samples: str, doc_content: str) -> str:
        """
        DEPRECATED: Use build_context_from_samples() instead.
        Kept for backward compatibility.
        """
        logger.warning(f"{self.__class__.__name__}.get_context_analysis_prompt() is deprecated")
        return ""
