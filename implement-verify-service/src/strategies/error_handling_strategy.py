"""
Error Handling Strategy
Extracts error handling patterns from code and documentation using two-pass approach.
"""

from typing import Tuple
import logging

from .base_global_strategy import BaseGlobalStandardStrategy

logger = logging.getLogger(__name__)


class ErrorHandlingStrategy(BaseGlobalStandardStrategy):
    """
    Strategy for extracting error handling patterns from code and documentation.
    
    Pass 1: Analyzes code samples and documentation to understand:
    - Programming languages used
    - Existing error handling patterns
    - Documented guidelines
    
    Pass 2: Extracts patterns from all files guided by Pass 1 context.
    """
    
    def get_standard_name(self) -> str:
        """Return standard name for ContentExtractor and logging."""
        return 'error_handling'
    
    def get_context_analysis_prompt(self, code_samples: str, doc_content: str) -> str:
        """
        Pass 1: Analyze samples to build context.
        
        Args:
            code_samples: Sample code files (first 50 files, capped)
            doc_content: Filtered documentation content
            
        Returns:
            Prompt for LLM to analyze and build context
        """
        return f"""Analyze these code samples and documentation to understand error handling patterns.

CODE SAMPLES (first 50 files):
{code_samples if code_samples else "No code samples available"}

DOCUMENTATION (if provided):
{doc_content if doc_content else "No documentation provided"}

Your task:
1. **Detect ALL programming languages** present in the code samples
2. **For EACH language detected**, identify language-specific error handling patterns:
   - Exception/error handling syntax (e.g., try/catch, try/except, error callbacks)
   - Exception types and class hierarchies
   - Error propagation mechanisms (e.g., throws, raise, return errors)
   - Resource cleanup patterns (e.g., finally blocks, defer, using statements, context managers)
   - Custom exception/error classes
   
3. **Identify framework-specific patterns** (if applicable and present in the code)
4. **Identify custom error handling utilities/classes** (if present in the code)
5. **Note documented guidelines** (if provided in documentation)

IMPORTANT RULES:
- Only describe what you observe in the samples
- Do not assume frameworks or libraries unless you see imports or usage
- Do not suggest patterns that don't exist in the samples
- Provide language-specific context for each detected language
- Focus on patterns that appear consistently across files

Your analysis will be used to guide extraction from all files in the codebase.
Provide a comprehensive context profile that includes language-specific syntax and patterns."""
    
    def get_extraction_prompts(self, file_path: str, content: str, 
                               is_documentation: bool) -> Tuple[str, str]:
        """
        Pass 2: Extract patterns guided by context.
        
        Args:
            file_path: Path to file being analyzed
            content: File content
            is_documentation: True if documentation, False if code
            
        Returns:
            (system_prompt, user_prompt)
        """
        if is_documentation:
            # For documentation, extract documented patterns
            system_prompt = """You are extracting error handling patterns from technical documentation.

Extract only patterns that are explicitly mentioned in the document.
Do not infer or assume patterns that are not clearly stated."""
            
            user_prompt = f"""Extract error handling patterns from this documentation.

CONTEXT FROM ANALYSIS:
{self.context}

DOCUMENT: {file_path}

CONTENT:
{content}

Extract patterns in JSON format:
{{
  "patterns": [
    {{
      "type": "exception_handling|logging|recovery|custom_exceptions|...",
      "description": "Clear description of the pattern",
      "example": "Code example if provided",
      "guidelines": "Any guidelines or best practices mentioned"
    }}
  ]
}}

RULES:
- Only extract patterns explicitly mentioned in the document
- Do not assume or infer patterns
- Provide specific examples when available
- If no error handling patterns found, return empty array []

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        else:
            # For code, extract actual patterns from implementation
            system_prompt = """You are extracting error handling patterns from code.

Extract only patterns that exist in the code.
Do not infer or suggest patterns that are not present."""
            
            user_prompt = f"""Extract error handling patterns from this code file.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

FILE: {file_path}

CODE:
{content}

EXPECTED OUTPUT FORMAT (from templates/standards/global/error-handling.md):
The final standard document should contain high-level principles like:
- **User-Friendly Messages**: Provide clear, actionable error messages to users without exposing technical details
- **Fail Fast and Explicitly**: Validate input and check preconditions early; fail with clear error messages
- **Specific Exception Types**: Use specific exception/error types rather than generic ones
- **Centralized Error Handling**: Handle errors at appropriate boundaries rather than scattering try-catch everywhere
- **Graceful Degradation**: Design systems to degrade gracefully when non-critical services fail
- **Retry Strategies**: Implement exponential backoff for transient failures
- **Clean Up Resources**: Always clean up resources in finally blocks or equivalent

Your task:
1. **Identify the programming language** of this file
2. **Extract ONLY patterns that match the template style** - high-level principles, not implementation details
3. **Extract ONLY if this file demonstrates a company-specific implementation** of a principle
4. **Return empty array [] if file only shows standard practices**

Extract patterns in JSON format:
{{
  "language": "Python|Java|JavaScript|TypeScript|...",
  "patterns": [
    {{
      "type": "principle_name_from_template",
      "description": "Brief 1-sentence description matching template style",
      "code_example": "ONLY include if implementation is company-specific (2-5 lines)",
      "line_numbers": [10, 15]
    }}
  ]
}}

CRITICAL RULES:
- **Return empty array [] for 95% of files** - Most files show standard practices only
- **Extract MAXIMUM 0-1 patterns per file**
- **Match template style**: High-level principles, not "this file uses try/catch"
- **Code examples ONLY for company-specific implementations** - omit field otherwise
- **When in doubt, return []**

EXAMPLES OF WHAT TO EXTRACT (VERY RARE):
✓ Custom error class "PathNotAllowedError" that enforces company security policy
✓ Standardized error response format unique to this company: {{success, error, code, details}}
✓ Custom retry strategy with company-specific backoff algorithm
✓ Company-specific error monitoring/tracking integration

EXAMPLES OF WHAT TO SKIP (95% OF CASES):
✗ Standard try/catch blocks
✗ Standard error logging
✗ Standard HTTP status codes
✗ Generic error utilities
✗ Standard exception types
✗ Standard finally blocks
✗ Standard null checks
✗ Standard error propagation

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json)."""
        
        return (system_prompt, user_prompt)
