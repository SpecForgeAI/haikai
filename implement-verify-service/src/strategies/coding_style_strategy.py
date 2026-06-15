"""
Coding Style Strategy
Extracts coding style patterns from code and documentation using two-pass approach.
"""

from typing import Tuple
import logging

from .base_global_strategy import BaseGlobalStandardStrategy

logger = logging.getLogger(__name__)


class CodingStyleStrategy(BaseGlobalStandardStrategy):
    """
    Strategy for extracting coding style patterns from code and documentation.
    
    Pass 1: Analyzes code samples and documentation to understand:
    - Programming languages used
    - Existing style patterns
    - Documented style guidelines
    
    Pass 2: Extracts patterns from all files guided by Pass 1 context.
    """
    
    def get_standard_name(self) -> str:
        """Return standard name for ContentExtractor and logging."""
        return 'coding_style'
    
    def get_context_analysis_prompt(self, code_samples: str, doc_content: str) -> str:
        """
        Pass 1: Analyze samples to build context.
        
        Args:
            code_samples: Sample code files (first 50 files, capped)
            doc_content: Filtered documentation content
            
        Returns:
            Prompt for LLM to analyze and build context
        """
        return f"""Analyze these code samples and documentation to understand coding style patterns.

CODE SAMPLES (first 50 files):
{code_samples if code_samples else "No code samples available"}

DOCUMENTATION (if provided):
{doc_content if doc_content else "No documentation provided"}

Your task:
1. **Detect ALL programming languages** present in the code samples
2. **For EACH language detected**, identify language-specific coding style patterns:
   - Naming conventions (e.g., camelCase, snake_case, PascalCase for variables, functions, classes)
   - Indentation style (spaces vs tabs, indent size)
   - Code formatting (brace placement, line length, spacing)
   - Comment style (inline, block, docstrings, JSDoc, JavaDoc)
   - Import/include organization
   - File structure and organization patterns
   
3. **Identify project-specific style patterns** (if present in the code)
4. **Note documented style guidelines** (if provided in documentation)
5. **Identify style enforcement tools** (e.g., linters, formatters like ESLint, Prettier, Black, Checkstyle)

IMPORTANT RULES:
- Only describe what you observe in the samples
- Do not assume style guides (e.g., PEP 8, Google Style Guide) unless explicitly referenced
- Do not suggest patterns that don't exist in the samples
- Provide language-specific context for each detected language
- Focus on patterns that appear consistently across files

Your analysis will be used to guide extraction from all files in the codebase.
Provide a comprehensive context profile that includes language-specific style patterns."""
    
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
            system_prompt = """You are extracting coding style guidelines from technical documentation.

Extract only guidelines that are explicitly mentioned in the document.
Do not infer or assume guidelines that are not clearly stated."""
            
            user_prompt = f"""Extract coding style guidelines from this documentation.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

DOCUMENT: {file_path}

CONTENT:
{content}

Extract guidelines in JSON format:
{{
  "guidelines": [
    {{
      "category": "naming|formatting|comments|imports|structure|...",
      "description": "Clear description of the guideline",
      "example": "Code example if provided",
      "rationale": "Reason or explanation if mentioned"
    }}
  ]
}}

RULES:
- Only extract guidelines explicitly mentioned in the document
- Do not assume or infer guidelines
- Provide specific examples when available
- If no .* found, return empty array []

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        else:
            # For code, extract actual style patterns from implementation
            system_prompt = """You are extracting coding style patterns from code.

Extract only patterns that exist in the code.
Do not infer or suggest patterns that are not present."""
            
            user_prompt = f"""Extract coding style patterns from this code file.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

FILE: {file_path}

CODE:
{content}

Your task:
1. **Identify the programming language** of this file
2. **Extract ONLY company-specific or distinctive coding style patterns**
3. **Focus on high-level style decisions**, not syntax details
4. **Skip standard language conventions** (e.g., camelCase in JS, snake_case in Python)

Extract patterns in JSON format:
{{
  "language": "Python|Java|JavaScript|C#|...",
  "patterns": [
    {{
      "category": "custom_conventions|documentation_style|file_organization|...",
      "description": "Brief 1-sentence description of the pattern",
      "code_example": "Small code snippet (2-5 lines) - ONLY if pattern is company-specific",
      "line_numbers": [10, 15]
    }}
  ]
}}

CRITICAL RULES - READ CAREFULLY:
- **Return empty array [] for 95% of files** - Most files follow standard conventions
- **Extract MAXIMUM 0-1 patterns per file** (not 3-5)
- **When in doubt, skip it** - Only extract if it's genuinely unique to this company
- **Code examples ONLY for truly unique patterns** - omit "code_example" field otherwise
- **Keep descriptions to 1 sentence MAX**
- **Default to empty array []** unless you find something genuinely company-specific

EXPECTED OUTPUT FORMAT (from templates/standards/global/coding-style.md):
The final standard document should contain high-level principles like:
- Consistent Naming Conventions: Establish and follow naming conventions across the codebase
- Automated Formatting: Maintain consistent code style
- Meaningful Names: Choose descriptive names that reveal intent
- Small, Focused Functions: Keep functions small and focused
- Remove Dead Code: Delete unused code
- DRY Principle: Avoid duplication

EXAMPLES OF WHAT TO EXTRACT (EXTREMELY RARE - 2% of files):
✓ Custom JSDoc tags enforcing company security review
✓ Unique emoji-based logging convention used company-wide
✓ Company-specific file naming enforced by tooling

EXAMPLES OF WHAT TO SKIP (98% OF CASES):
✗ Standard naming conventions
✗ Standard indentation
✗ Standard brace styles
✗ Standard JSDoc/docstrings
✗ Standard imports
✗ Standard comments
✗ Standard file organization
✗ Standard language conventions

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        return (system_prompt, user_prompt)
