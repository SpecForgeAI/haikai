"""
Commenting Strategy
Extracts commenting and documentation standards from code using two-pass approach.
"""

from typing import Tuple
import logging

from .base_global_strategy import BaseGlobalStandardStrategy

logger = logging.getLogger(__name__)


class CommentingStrategy(BaseGlobalStandardStrategy):
    """
    Strategy for extracting commenting and documentation standards from code.
    
    Pass 1: Analyzes code samples and documentation to understand:
    - Comment styles used (inline, block, docstrings)
    - Documentation patterns
    - Header/file-level comments
    
    Pass 2: Extracts patterns from all files guided by Pass 1 context.
    """
    
    def get_standard_name(self) -> str:
        """Return standard name for ContentExtractor and logging."""
        return 'commenting'
    
    def get_context_analysis_prompt(self, code_samples: str, doc_content: str) -> str:
        """
        Pass 1: Analyze samples to build context.
        
        Args:
            code_samples: Sample code files (first 50 files, capped)
            doc_content: Filtered documentation content
            
        Returns:
            Prompt for LLM to analyze and build context
        """
        return f"""Analyze these code samples and documentation to understand commenting and documentation standards.

CODE SAMPLES (first 50 files):
{code_samples if code_samples else "No code samples available"}

DOCUMENTATION (if provided):
{doc_content if doc_content else "No documentation provided"}

Your task:
1. **Detect ALL programming languages** present in the code samples
2. **For EACH language detected**, identify commenting patterns:
   - File/module header comments (copyright, license, description)
   - Class/interface documentation style
   - Function/method documentation (docstrings, JSDoc, Javadoc, etc.)
   - Inline comment conventions
   - TODO/FIXME/NOTE comment patterns
   - API documentation patterns
   
3. **Identify documentation tools used** (Sphinx, JSDoc, Javadoc, etc.)
4. **Note what gets documented vs what doesn't**
5. **Identify any documented commenting guidelines**

IMPORTANT RULES:
- Only describe what you observe in the samples
- Do not assume patterns unless you see them consistently
- Do not suggest standards that don't exist in the samples
- Provide language-specific context for each detected language
- Focus on patterns that appear consistently across files

Your analysis will be used to guide extraction from all files in the codebase.
Provide a comprehensive context profile that includes language-specific commenting patterns."""
    
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
            # For documentation, extract documented commenting standards
            system_prompt = """You are extracting commenting and documentation standards from technical documentation.

Extract only standards that are explicitly mentioned in the document.
Do not infer or assume standards that are not clearly stated."""
            
            user_prompt = f"""Extract commenting and documentation standards from this documentation.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

DOCUMENT: {file_path}

CONTENT:
{content}

Extract standards in JSON format:
{{
  "commenting_standards": [
    {{
      "category": "file_headers|docstrings|inline|todos|api_docs|...",
      "description": "Clear description of the standard",
      "example": "Example if provided",
      "rationale": "Reason or explanation if mentioned"
    }}
  ]
}}

RULES:
- Only extract standards explicitly mentioned in the document
- Do not assume or infer standards
- Provide specific examples when available
- If no standards found, return empty array []

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        else:
            # For code, extract actual commenting patterns from implementation
            system_prompt = """You are extracting commenting and documentation patterns from code.

Extract only patterns that exist in the code.
Do not infer or suggest patterns that are not present."""
            
            user_prompt = f"""Extract commenting and documentation patterns from this code file.

CONTEXT FROM PASS 1 ANALYSIS:
{self.context}

FILE: {file_path}

CODE:
{content}

Your task:
1. **Identify the programming language** of this file
2. **Extract commenting and documentation patterns**
3. **Focus on consistent patterns**, not one-off comments

Extract patterns in JSON format:
{{
  "language": "Python|Java|JavaScript|C#|...",
  "commenting_patterns": [
    {{
      "category": "file_header|class_doc|function_doc|inline|todo|...",
      "description": "Brief 1-sentence description of the pattern",
      "example": "Small example (2-5 lines)",
      "line_numbers": [10, 15]
    }}
  ]
}}

RULES:
- **Extract ONLY 3-5 most significant patterns per file**
- **Focus on project-specific patterns**: custom docstring formats, unique header styles
- **Skip standard patterns**: basic single-line comments, obvious code explanations
- **Keep descriptions to 1 sentence**
- **If no distinctive patterns found, return empty array []**

EXAMPLES OF WHAT TO EXTRACT:
✓ Custom docstring formats
✓ File header templates (copyright, author, etc.)
✓ API documentation patterns
✓ TODO/FIXME conventions with assignees or ticket numbers

EXAMPLES OF WHAT TO SKIP:
✗ Basic inline comments explaining obvious code
✗ Standard language docstrings without customization
✗ Commented-out code

IMPORTANT: Return ONLY the raw JSON object. Do NOT wrap it in markdown code blocks (```json). Do NOT add any explanatory text before or after the JSON."""
        
        return (system_prompt, user_prompt)
