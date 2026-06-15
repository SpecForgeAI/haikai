"""
Validation Strategy
Extracts validation patterns from code and documentation using two-pass approach.
"""

from typing import Tuple
import logging

from .base_global_strategy import BaseGlobalStandardStrategy

logger = logging.getLogger(__name__)


class ValidationStrategy(BaseGlobalStandardStrategy):
    """
    Strategy for extracting validation patterns from code and documentation.
    
    Pass 1: Analyzes code samples and documentation to understand:
    - Programming languages used
    - Existing validation patterns
    - Documented guidelines
    
    Pass 2: Extracts patterns from all files guided by Pass 1 context.
    """
    
    def get_standard_name(self) -> str:
        """Return standard name for ContentExtractor and logging."""
        return 'validation'
    
    def get_context_analysis_prompt(self, code_samples: str, doc_content: str) -> str:
        """
        Pass 1: Analyze samples to build context.
        
        Args:
            code_samples: Sample code files (first 50 files, capped)
            doc_content: Filtered documentation content
            
        Returns:
            Prompt for LLM to analyze and build context
        """
        return f"""Analyze these code samples and documentation to understand validation patterns.

CODE SAMPLES (first 50 files):
{code_samples if code_samples else "No code samples available"}

DOCUMENTATION (if provided):
{doc_content if doc_content else "No documentation provided"}

Your task:
1. **Detect ALL programming languages** present in the code samples
2. **For EACH language detected**, identify language-specific validation patterns:
   - Input validation mechanisms (e.g., type checking, schema validation, sanitization)
   - Data validation libraries and frameworks
   - Validation decorators, annotations, or attributes
   - Custom validation functions or classes
   - Validation error handling and reporting
   
3. **Identify framework-specific validation** (if applicable and present in the code)
4. **Identify custom validation utilities/classes** (if present in the code)
5. **Note documented validation guidelines** (if provided in documentation)

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
            system_prompt = """You are extracting validation patterns from technical documentation.

Extract only patterns that are explicitly mentioned in the document.
Do not infer or assume patterns that are not clearly stated."""
            
            user_prompt = f"""Extract validation patterns from this documentation.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

DOCUMENT: {file_path}

CONTENT:
{content}

Extract patterns in JSON format:
{{
  "patterns": [
    {{
      "type": "input_validation|schema_validation|type_checking|sanitization|...",
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
- If no .* found, return empty array []

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        else:
            # For code, extract actual patterns from implementation
            system_prompt = """You are extracting validation patterns from code.

Extract only patterns that exist in the code.
Do not infer or suggest patterns that are not present."""
            
            user_prompt = f"""Extract validation patterns from this code file.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

FILE: {file_path}

CODE:
{content}

Your task:
1. **Identify the programming language** of this file
2. **Extract ONLY company-specific or non-standard validation patterns**
3. **Focus on high-level architectural patterns**, not syntax details
4. **Skip standard best practices** (e.g., basic null checks, type guards)

Extract patterns in JSON format:
{{
  "language": "Python|Java|JavaScript|C#|...",
  "patterns": [
    {{
      "type": "custom_validators|validation_framework|schema_format|...",
      "description": "Brief 1-sentence description of the pattern",
      "code_example": "Small code snippet (2-5 lines) - ONLY if pattern is company-specific",
      "line_numbers": [10, 15]
    }}
  ]
}}

RULES:
- **Extract ONLY 3-5 most significant patterns per file** (not every validation check)
- **Skip standard practices**: basic null/undefined checks, simple type guards, standard regex
- **Focus on company-specific patterns**: custom validation libraries, unique schema formats, specialized validators
- **Code examples ONLY for non-standard patterns** - omit "code_example" field for standard practices
- **Keep descriptions to 1 sentence** - what the pattern does, not why
- **If no significant patterns found, return empty array []**

EXAMPLES OF WHAT TO EXTRACT:
✓ Custom validation decorator/annotation systems
✓ Company-specific schema validation formats
✓ Specialized input sanitization utilities
✓ Custom validation error response structures

EXAMPLES OF WHAT TO SKIP:
✗ Basic null/undefined checks (if (!x), x == null)
✗ Standard type guards (typeof x === 'string')
✗ Common regex patterns (email, URL validation)
✗ Standard library validation (zod, joi, yup with default usage)

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        return (system_prompt, user_prompt)
