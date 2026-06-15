"""File analyzer module for Stage 1: Individual file analysis."""
import json
import os
import logging
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass
from tqdm import tqdm

logger = logging.getLogger(__name__)

from .llm_client import LLMClient
from .categories import FileCategories
from .file_scanner import DependencyFileManager
from .agent_prompts import (
    FILE_ANALYSIS_SYSTEM_PROMPT,
    FILE_ANALYSIS_USER_PROMPT_TEMPLATE,
    DEPENDENCY_ANALYSIS_SYSTEM_PROMPT,
    DEPENDENCY_ANALYSIS_USER_PROMPT_TEMPLATE,
    CATEGORIZATION_SYSTEM_PROMPT,
    CATEGORIZATION_USER_PROMPT_TEMPLATE
)
from .strategies.base_strategy import AnalysisStrategy, FileAnalysisContext
from .strategies.technical_doc_strategy import TechnicalDocAnalysisStrategy
from .chunking import ChunkerFactory
from .ast.provider import ProviderRegistry
from .ast.ctags_provider import CtagsProvider
from .ast.formatter import format_structural_output
from .ast.store import FileStore


class CodeAnalysisStrategy(AnalysisStrategy):
    """Strategy for analyzing code files."""
    
    def get_prompts(self, file_path: str, content: str, context: FileAnalysisContext) -> tuple:
        """Get prompts for code analysis."""
        user_prompt = FILE_ANALYSIS_USER_PROMPT_TEMPLATE.format(
            file_path=file_path,
            category=context.category,
            standard_file=context.standard_file,
            file_content=content
        )
        return (FILE_ANALYSIS_SYSTEM_PROMPT, user_prompt, 4000)
    
    def get_metadata(self, file_path: str, content: str, context: FileAnalysisContext) -> Dict:
        """Get metadata for code analysis."""
        return {
            'file_size_bytes': len(content)
        }


class DependencyAnalysisStrategy(AnalysisStrategy):
    """Strategy for analyzing dependency files."""
    
    def __init__(self, dependency_manager: DependencyFileManager):
        self.dependency_manager = dependency_manager
    
    def get_prompts(self, file_path: str, content: str, context: FileAnalysisContext) -> tuple:
        """Get prompts for dependency analysis."""
        file_name = Path(file_path).name
        file_type = self.dependency_manager.get_file_type(file_name)
        
        user_prompt = DEPENDENCY_ANALYSIS_USER_PROMPT_TEMPLATE.format(
            file_path=file_path,
            file_type=file_type,
            file_content=content
        )
        return (DEPENDENCY_ANALYSIS_SYSTEM_PROMPT, user_prompt, 3000)
    
    def get_metadata(self, file_path: str, content: str, context: FileAnalysisContext) -> Dict:
        """Get metadata for dependency analysis."""
        file_name = Path(file_path).name
        return {
            'ecosystem': self.dependency_manager.get_ecosystem(file_name),
            'purpose': self.dependency_manager.get_purpose(file_name),
            'file_type': self.dependency_manager.get_file_type(file_name)
        }


class FileAnalyzer:
    """Analyzes individual files to extract coding standards and patterns."""
    
    def __init__(self, llm_client: LLMClient, max_file_size_kb: int = 500, config_dir: str = "config"):
        """
        Initialize file analyzer.
        
        Args:
            llm_client: LLM client for analysis
            max_file_size_kb: Maximum file size to analyze in KB
            config_dir: Configuration directory path
        """
        self.llm_client = llm_client
        self.max_file_size_kb = max_file_size_kb
        self.max_file_size_bytes = max_file_size_kb * 1024
        self.dependency_manager = DependencyFileManager(Path(config_dir))
        self.chunker_factory = ChunkerFactory()  # Initialize chunking system

        # Structural analysis provider
        self._provider_registry = ProviderRegistry(
            config_path=str(Path(config_dir) / "analysis_providers.yaml")
        )
        ctags = CtagsProvider()
        if ctags.is_available():
            self._provider_registry.register(ctags)

        # Structural store
        self._file_store = self._init_file_store(config_dir)

        # Initialize strategies
        from .strategies.metamodel_strategy import MetamodelAnalysisStrategy
        self.strategies = {
            'code': CodeAnalysisStrategy(),
            'dependency': DependencyAnalysisStrategy(self.dependency_manager),
            'technical_doc': TechnicalDocAnalysisStrategy(llm_client),  # Pass llm_client for ContentExtractor
            'metamodel': MetamodelAnalysisStrategy(llm_client)
        }
    
    def _init_file_store(self, config_dir: str) -> Optional[FileStore]:
        """Initialize the structural file store from config."""
        store_config_path = Path(config_dir) / "structural_store.yaml"
        config = {}
        if store_config_path.exists():
            import yaml
            with open(store_config_path, encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
            config = raw.get("store", {})

        enabled = config.get("enabled", os.environ.get("AST_STORE_ENABLED", "true").lower() == "true")
        if not enabled:
            return None

        store_path = config.get("path", os.environ.get("AST_STORE_PATH", ".specforge/structural"))
        return FileStore(base_path=store_path, config=config)

    def register_strategy(self, name: str, strategy):
        """
        Register a new analysis strategy.
        
        Args:
            name: Strategy name (e.g., 'global_error_handling')
            strategy: Strategy instance implementing AnalysisStrategy interface
        """
        self.strategies[name] = strategy
        logger.info(f"Registered strategy: {name}")
    
    def analyze_file(self, context: FileAnalysisContext) -> Optional[Dict]:
        """
        Unified method to analyze any file type.
        Uses strategy pattern to handle different analysis types.
        
        Args:
            context: FileAnalysisContext with path, category, standard_file
            
        Returns:
            Analysis result as dictionary, or None if analysis failed
        """
        try:
            # Use structural content if available (set by analyze_batch),
            # otherwise read raw file content (current behavior)
            structural_content = getattr(context, '_structural_content', None)
            structural = getattr(context, '_structural_analysis', None)

            if structural_content:
                content = structural_content
                logger.info(f"Using structural data for {context.path} "
                           f"({len(content)} chars)")
            else:
                content = self._read_file(context.path)
                if content is None:
                    return None

            # Truncate if too large
            if len(content) > self.max_file_size_bytes:
                content = content[:self.max_file_size_bytes]
                content += "\n\n... (file truncated due to size)"

            # Check if chunking is needed — pass structural data for AST-aware chunking
            chunker = self.chunker_factory.get_chunker(
                context.path, content,
                structural_analysis=structural
            )
            if chunker.should_chunk(content):
                logger.info(f"File requires chunking: {context.path}")
                return self._analyze_with_chunking(context, content, chunker)
            
            # Select strategy based on category
            strategy = self._get_strategy(context.category)
            
            # Get prompts from strategy
            system_prompt, user_prompt, max_tokens = strategy.get_prompts(
                context.path, content, context
            )
            
            # Generate analysis
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
            
            try:
                response = self.llm_client.generate(messages)
                
                # Check for empty response
                if not response or len(response) == 0:
                    logger.error(f"LLM returned empty response for {context.path}")
                    logger.error(f"Message count: {len(messages)}, Total chars: {sum(len(m['content']) for m in messages)}")
                    logger.error(f"Max tokens requested: {max_tokens}")
                    print(f"[ERROR] LLM returned empty response for {context.path}")
                    return None
                    
            except Exception as e:
                logger.error(f"LLM generation failed for {context.path}: {type(e).__name__}: {str(e)}")
                logger.error(f"Message count: {len(messages)}, Total chars: {sum(len(m['content']) for m in messages)}")
                print(f"[ERROR] LLM generation failed for {context.path}: {type(e).__name__}: {str(e)}")
                return None
            
            # Parse JSON response
            analysis = self._parse_json_response(response)
            
            if analysis:
                # Add common metadata
                analysis['source_file'] = context.path
                analysis['category'] = context.category
                analysis['standard_file'] = context.standard_file
                analysis['structural_analysis_used'] = structural is not None

                # Add strategy-specific metadata
                strategy_metadata = strategy.get_metadata(context.path, content, context)
                analysis.update(strategy_metadata)
            
            return analysis
            
        except Exception as e:
            import traceback
            error_msg = f"Error analyzing file {context.path}: {str(e) or type(e).__name__}\n{traceback.format_exc()}"
            print(error_msg)
            logger.error(error_msg)
            return None
    
    def _analyze_with_chunking(self, context: FileAnalysisContext, content: str, chunker) -> Optional[Dict]:
        """
        Analyze file in chunks to avoid LLM timeouts.
        
        Args:
            context: File analysis context
            content: File content
            chunker: Chunker instance for this file type
            
        Returns:
            Merged analysis result or None if failed
        """
        try:
            # Create chunks
            chunk_result = chunker.chunk(content)
            logger.info(f"Split into {chunk_result.chunk_count} chunks")
            print(f"[INFO] Analyzing {chunk_result.chunk_count} chunks for {context.path}")
            
            # Analyze each chunk
            chunk_analyses = []
            for i, chunk in enumerate(chunk_result.chunks, 1):
                logger.info(f"Processing chunk {i}/{chunk_result.chunk_count}")
                print(f"[INFO] Processing chunk {i}/{chunk_result.chunk_count}")
                
                # Create temporary context for chunk
                chunk_context = FileAnalysisContext(
                    path=context.path,
                    category=context.category,
                    standard_file=context.standard_file
                )
                
                # Analyze chunk using normal flow
                analysis = self._analyze_single_chunk(chunk_context, chunk)
                if analysis:
                    chunk_analyses.append(analysis)
                else:
                    logger.warning(f"Chunk {i} analysis failed, continuing...")
            
            # Merge results
            if chunk_analyses:
                logger.info(f"Merging {len(chunk_analyses)} chunk results")
                merged = chunker.merge(chunk_analyses)
                
                # Add metadata
                merged['source_file'] = context.path
                merged['category'] = context.category
                merged['standard_file'] = context.standard_file
                merged['chunked'] = True
                merged['chunk_count'] = chunk_result.chunk_count
                merged['chunk_metadata'] = chunk_result.metadata
                
                print(f"[SUCCESS] Merged {len(chunk_analyses)} chunks for {context.path}")
                return merged
            else:
                logger.error(f"All chunks failed for {context.path}")
                return None
                
        except Exception as e:
            import traceback
            error_msg = f"Error in chunked analysis for {context.path}: {str(e)}\n{traceback.format_exc()}"
            logger.error(error_msg)
            print(f"[ERROR] {error_msg}")
            return None
    
    def _analyze_single_chunk(self, context: FileAnalysisContext, content: str) -> Optional[Dict]:
        """
        Analyze a single chunk of content.
        
        This is the core analysis logic extracted for reuse by chunking.
        """
        try:
            # Select strategy based on category
            strategy = self._get_strategy(context.category)
            
            # Get prompts from strategy
            system_prompt, user_prompt, max_tokens = strategy.get_prompts(
                context.path, content, context
            )
            
            # Generate analysis
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
            
            try:
                response = self.llm_client.generate(messages)
                
                # Check for empty response
                if not response or len(response) == 0:
                    logger.error(f"LLM returned empty response for {context.path}")
                    return None
                    
            except Exception as e:
                logger.error(f"LLM generation failed for {context.path}: {type(e).__name__}: {str(e)}")
                return None
            
            # Parse JSON response
            analysis = self._parse_json_response(response)
            return analysis
            
        except Exception as e:
            logger.error(f"Error in chunk analysis: {str(e)}")
            return None
    
    def _get_strategy(self, category: str) -> AnalysisStrategy:
        """Get appropriate analysis strategy for category."""
        if category == FileCategories.DEPENDENCY:
            return self.strategies['dependency']
        elif category == FileCategories.TECHNICAL_DOC:
            return self.strategies['technical_doc']
        else:
            return self.strategies['code']
    
    def analyze_batch(self, contexts: List[FileAnalysisContext],
                      show_progress: bool = True) -> List[Dict]:
        """
        Analyze a batch of files.

        Runs structural analysis (ctags) on all files in one batch call,
        then for each file: if structural data exists, the formatted structural
        output replaces raw code as the content passed to analyze_file.
        analyze_file doesn't know about structural analysis — it just gets content.

        Args:
            contexts: List of FileAnalysisContext objects
            show_progress: Whether to show progress bar

        Returns:
            List of analysis results
        """
        # Step 1: Structural analysis — one ctags subprocess for all files
        file_paths = [ctx.path for ctx in contexts]
        structural_results = self._provider_registry.analyze_batch(file_paths)
        if structural_results:
            logger.info(f"Structural analysis: {len(structural_results)} files indexed")

            # Persist to structural store and enrich with tree-sitter
            if self._file_store:
                try:
                    from .ast.pipeline import run_structural_pipeline
                    structural_results = run_structural_pipeline(
                        file_paths=file_paths,
                        ctags_results=structural_results,
                        store=self._file_store,
                        registry=self._provider_registry,
                    )
                except Exception as e:
                    logger.warning(f"Structural pipeline failed: {e}")

        # Step 2: For each file, transform content if structural data available
        results = []
        iterator = tqdm(contexts, desc="Analyzing files") if show_progress else contexts

        for context in iterator:
            structural = structural_results.get(context.path)
            if structural:
                formatted = format_structural_output(structural)
                if formatted:
                    context = self._with_structural_content(context, formatted, structural)

            analysis = self.analyze_file(context)
            if analysis:
                results.append(analysis)

        return results

    def _with_structural_content(self, context: FileAnalysisContext,
                                  formatted: str, structural) -> FileAnalysisContext:
        """Create a new context with structural content attached."""
        new_context = FileAnalysisContext(
            path=context.path,
            category=context.category,
            standard_file=context.standard_file,
        )
        new_context._structural_content = formatted
        new_context._structural_analysis = structural
        return new_context
    
    def categorize_file(self, file_path: str) -> Optional[Dict]:
        """
        Use LLM to categorize a file when rule-based categorization is uncertain.
        
        Args:
            file_path: Path to the file
            
        Returns:
            Categorization result with category, standard_file, and confidence
        """
        try:
            content = self._read_file(file_path)
            if content is None:
                return None
            
            # Truncate if too large
            if len(content) > self.max_file_size_bytes:
                content = content[:self.max_file_size_bytes]
            
            # Create prompt
            user_prompt = CATEGORIZATION_USER_PROMPT_TEMPLATE.format(
                file_path=file_path,
                file_content=content
            )
            
            messages = [
                {"role": "system", "content": CATEGORIZATION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ]
            
            # Generate categorization
            try:
                response = self.llm_client.generate(messages)
                
                # Check for empty response
                if not response or len(response) == 0:
                    logger.error(f"LLM returned empty response for categorization of {file_path}")
                    logger.error(f"Message count: {len(messages)}, Total chars: {sum(len(m['content']) for m in messages)}")
                    print(f"[ERROR] LLM returned empty response for categorization of {file_path}")
                    return None
                    
            except Exception as e:
                logger.error(f"LLM categorization failed for {file_path}: {type(e).__name__}: {str(e)}")
                print(f"[ERROR] LLM categorization failed for {file_path}: {type(e).__name__}: {str(e)}")
                return None
            
            # Parse JSON response
            result = self._parse_json_response(response)
            
            return result
            
        except Exception as e:
            print(f"Error categorizing file {file_path}: {e}")
            return None
    
    def save_analyses(self, analyses: List[Dict], output_dir: str):
        """
        Save analyses to staging directory, grouped by standard file.
        
        Args:
            analyses: List of analysis results
            output_dir: Output directory path
        """
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Group analyses by category and standard file
        grouped = {}
        
        for analysis in analyses:
            category = analysis.get('category', 'uncategorized')
            
            if category == FileCategories.DEPENDENCY:
                # Group dependency analyses separately
                key = 'dependency_tech_stack'
            else:
                # Group code analyses by standard file
                standard_file = analysis.get('standard_file', 'uncategorized')
                key = standard_file.replace('/', '_').replace('.md', '')
            
            if key not in grouped:
                grouped[key] = []
            grouped[key].append(analysis)
        
        # Save each group
        for group_name, group_analyses in grouped.items():
            output_file = output_path / f"{group_name}_analyses.json"
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(group_analyses, f, indent=2, ensure_ascii=False)
        
        print(f"Saved {len(analyses)} analyses to {output_dir}")
    
    def _read_file(self, file_path: str) -> Optional[str]:
        """Read file content safely."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except UnicodeDecodeError:
            # Try with different encoding
            try:
                with open(file_path, 'r', encoding='latin-1') as f:
                    return f.read()
            except Exception as e:
                print(f"Error reading file {file_path}: {e}")
                return None
        except Exception as e:
            print(f"Error reading file {file_path}: {e}")
            return None
    
    def _strip_markdown_code_fences(self, text: str) -> str:
        """Remove markdown code fences from text."""
        text = text.strip()
        
        # Handle ```json ... ```
        if text.startswith('```json'):
            text = text[7:]  # Remove ```json
            if text.endswith('```'):
                text = text[:-3]  # Remove closing ```
            return text.strip()
        
        # Handle ``` ... ```
        if text.startswith('```'):
            text = text[3:]  # Remove opening ```
            if text.endswith('```'):
                text = text[:-3]  # Remove closing ```
            return text.strip()
        
        return text
    
    def _parse_json_response(self, response: str) -> Optional[Dict]:
        """Parse JSON from LLM response, handling markdown code blocks and malformed JSON."""
        import re
        # Clean markdown code fences first
        cleaned_response = self._strip_markdown_code_fences(response)
        
        # Attempt 1: strict=False to handle control characters
        try:
            return json.loads(cleaned_response, strict=False)
        except json.JSONDecodeError:
            pass
        
        # Attempt 2: truncate at last valid closing brace
        # LLMs sometimes produce trailing garbage or unclosed strings
        last_brace = cleaned_response.rfind('}')
        if last_brace > 0:
            truncated = cleaned_response[:last_brace + 1]
            try:
                return json.loads(truncated, strict=False)
            except json.JSONDecodeError:
                pass
        
        # Attempt 3: repair common LLM JSON issues (unescaped quotes in strings)
        try:
            # Replace unescaped newlines/tabs inside strings, fix trailing commas
            repaired = re.sub(r',\s*([}\]])', r'\1', truncated if last_brace > 0 else cleaned_response)
            return json.loads(repaired, strict=False)
        except json.JSONDecodeError:
            pass
        
        # Attempt 4: extract first JSON object with balanced braces
        match = re.search(r'\{', cleaned_response)
        if match:
            depth = 0
            in_string = False
            escape = False
            start = match.start()
            for i in range(start, len(cleaned_response)):
                c = cleaned_response[i]
                if escape:
                    escape = False
                    continue
                if c == '\\':
                    escape = True
                    continue
                if c == '"' and not escape:
                    in_string = not in_string
                    continue
                if in_string:
                    continue
                if c == '{':
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0:
                        candidate = cleaned_response[start:i + 1]
                        try:
                            return json.loads(candidate, strict=False)
                        except json.JSONDecodeError:
                            break
        
        logger.error(f"JSON parsing failed after all attempts")
        logger.error(f"Response length: {len(cleaned_response)} chars")
        logger.error(f"Response preview (first 500 chars): {cleaned_response[:500]}")
        print(f"[ERROR] Failed to parse JSON response")
        print(f"Response length: {len(cleaned_response)} chars")
        print(f"Response preview (first 500 chars):")
        print(cleaned_response[:500])
        if len(cleaned_response) > 500:
            print(f"\n... (truncated, total length: {len(cleaned_response)} chars)")
        return None
