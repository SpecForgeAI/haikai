"""
Content extraction for technical documents.
Uses two-step LLM process: analyze structure → extract relevant content.
Single Responsibility: Filter document content based on use case.
"""

from typing import Dict
import logging

logger = logging.getLogger(__name__)


class ContentExtractor:
    """
    Intelligently extracts relevant content from parsed documents.
    
    Uses a two-step LLM process:
    1. Analyze document structure and identify relevant sections
    2. Extract only the relevant content for the use case
    
    This reduces noise and improves extraction quality by filtering out
    navigation, marketing, and unrelated content before sending to LLM.
    """
    
    def __init__(self, llm_client):
        """
        Initialize with LLM client.
        
        Args:
            llm_client: LLM client for analysis and extraction
        """
        self.llm_client = llm_client
    
    def extract(self, parsed_content: str, use_case: str) -> str:
        """
        Extract relevant content based on use case.
        
        Args:
            parsed_content: Full parsed document text
            use_case: Extraction use case (e.g., 'tech_stack', 'coding_style')
        
        Returns:
            Filtered content relevant to the use case
        """
        logger.info(f"Extracting content for use case: {use_case}")
        logger.info(f"  Original content length: {len(parsed_content)} chars")
        
        # Step 1: Analyze document structure
        analysis = self._analyze_structure(parsed_content, use_case)
        logger.info(f"  Analysis complete")
        
        # Step 2: Extract relevant content
        extracted = self._extract_relevant(parsed_content, analysis, use_case)
        logger.info(f"  Extracted content length: {len(extracted)} chars")
        
        return extracted
    
    def _analyze_structure(self, content: str, use_case: str) -> str:
        """
        Analyze document to understand structure and relevance.
        
        Sends first 5000 chars to LLM for quick analysis.
        LLM returns: document type, main topics, what's relevant.
        
        Args:
            content: Full document content
            use_case: What we're extracting for
            
        Returns:
            Analysis text describing document structure
        """
        # Use first 5000 chars for analysis (token efficiency)
        content_sample = content[:5000]
        if len(content) > 5000:
            content_sample += "\n\n... (document continues)"
        
        analysis_prompt = f"""Analyze this technical document for '{use_case}' extraction.

Provide a brief analysis:
1. What type of document is this? (e.g., architecture doc, framework guide, API reference)
2. What are the main topics/sections?
3. What content would be most relevant for extracting {use_case}?
4. What should be excluded? (marketing, navigation, unrelated content)

Document:
{content_sample}

Keep analysis brief and actionable."""
        
        messages = [
            {'role': 'system', 'content': 'You are a technical document analyzer.'},
            {'role': 'user', 'content': analysis_prompt}
        ]
        
        try:
            analysis = self.llm_client.generate(messages)
            return analysis
        except Exception as e:
            import traceback
            logger.error(f"Analysis failed: {str(e) or type(e).__name__}")
            logger.debug(traceback.format_exc())
            # Fallback: return simple analysis
            return f"Document type: Technical documentation\nRelevant for: {use_case}\nExclude: Navigation and marketing content"
    
    def _extract_relevant(self, content: str, analysis: str, use_case: str) -> str:
        """
        Extract relevant content based on analysis.
        
        Uses the analysis to guide extraction.
        LLM returns: only the relevant sections.
        
        Args:
            content: Full document content
            analysis: Analysis from previous step
            use_case: What we're extracting for
            
        Returns:
            Extracted relevant content
        """
        # Limit content size to avoid token limits (max ~200k chars = ~50k tokens)
        # Modern LLMs can handle 200k+ tokens, so we can be more generous
        MAX_CONTENT_SIZE = 200000
        if len(content) > MAX_CONTENT_SIZE:
            logger.warning(f"Content too large ({len(content)} chars), truncating to {MAX_CONTENT_SIZE}")
            content = content[:MAX_CONTENT_SIZE]
            content += "\n\n... (content truncated due to size)"
        extraction_prompt = f"""Based on this analysis, extract all {use_case} relevant content from the document.

Analysis:
{analysis}

Document:
{content}

Extract only the sections, paragraphs, and content relevant to {use_case}.
Preserve structure and context. Remove navigation, marketing, and unrelated content.
Return the extracted content."""
        
        messages = [
            {'role': 'system', 'content': f'You are extracting {use_case} information from technical documents.'},
            {'role': 'user', 'content': extraction_prompt}
        ]
        
        try:
            extracted = self.llm_client.generate(messages)
            return extracted
        except Exception as e:
            import traceback
            logger.error(f"Extraction failed: {str(e) or type(e).__name__}")
            logger.debug(traceback.format_exc())
            # Fallback: return original content
            logger.warning("Falling back to original content")
            return content
