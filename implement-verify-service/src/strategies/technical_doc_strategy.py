"""
Technical Documentation Analysis Strategy
Extracts technology stack information from technical documents using LLM.
"""

from typing import Tuple, Dict, Any
import logging
from .base_strategy import AnalysisStrategy, FileAnalysisContext
from src.content_extractor import ContentExtractor

logger = logging.getLogger(__name__)


class TechnicalDocAnalysisStrategy(AnalysisStrategy):
    """
    Strategy for analyzing technical documentation to extract tech stack information.
    Follows the same pattern as CodeAnalysisStrategy and DependencyAnalysisStrategy.
    
    Uses ContentExtractor for two-step LLM process:
    1. Analyze document structure
    2. Extract relevant content
    3. Then extract tech stack from filtered content
    """
    
    def __init__(self, llm_client):
        """
        Initialize with LLM client and ContentExtractor.
        
        Args:
            llm_client: LLM client for analysis
        """
        self.llm_client = llm_client
        self.content_extractor = ContentExtractor(llm_client)
        logger.info("TechnicalDocAnalysisStrategy initialized with ContentExtractor")
    
    def get_prompts(
        self, 
        file_path: str, 
        content: str, 
        context: FileAnalysisContext
    ) -> Tuple[str, str, int]:
        """
        Generate prompts for extracting tech stack from technical documents.
        
        Args:
            file_path: Path to the technical document
            content: Parsed text content of the document
            context: Analysis context with metadata
            
        Returns:
            Tuple of (system_prompt, user_prompt, max_tokens)
        """
        # NEW: Use ContentExtractor to filter content first
        logger.info(f"Extracting relevant content from {file_path}")
        try:
            relevant_content = self.content_extractor.extract(
                parsed_content=content,
                use_case='tech_stack'
            )
            logger.info(f"Content filtered: {len(content)} → {len(relevant_content)} chars")
        except Exception as e:
            logger.warning(f"Content extraction failed, using original content: {e}")
            relevant_content = content
        
        system_prompt = """You are a technical documentation analyst specialized in extracting technology stack information.

Your task is to analyze technical documents and extract structured information about technologies, frameworks, libraries, databases, and tools mentioned.

Only include technologies that are explicitly mentioned in the document. Do not infer or assume technologies that are not clearly stated.

Return valid JSON only, no additional text or markdown formatting."""

        user_prompt = f"""Analyze this technical document and extract technology stack information.

Document: {file_path}

Content:
{relevant_content}

Extract and return JSON with this exact structure:
{{
  "languages": [
    {{"name": "Python", "version": "3.11", "purpose": "backend development"}}
  ],
  "frameworks": [
    {{"name": "Django", "version": "4.2", "category": "web_framework"}}
  ],
  "databases": [
    {{"name": "PostgreSQL", "version": "15", "purpose": "primary database"}}
  ],
  "infrastructure": [
    {{"name": "Docker", "purpose": "containerization"}}
  ],
  "third_party_services": [
    {{"name": "AWS S3", "purpose": "file storage"}}
  ],
  "tools": [
    {{"name": "Redis", "version": "7.0", "purpose": "caching"}}
  ]
}}

Rules:
1. Only include technologies explicitly mentioned in the document
2. Extract version numbers when mentioned (use null if not specified)
3. Infer purpose/category from context when clear
4. Use consistent naming (e.g., "React" not "ReactJS" or "React.js")
5. Return valid JSON only - no markdown code blocks or extra text
6. If a category has no entries, use an empty array []
"""

        max_tokens = 4000
        
        return (system_prompt, user_prompt, max_tokens)
    
    def get_metadata(self, file_path: str, content: str, context: FileAnalysisContext) -> Dict[str, Any]:
        """Return metadata about the analyzed technical document."""
        return {
            'file_type': 'technical_document',
            'content_length': len(content)
        }