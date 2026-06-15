"""
Conventions Strategy
Extracts coding conventions from code and documentation using two-pass approach.
"""

from typing import Tuple
import logging

from .base_global_strategy import BaseGlobalStandardStrategy

logger = logging.getLogger(__name__)


class ConventionsStrategy(BaseGlobalStandardStrategy):
    """
    Strategy for extracting coding conventions from code and documentation.
    
    Pass 1: Analyzes code samples and documentation to understand:
    - Programming languages used
    - Existing conventions
    - Documented convention guidelines
    
    Pass 2: Extracts patterns from all files guided by Pass 1 context.
    """
    
    def get_standard_name(self) -> str:
        """Return standard name for ContentExtractor and logging."""
        return 'conventions'
    
    def get_context_analysis_prompt(self, code_samples: str, doc_content: str) -> str:
        """
        Pass 1: Analyze samples to build context.
        
        Args:
            code_samples: Sample code files (first 50 files, capped)
            doc_content: Filtered documentation content
            
        Returns:
            Prompt for LLM to analyze and build context
        """
        return f"""Analyze these code samples and documentation to understand coding conventions.

CODE SAMPLES (first 50 files):
{code_samples if code_samples else "No code samples available"}

DOCUMENTATION (if provided):
{doc_content if doc_content else "No documentation provided"}

Your task:
1. **Detect ALL programming languages** present in the code samples
2. **For EACH language detected**, identify language-specific coding conventions:
   - Project structure conventions (directory layout, file organization)
   - Module/package organization patterns
   - Class and interface design patterns
   - Function/method design patterns (parameter ordering, return conventions)
   - Constant and configuration management
   - Logging and debugging conventions
   - Testing conventions (test file naming, test structure)
   - API design conventions (REST, GraphQL, RPC patterns)
   
3. **Identify framework-specific conventions** (if applicable and present in the code)
4. **Identify project-specific conventions** (if present in the code)
5. **Note documented convention guidelines** (if provided in documentation)

IMPORTANT RULES:
- Only describe what you observe in the samples
- Do not assume conventions unless you see consistent patterns
- Do not suggest conventions that don't exist in the samples
- Provide language-specific context for each detected language
- Focus on patterns that appear consistently across files
- Distinguish between conventions (project-wide patterns) and style (formatting)

Your analysis will be used to guide extraction from all files in the codebase.
Provide a comprehensive context profile that includes language-specific convention patterns."""
    
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
            system_prompt = """You are extracting coding conventions from technical documentation.

Extract only conventions that are explicitly mentioned in the document.
Do not infer or assume conventions that are not clearly stated."""
            
            user_prompt = f"""Extract coding conventions from this documentation.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

DOCUMENT: {file_path}

CONTENT:
{content}

Extract conventions in JSON format:
{{
  "conventions": [
    {{
      "category": "structure|organization|design|api|testing|logging|...",
      "description": "Clear description of the convention",
      "example": "Code example if provided",
      "rationale": "Reason or explanation if mentioned"
    }}
  ]
}}

RULES:
- Only extract conventions explicitly mentioned in the document
- Do not assume or infer conventions
- Provide specific examples when available
- If no .* found, return empty array []

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        else:
            # For code, extract actual convention patterns from implementation
            system_prompt = """You are extracting coding conventions from code.

Extract only conventions that exist in the code.
Do not infer or suggest conventions that are not present."""
            
            user_prompt = f"""Extract coding conventions from this code file.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

FILE: {file_path}

CODE:
{content}

Your task:
1. **Identify the programming language** of this file
2. **Extract ONLY company-specific or distinctive conventions**
3. **Focus on high-level architectural conventions**, not implementation details
4. **Skip standard patterns** (e.g., common design patterns, standard project structures)

Extract conventions in JSON format:
{{
  "language": "Python|Java|JavaScript|C#|...",
  "conventions": [
    {{
      "category": "custom_patterns|api_design|project_structure|...",
      "description": "Brief 1-sentence description of the convention",
      "code_example": "Small code snippet (2-5 lines) - ONLY if convention is company-specific",
      "line_numbers": [10, 15]
    }}
  ]
}}

RULES:
- **Extract ONLY 3-5 most significant conventions per file** (not every pattern)
- **Skip standard patterns**: common design patterns (singleton, factory), standard REST conventions, typical file structures
- **Focus on company-specific conventions**: unique API patterns, custom project organization, specialized architectural decisions
- **Code examples ONLY for non-standard conventions** - omit "code_example" field for standard practices
- **Keep descriptions to 1 sentence** - what the convention is, not why
- **If no distinctive conventions found, return empty array []**

EXAMPLES OF WHAT TO EXTRACT:
✓ Custom API response/request formats
✓ Company-specific module organization patterns
✓ Unique dependency injection approaches
✓ Specialized testing conventions

EXAMPLES OF WHAT TO SKIP:
✗ Standard design patterns (singleton, factory, observer)
✗ Common REST API conventions (GET/POST/PUT/DELETE)
✗ Typical MVC/MVVM structures
✗ Standard testing patterns (arrange-act-assert)

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        return (system_prompt, user_prompt)
