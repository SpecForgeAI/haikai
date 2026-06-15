"""
Main standards_orchestrator module that coordinates the standards extraction process.
"""
import os
import json
import logging
import subprocess
import shutil
import stat
import re
import requests
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Path-segment safety helpers live in src/path_safety.py — single source of
# truth across the codebase. Re-export the names this module already used.
from .path_safety import safe_segment as _safe_segment  # noqa: E402, F401
from .path_safety import check_no_traversal as _check_no_traversal  # noqa: E402, F401


def _owner_in_allowlist(owner: str) -> bool:
    """True if `owner` matches the operator-configured allowlist.

    Operators set `STANDARDS_GITHUB_OWNER_ALLOWLIST` to a comma-separated
    list of github owner names whose repos may be cloned with the
    server's `GITHUB_TOKEN`. Default is empty (no owner allowed) — i.e.
    the token is NEVER attached to a user-supplied URL unless the
    operator explicitly opts in. This prevents an authenticated API
    caller from using the server's token to clone arbitrary private
    repos. See autoresearch:debug 260504-1448 finding M2.

    Empty allowlist → return False → anonymous clone (public repos
    only). Operators who want the prior behavior can set
    `STANDARDS_GITHUB_OWNER_ALLOWLIST=*` to allow all owners.
    """
    allowlist = os.getenv("STANDARDS_GITHUB_OWNER_ALLOWLIST", "").strip()
    if not allowlist:
        return False
    if allowlist == "*":
        return True
    allowed = {x.strip().lower() for x in allowlist.split(",") if x.strip()}
    return owner.lower() in allowed


from .file_scanner import FileScanner
from .categories import FileCategories
from .repo_fetcher import RepositoryFetcher
from .llm_client import LLMClient
from .file_analyzer import FileAnalyzer
from .strategies.base_strategy import FileAnalysisContext
from .standards_synthesizer import StandardsSynthesizer
from .report_generator import ReportGenerator
from .technical_doc_repository import TechnicalDocRepository
from .content_extractor import ContentExtractor
from .metamodel_gateway import MetamodelGateway
from .strategies.error_handling_strategy import ErrorHandlingStrategy
from .strategies.validation_strategy import ValidationStrategy
from .strategies.coding_style_strategy import CodingStyleStrategy
from .strategies.conventions_strategy import ConventionsStrategy
from .strategies.commenting_strategy import CommentingStrategy
from .strategies.ast_analysis_strategy import AstAnalysisStrategy
from .strategies.tech_stack_synthesis_strategy import (
    ProductTechStackStrategy,
    GlobalTechStackStrategy,
    DependencyProvider,
    MetamodelProvider,
    GlobalStandardProvider
)

class StandardsOrchestrator:
    """Main standards_orchestrator for the standards extraction process."""
    
    def __init__(self, config: Dict):
        """
        Initialize the standards extractor.
        
        Args:
            config: Configuration dictionary
        """
        self.config = config
        self.mode = config.get('mode', 'create_global_standards')
        
        # Initialize components
        self.file_scanner = FileScanner(config_dir=config.get('config_dir', 'config'))
        
        self.repo_fetcher = RepositoryFetcher(
            github_token=config.get('github_token')
        )
        
        # LLM Provider Configuration - NO FALLBACKS
        llm_provider = config.get('llm_provider')
        llm_model = config.get('llm_model')
        
        if not llm_provider:
            raise ValueError(
                "LLM_PROVIDER is required for standards generation. "
                "Set LLM_PROVIDER environment variable (e.g., 'anthropic', 'openai')."
            )
        
        if not llm_model:
            raise ValueError(
                "LLM_MODEL is required for standards generation. "
                "Set LLM_MODEL environment variable to a model that matches "
                "LLM_PROVIDER (e.g., 'claude-sonnet-4-6' for anthropic, "
                "'gpt-5.4-mini' for openai)."
            )
        
        # Get API key for the configured provider
        if llm_provider == 'anthropic':
            llm_api_key = config.get('anthropic_api_key')
            if not llm_api_key:
                raise ValueError(
                    "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic. "
                    "Set ANTHROPIC_API_KEY environment variable."
                )
        elif llm_provider == 'openai':
            llm_api_key = config.get('openai_api_key')
            if not llm_api_key:
                raise ValueError(
                    "OPENAI_API_KEY is required when LLM_PROVIDER=openai. "
                    "Set OPENAI_API_KEY environment variable."
                )
        elif llm_provider == 'custom':
            # Local proxies (e.g. claude-code via http://localhost:3456/v1)
            # don't require a real key — LLMClient defaults to 'dummy-key'
            # via os.getenv('CUSTOM_API_KEY', 'dummy-key'). Keep that path.
            llm_api_key = config.get('llm_api_key') or 'dummy-key'
        else:
            llm_api_key = config.get('llm_api_key')
            if not llm_api_key:
                raise ValueError(
                    f"API key required for LLM_PROVIDER={llm_provider}. "
                    "Set the appropriate API key environment variable."
                )

        # provider=custom requires a base_url. Sourcing from config first,
        # env LLM_BASE_URL second — same shape as build_llm_client. Without
        # this, custom-provider runs raised "Custom provider requires
        # 'base_url' parameter" inside LLMClient.__init__.
        llm_kwargs = {}
        if llm_provider == 'custom':
            base_url = config.get('llm_base_url') or os.environ.get('LLM_BASE_URL')
            if not base_url:
                raise ValueError(
                    "provider='custom' requires LLM_BASE_URL env var or "
                    "llm_base_url in config (no code-level default)"
                )
            llm_kwargs['base_url'] = base_url

        self.llm_client = LLMClient(
            provider=llm_provider,
            model=llm_model,
            api_key=llm_api_key,
            **llm_kwargs,
        )
        
        # Setup directories based on mode. Reject `..` traversal in
        # config-supplied paths; absolute paths are still allowed (legitimate
        # for CLI use with explicit destinations).
        self.base_output_dir = Path(config.get('output_dir', 'standards'))
        _check_no_traversal(self.base_output_dir, "output_dir")
        self.global_dir = Path(config.get('global_dir', 'standards')) if config.get('global_dir') else None
        if self.global_dir is not None:
            _check_no_traversal(self.global_dir, "global_dir")
        
        if self.mode == 'generate_product_standards':
            # Product: {project_dir}/haikai/product/*.md
            self.output_dir = self.base_output_dir / 'haikai' / 'product'
            self.staging_dir = self.base_output_dir / 'staging'
            self.standards_dir = self.output_dir
        elif self.mode == 'generate_global_standards':
            # Global: {global_dir}/haikai/standards/global/*.md
            self.output_dir = self.base_output_dir / 'haikai' / 'standards' / 'global'
            self.staging_dir = self.base_output_dir / 'staging'
            self.standards_dir = self.output_dir
            # Also create profiles directory for tech-stack.md compatibility
            self.profiles_standards_dir = self.base_output_dir / 'haikai' / 'profiles' / 'default' / 'standards' / 'global'
        else:
            # Metamodel or other modes: use base directory
            self.output_dir = self.base_output_dir
            self.staging_dir = self.base_output_dir / 'staging'
            self.standards_dir = self.output_dir
        
        self.staging_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.file_analyzer = FileAnalyzer(self.llm_client)
        self.standards_synthesizer = StandardsSynthesizer(self.llm_client)
        self.report_generator = ReportGenerator(str(self.output_dir))
        self.tech_doc_repository = TechnicalDocRepository(str(self.staging_dir))
        self.content_extractor = ContentExtractor(self.llm_client)
        # MetamodelGateway writes to {base_output_dir}/metamodel/architecture.json
        self.metamodel_gateway = MetamodelGateway(self.base_output_dir)
        
        # Cache for global standards context
        self.global_context_cache = {}
        
        # Technical documents to process
        self.tech_docs = config.get('technical_documents', {})

    @staticmethod
    def _atomic_write_text(path: Path, content: str) -> None:
        """Write `content` to `path` atomically.

        Two simultaneous standards-generate calls for the same project
        would race on the output files (tech-stack.md etc) — without
        atomicity a reader could see a half-written file. Write to a
        sibling temp + os.replace (which is atomic on POSIX and
        Windows-as-of-Vista). Track: debug/260504-* finding S3.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        # mkstemp in same dir so os.replace stays on the same filesystem
        # (cross-fs replace is not atomic).
        import os
        import tempfile
        fd, tmp_name = tempfile.mkstemp(
            dir=str(path.parent),
            prefix=f".{path.name}.",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)
            os.replace(tmp_name, path)
        except Exception:
            # Clean up the temp file on write failure
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise

    def create_product_standards(self, sources: List[str], recursive: bool = True) -> List[Path]:
        """
        Create product-level technical standards.

        When `sources` is non-empty, runs the structural analysis pipeline
        (ctags + tree-sitter, optional LLM interpretation) over the supplied
        paths. When `sources` is empty, synthesizes from upstream artifacts:
        - {project_dir}/metamodel/architecture.json (if present)
        - {global_dir}/haikai/standards/global/tech-stack.md (baseline)
        Falls through to the shipped baseline template if neither exists.

        Writes to: {project_dir}/haikai/product/tech-stack.md
        """
        logger.info("=" * 60)
        logger.info("Generating Product Tech Standards")
        logger.info("=" * 60)
        logger.info(f"Output directory: {self.output_dir}")

        if sources:
            # The `sources` and `recursive` params were previously logged but
            # never read — callers that passed source paths got the same
            # metamodel/global-baseline output as callers that passed none.
            # Route through run_structural so real code analysis happens.
            logger.info(f"Source paths: {sources} — routing through structural analysis")
            results = self.run_structural(sources=sources, recursive=recursive)
            logger.info("Product Tech Standards Generation Completed!")
            return [Path(p) for p in results.values()]

        # No sources: synthesize from metamodel + global baseline (or shipped
        # template if neither is present).
        #
        # Re-raise on synthesis failure so the caller (OperationExecutor)
        # can mark the OperationResponse as success=False with the error
        # detail. Previously this swallowed the exception and returned [],
        # which propagated upstream as success=True with empty outputs --
        # the v2 endpoint then committed the empty result to a feature
        # branch and opened a PR with no content. Track:
        # debug/260504-* "Standards endpoint silent failure" finding S1.
        results = self._synthesize_standards(is_product_mode=True)

        logger.info("Product Tech Standards Generation Completed!")

        # Convert dict of paths to list of Path objects
        output_paths = [Path(p) for p in results.values()] if isinstance(results, dict) else []
        return output_paths

    def get_metamodel(self, metamodel_id: str) -> Path:
        """Get metamodel from external system and persist."""
        logger.info(f"Fetching metamodel: {metamodel_id}")
        persisted_path = self.metamodel_gateway.get_and_persist(metamodel_id)
        logger.info(f"✓ Metamodel persisted to: {persisted_path}")
        return persisted_path

    def run_structural(self, sources: List[str] = None, recursive: bool = True,
                        deterministic_only: bool = False) -> Dict[str, str]:
        """
        Run standards extraction using ctags + tree-sitter structural analysis.
        
        Replaces the legacy file-by-file LLM approach with:
        1. ctags + tree-sitter extraction (seconds, not minutes)
        2. Framework detection + complexity triage
        3. Structural output → LLM interpretation (only complex files)
        4. Synthesis into standard files
        
        Args:
            sources: List of source directories
            recursive: Whether to scan directories recursively
            deterministic_only: If True, zero LLM calls — pure structural output
            
        Returns:
            Dictionary mapping standard file names to their output paths
        """
        from pathlib import Path as _Path
        from .ast.ctags_provider import CtagsProvider
        from .ast.treesitter_provider import TreeSitterProvider
        from .ast.provider import ProviderRegistry
        from .ast.formatter import format_structural_output
        from .strategies.ast_analysis_strategy import AstAnalysisStrategy

        sources = sources or []
        logger.info(f"{'='*60}")
        logger.info(f"Standards Extraction (Structural Mode)")
        logger.info(f"{'='*60}\n")
        logger.info(f"Sources: {', '.join(sources)}")
        logger.info(f"Output: {self.output_dir}")
        logger.info(f"Deterministic: {deterministic_only}\n")

        # Stage 1: Collect source files
        logger.info(f"[Stage 1] Collecting source files...")
        all_source_files = []
        for source in sources:
            p = _Path(source)
            if p.is_file():
                all_source_files.append(str(p))
            elif p.is_dir():
                pattern = '**/*' if recursive else '*'
                for f in sorted(p.glob(pattern)):
                    if f.is_file() and f.suffix in {
                        '.py', '.pyi', '.js', '.jsx', '.ts', '.tsx',
                        '.java', '.go', '.rs', '.c', '.h',
                        '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.cs',
                    } and '__pycache__' not in str(f) and 'node_modules' not in str(f):
                        all_source_files.append(str(f))
        logger.info(f"✓ Found {len(all_source_files)} source files\n")

        if not all_source_files:
            logger.info(f"No source files found.")
            return {}

        # Stage 2: Structural extraction (ctags + tree-sitter)
        logger.info(f"[Stage 2] Running ctags + tree-sitter extraction...")
        import time
        t0 = time.time()
        ctags = CtagsProvider()
        ts = TreeSitterProvider()
        registry = ProviderRegistry()

        ctags_results = ctags.analyze_batch(all_source_files)
        ts_results = ts.analyze_batch(all_source_files)
        merged = registry._merge_results(ctags_results, ts_results)
        t_extract = time.time() - t0

        total_symbols = sum(len(a.symbols) for a in merged.values())
        total_calls = sum(len(a.calls or []) for a in merged.values())
        logger.info(f"✓ Extracted {total_symbols} symbols, {total_calls} calls in {t_extract:.2f}s\n")

        # Stage 3: Build strategy + triage
        logger.info(f"[Stage 3] Framework detection + triage...")
        strategy = AstAnalysisStrategy(
            llm_client=self.llm_client if not deterministic_only else None,
            content_extractor=None,
            deterministic_only=deterministic_only,
        )
        ctx = strategy.build_context_from_structural(merged)
        skip_files, analyze_files = strategy.triage_files(merged)
        logger.info(f"✓ Frameworks: {ctx.frameworks}")
        logger.info(f"  Triage: {len(skip_files)} skip, {len(analyze_files)} analyze\n")

        # Stage 4: LLM interpretation of complex files (or skip if deterministic)
        interpretations = []
        if not deterministic_only and self.llm_client and analyze_files:
            logger.info(f"[Stage 4] LLM interpretation of {len(analyze_files)} complex files...")
            for f in sorted(analyze_files):
                if f not in merged:
                    continue
                structural_content = format_structural_output(merged[f])
                system, user = strategy.get_extraction_prompts(f, structural_content, False)
                try:
                    result = self.llm_client.generate([
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ])
                    interpretations.append({"file": f, "analysis": result})
                    logger.info(f"  ✓ {_Path(f).name}")
                except Exception as e:
                    logger.info(f"  ✗ {_Path(f).name}: {e}")
        else:
            logger.info(f"[Stage 4] Skipped (deterministic mode)")

        # Stage 5: Synthesize all standards
        logger.info(f"\n[Stage 5] Synthesizing standards...")
        results = {}

        # Generate the structural analysis standard
        full_doc = strategy.synthesize(self.llm_client, interpretations) if not deterministic_only else strategy.synthesize_deterministic(merged)
        structural_path = self.standards_dir / 'structural-analysis.md'
        self._atomic_write_text(structural_path, full_doc)
        results['structural-analysis.md'] = str(structural_path)

        # Generate per-standard files using structural context
        standard_names = ['coding-style', 'conventions', 'error-handling', 'validation', 'commenting']
        deterministic_sections = strategy.build_deterministic_sections(merged)

        for std_name in standard_names:
            logger.info(f"  Synthesizing {std_name}.md...")
            if deterministic_only:
                # Generate from structural data only
                content = self._synthesize_standard_from_structure(std_name, deterministic_sections, ctx)
            else:
                # Use LLM with structural context
                content = self._synthesize_standard_with_llm(std_name, deterministic_sections, ctx, interpretations)

            output_path = self.standards_dir / f'{std_name}.md'
            self._atomic_write_text(output_path, content)
            results[f'{std_name}.md'] = str(output_path)

        # Tech stack from structural data
        logger.info(f"  Synthesizing tech-stack.md...")
        tech_stack_content = self._synthesize_tech_stack_from_structure(ctx, deterministic_sections, merged)
        tech_stack_path = self.standards_dir / 'tech-stack.md'
        self._atomic_write_text(tech_stack_path, tech_stack_content)
        results['tech-stack.md'] = str(tech_stack_path)

        total_time = time.time() - t0
        logger.info(f"\n✓ Generated {len(results)} standards in {total_time:.1f}s")
        return results

    def _synthesize_standard_from_structure(self, standard_name: str, sections: dict, ctx) -> str:
        """Generate a standard document from structural data only — no LLM."""
        from .ast.framework_detector import detect_frameworks
        lines = [f"## {standard_name.replace('-', ' ').title()} Standards\n"]
        lines.append(f"*Generated from structural analysis of {sections['total_symbols']} symbols across the codebase.*\n")

        if standard_name == 'coding-style':
            lines.append("### Detected Patterns\n")
            for practice in sections.get('baseline_practices', []):
                lines.append(f"- {practice}")
            lines.append(f"\n### Symbol Distribution\n- {sections['symbol_breakdown']}")
        elif standard_name == 'conventions':
            lines.append("### Project Structure\n")
            lines.append(f"- Languages: {', '.join(ctx.languages)}")
            lines.append(f"- Frameworks: {', '.join(ctx.frameworks)}")
            lines.append(f"\n### Import Patterns\n")
            for mod, count in sections.get('top_imports', [])[:10]:
                lines.append(f"- `{mod}`: {count} files")
        elif standard_name == 'error-handling':
            lines.append("### Call Graph Insights\n")
            for callee, count in sections.get('top_callees', [])[:10]:
                if 'error' in callee.lower() or 'exception' in callee.lower() or 'throw' in callee.lower() or 'catch' in callee.lower() or 'log' in callee.lower():
                    lines.append(f"- `{callee}`: {count} calls")
        elif standard_name == 'validation':
            lines.append("### Validation Patterns\n")
            for callee, count in sections.get('top_callees', [])[:15]:
                if 'valid' in callee.lower() or 'check' in callee.lower() or 'assert' in callee.lower() or 'verify' in callee.lower():
                    lines.append(f"- `{callee}`: {count} calls")
        elif standard_name == 'commenting':
            lines.append("### Code Documentation\n")
            lines.append(f"- Total symbols: {sections['total_symbols']}")
            lines.append(f"- Inheritance chains: {sections['inheritance_count']}")

        lines.append("")
        return "\n".join(lines)

    def _synthesize_standard_with_llm(self, standard_name: str, sections: dict, ctx, interpretations: list) -> str:
        """Generate a standard document using LLM with structural context."""
        system = (
            f"You are a technical architect writing {standard_name} standards.\n"
            f"You are working from pre-parsed structural analysis — not raw code.\n"
            f"The codebase uses: {', '.join(ctx.frameworks) if ctx.frameworks else 'no detected frameworks'}.\n"
            f"Languages: {', '.join(ctx.languages)}.\n"
            f"Write a concise, actionable {standard_name} standards document in Markdown."
        )

        user_parts = [
            f"Structural summary: {sections['total_symbols']} symbols, "
            f"{sections['total_calls']} calls, {sections['inheritance_count']} inheritance chains.",
            f"\nTop imports:\n{sections['top_imports_text']}",
            f"\nCall hotspots:\n{sections['call_hotspots_text']}",
            f"\nInheritance:\n{sections['inheritance_trees_text']}",
        ]

        if interpretations:
            user_parts.append(f"\nLLM interpretations from {len(interpretations)} complex files:")
            for interp in interpretations[:5]:
                user_parts.append(f"\n--- {interp['file']} ---\n{interp['analysis'][:500]}")

        user_parts.append(f"\nGenerate a {standard_name} standards document based on this data.")

        try:
            return self.llm_client.generate([
                {"role": "system", "content": system},
                {"role": "user", "content": "\n".join(user_parts)},
            ])
        except Exception as e:
            logger.error(f"LLM synthesis failed for {standard_name}: {e}")
            return self._synthesize_standard_from_structure(standard_name, sections, ctx)

    def _synthesize_tech_stack_from_structure(self, ctx, sections: dict, merged: dict) -> str:
        """Generate tech-stack.md from structural analysis."""
        from .ast.framework_detector import detect_frameworks, detect_languages
        frameworks = detect_frameworks(merged)
        languages = detect_languages(merged)

        lines = ["# Tech Stack\n"]
        lines.append("## Languages\n")
        for lang, count in languages:
            lines.append(f"- **{lang}**: {count} files")

        lines.append("\n## Frameworks & Libraries\n")
        if frameworks:
            for fw in frameworks:
                lines.append(f"- **{fw.name}** ({fw.category}) — {fw.import_count} files, confidence {fw.confidence}")
        else:
            lines.append("- No frameworks detected")

        lines.append("\n## Key Dependencies\n")
        for mod, count in sections.get('top_imports', [])[:15]:
            lines.append(f"- `{mod}`: {count} files")

        if not (ctx.frameworks or []) and self.llm_client:
            # If no frameworks detected, try LLM interpretation
            try:
                result = self.llm_client.generate([
                    {"role": "system", "content": "Generate a tech-stack document from structural data."},
                    {"role": "user", "content": "\n".join(lines)},
                ])
                return result
            except Exception:
                pass

        lines.append("")
        return "\n".join(lines)

    def run(self, sources: List[str] = None, recursive: bool = True) -> Dict[str, str]:
        """
        Run the full standards extraction process (legacy file-by-file approach).
        
        See run_structural() for the newer ctags + tree-sitter based approach.
        
        Args:
            sources: List of source directories or repository URLs
            recursive: Whether to scan directories recursively
            
        Returns:
            Dictionary mapping standard file names to their output paths
        """
        sources = sources or []
        logger.info(f"{'='*60}")
        logger.info(f"Standards Extraction Process")
        logger.info(f"{'='*60}\n")
        
        logger.info(f"Mode: {self.mode}")
        logger.info(f"Sources: {', '.join(sources)}")
        logger.info(f"Output Directory: {self.output_dir}\n")

        processed_docs = 0

        # Split sources into local paths, repo URLs, and doc URLs
        local_paths, repo_urls, doc_urls = self._split_sources(sources)

        # Treat doc URLs from `sources` as technical documents for ALL categories
        if doc_urls:
            logger.info(
                f"[Stage 0A] Processing URL sources as technical documents (all categories)...")
            expanded = self._expand_urls_to_all_tech_doc_categories(doc_urls)
            processed_from_sources = self._ingest_technical_documents(expanded)
            logger.info(
                f"✓ Processed {processed_from_sources} URL sources as technical documents\n")

        sources = local_paths + repo_urls

        # Stage 0: Process technical documents (if provided)
        if self.tech_docs:
            logger.info(f"[Stage 0] Processing technical documents...")
            
            # Handle metamodel persistence first if provided
            metamodel_files = self.tech_docs.get('metamodel', [])
            project_id = self.config.get('metamodel_get_architecture')
            
            if metamodel_files:
                for metamodel_file in metamodel_files:
                    self.metamodel_gateway.fetch_and_persist(file_path=metamodel_file)
            elif project_id:
                self.metamodel_gateway.fetch_and_persist(project_id=project_id)
            
            processed_docs = self._ingest_technical_documents(self.tech_docs)
            logger.info(f"✓ Processed {processed_docs} technical documents\n")
        
        # Stage 1: Scan and categorize source code files
        logger.info(f"[Stage 1] Scanning and categorizing source code...")
        all_files = self._scan_all_sources(sources, recursive)
        
        file_count = sum(len(files) for files in all_files.values())
        if file_count > 0:
            logger.info(f"✓ Found {file_count} source code files across {len(all_files)} categories\n")
        else:
            logger.info(f"✓ No source code files found (technical documents only)\n")
        
        # Check if we have any work to do (either source files or technical documents)
        has_technical_docs = self.tech_docs and processed_docs > 0
        if file_count == 0 and not has_technical_docs:
            logger.info(f"No relevant files or technical documents to analyze. Exiting.")
            return {}
        
        # Skip source code analysis if no source files (but continue to synthesis for technical docs)
        if file_count == 0:
            all_analyses = {}
        else:
            # Stage 2: Analyze source code files
            logger.info(f"[Stage 2] Analyzing source code files...")
            global_standards = self._get_global_standards_to_extract()
            all_analyses = self._analyze_files(all_files, global_standards)
            logger.info(f"✓ Completed analysis of {len(all_analyses)} source code files\n")
        
        # Stage 3: Synthesize standards from all analyses (technical documents + source code)
        logger.info(f"[Stage 3] Synthesizing standards from all analyses...")
        results = self._synthesize_standards()
        logger.info(f"✓ Synthesized {len(results)} standard files\n")
        
        # Stage 4: Generate report
        logger.info(f"[Stage 4] Generating final report...")
        report_path = self.report_generator.generate_summary(results, self.output_dir)
        results['REPORT.md'] = str(report_path)
        logger.info(f"✓ Final report generated at: {report_path}\n")
        
        return results

    def _ingest_technical_documents(self, tech_docs: Dict[str, List[str]]) -> int:
        """Process technical documents and store them in the repository."""
        count = 0
        for category, urls in tech_docs.items():
            if category == 'metamodel': continue # Handled separately
            
            for url in urls:
                try:
                    # Get standard file name for this category
                    standard_file = self._get_standard_for_tech_doc(category)
                    
                    # Download and parse the document
                    logger.info(f"Processing technical document: {url}")
                    processed_docs = self.tech_doc_repository.ingest_technical_documents([url])
                    
                    if not processed_docs:
                        logger.error(f"Failed to process document: {url}")
                        continue
                    
                    # Read parsed content
                    parsed_path = processed_docs[0]['parsed']
                    with open(parsed_path, 'r', encoding='utf-8') as f:
                        parsed_content = f.read()
                    
                    # Extract relevant content using ContentExtractor
                    content = self.content_extractor.extract(
                        parsed_content=parsed_content,
                        use_case=category  # Use category as use_case (e.g., 'tech_stack', 'coding_style')
                    )
                    if not content:
                        logger.warning(f"No {category} content extracted from {url} - document may not contain relevant {category} information")
                        continue
                    if content:
                        # Create context with parsed file path (not URL)
                        context = FileAnalysisContext(
                            path=parsed_path,  # Use local parsed file path, not URL
                            category=FileCategories.TECHNICAL_DOC,
                            standard_file=standard_file
                        )
                        
                        # Analyze (FileAnalyzer will read from parsed_path)
                        analysis = self.file_analyzer.analyze_file(context)
                        if analysis:
                            # Save analysis to staging
                            analysis_file = self.staging_dir / f"{category}_analyses.json"
                            
                            # Load existing or create new
                            existing = []
                            if analysis_file.exists():
                                with open(analysis_file, 'r', encoding='utf-8') as f:
                                    existing = json.load(f)
                            
                            existing.append(analysis)
                            with open(analysis_file, 'w', encoding='utf-8') as f:
                                json.dump(existing, f, indent=2)
                            
                            count += 1
                except Exception as e:
                    logger.error(f"Error processing technical document {url}: {e}")
        return count

    def _get_standard_for_tech_doc(self, category: str) -> str:
        """Map technical document category to standard file."""
        mapping = {
            'tech_stack': 'global/tech-stack.md',
            'error_handling': 'global/error-handling.md',
            'validation': 'global/validation.md',
            'coding_style': 'global/coding-style.md',
            'conventions': 'global/conventions.md',
            'commenting': 'global/commenting.md',
            'metamodel': 'global/tech-stack.md'
        }
        return mapping.get(category, 'global/general.md')

    def _scan_all_sources(self, sources: List[str], recursive: bool) -> Dict[str, List[str]]:
        """Scan all sources and categorize files."""
        all_files = {}
        
        for source in sources:
            if self._is_url(source):
                files = self._scan_remote_repository(source, recursive)
            else:
                files = self._scan_local_directory(source, recursive)
            
            # Merge results
            for category, paths in files.items():
                if category not in all_files:
                    all_files[category] = []
                all_files[category].extend(paths)
        
        return all_files

    def _scan_local_directory(self, path: str, recursive: bool) -> Dict[str, List[str]]:
        """Scan a local directory or file and categorize files."""
        path_obj = Path(path)
        
        # Check if path exists
        if not path_obj.exists():
            raise ValueError(f"Path does not exist: {path}")
        
        # Handle single file
        if path_obj.is_file():
            categorized_files = FileCategories.get_empty_dict()
            
            # Check if file should be included
            if self.file_scanner.should_include_file(str(path_obj)):
                # Categorize the file
                if self.file_scanner.is_dependency_file(str(path_obj)):
                    category = FileCategories.DEPENDENCY
                else:
                    category = self.file_scanner.categorize_file(str(path_obj))
                
                categorized_files[category].append(str(path_obj.absolute()))
            
            return categorized_files
        
        # Handle directory
        return self.file_scanner.scan(path, recursive)

    def _scan_remote_repository(self, source: str, recursive: bool) -> Dict[str, List[str]]:
        """Scan a remote repository by cloning it to a temporary directory."""
        # Parse URL to get platform, owner, repo, branch, and path
        platform, owner, repo, branch, path, is_file = self.repo_fetcher.parse_repo_url(source)

        # Validate URL-derived segments BEFORE joining into a filesystem path.
        # parse_repo_url uses `[^/]+` which allows `..` — combined with the
        # `shutil.rmtree(temp_dir)` below, a URL like
        # `https://github.com/..%2Fetc/passwd` would let an attacker delete
        # adjacent directories under `staging_dir/temp/`.
        platform = _safe_segment(platform, "platform")
        owner = _safe_segment(owner, "owner")
        repo = _safe_segment(repo, "repo")

        # Create a unique temporary directory for this repository
        temp_dir = self.staging_dir / 'temp' / platform / owner / repo
        if path:
            # `path` is the URL-supplied path-within-repo. Reject `..` so the
            # final temp_dir can't escape staging_dir even via this segment.
            if ".." in Path(path).parts:
                raise ValueError(f"path may not contain '..': {path!r}")
            temp_dir = temp_dir / path.replace('/', os.sep)

        # Defense in depth: assert the resolved path stays under staging_dir.
        try:
            temp_dir.resolve().relative_to(self.staging_dir.resolve())
        except ValueError:
            raise ValueError(f"temp_dir would escape staging_dir: {temp_dir}")
            
        # Clone or download
        if not path or '/blob/' in source:
            # Single file or root
            if '/blob/' in source:
                # Single file
                file_path = path
                local_path = temp_dir / file_path
                local_path.parent.mkdir(parents=True, exist_ok=True)
                if self.file_scanner.should_include_file(file_path):
                    content = self.repo_fetcher.fetch_file_content(source, file_path)
                    if content:
                        with open(local_path, 'w', encoding='utf-8') as f:
                            f.write(content)
            else:
                # Root or directory - use clone
                self._clone_repository(platform, owner, repo, branch, path, temp_dir)
        else:
            # Directory path provided
            self._clone_repository(platform, owner, repo, branch, path, temp_dir)
        
        return self._scan_local_directory(str(temp_dir), recursive)

    def _clone_repository(self, platform: str, owner: str, repo: str, 
                         branch: str, path: str, temp_dir: Path) -> None:
        """Clone a repository using git."""
        # Clean up existing directory if it exists
        if temp_dir.exists():
            logger.info(f"Cleaning up existing directory: {temp_dir}")
            
            def remove_readonly(func, path, excinfo):
                os.chmod(path, stat.S_IWRITE)
                func(path)
                
            shutil.rmtree(temp_dir, onerror=remove_readonly)
            
        temp_dir.parent.mkdir(parents=True, exist_ok=True)
        
        # Build clone URL. The server's GITHUB_TOKEN is only applied when
        # the owner is on the operator-configured allowlist
        # (STANDARDS_GITHUB_OWNER_ALLOWLIST, comma-separated owner names).
        # Without this, a user-supplied URL pointed at any private repo
        # the token has scope for would clone with that auth — letting
        # API users access content the operator never intended to expose.
        # See autoresearch:debug 260504-1448 finding M2.
        github_token = self.config.get('github_token')
        if platform == 'github' and github_token and _owner_in_allowlist(owner):
            clone_url = f"https://{github_token}@github.com/{owner}/{repo}.git"
        elif platform == 'github':
            clone_url = f"https://github.com/{owner}/{repo}.git"
        else:
            clone_url = f"https://gitlab.com/{owner}/{repo}.git"
        clone_args = ['git', 'clone', '--depth', '1']
        if branch:
            clone_args.extend(['--branch', branch])
        # `--` blocks argv-injection if clone_url ever starts with `-` (the
        # gitlab fallback returns the constructed URL but a future provider
        # branch could pass through user input).
        clone_args.extend(['--', clone_url, str(temp_dir)])

        # Public-facing identifier for error messages — strip embedded
        # token from clone_url so a TimeoutExpired/CalledProcessError
        # repr can never leak the credential to API clients.
        # See autoresearch:debug 260504-1448 finding M1.
        public_url = f"https://github.com/{owner}/{repo}.git" if platform == 'github' else clone_url
        try:
            subprocess.run(
                clone_args,
                check=True,
                capture_output=True,
                text=True,
                # cp1252 default on Windows crashes on UTF-8 output (commit
                # messages, branch names in non-Latin scripts).
                encoding='utf-8',
                errors='replace',
                # 5-minute cap so a slow remote doesn't hang the pipeline
                # forever. Matches structural_endpoints._clone_repo.
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            # Note: do NOT include `clone_url` (embeds the token) — the
            # public_url is safe to surface.
            raise RuntimeError(f"git clone timed out after 300s for {public_url}")
        except subprocess.CalledProcessError as e:
            # git's stderr usually doesn't include the auth_url (it
            # references "https://github.com" without userinfo), but we
            # still scrub defensively in case a future git version does.
            stderr = (e.stderr or "").strip()
            if github_token:
                stderr = stderr.replace(github_token, "<REDACTED>")
            raise RuntimeError(f"git clone failed (exit {e.returncode}) for {public_url}: {stderr}")

    def _is_url(self, source: str) -> bool:
        """Check if source is a URL."""
        return source.startswith(('http://', 'https://', 'git@'))

    def _get_global_standards_to_extract(self) -> List[str]:
        """Get list of global standards to extract."""
        return self.config.get('global_standards', ['tech-stack', 'error-handling', 'validation', 'coding-style', 'conventions', 'commenting'])

    def _build_global_standards_context(self, all_files: Dict[str, List[str]], standards: List[str]) -> None:
        """Build context for global standards."""
        for standard in standards:
            logger.info(f"Building context for global standard: {standard}")
            context = self.standards_synthesizer.build_global_context(all_files, standard)
            self.global_context_cache[standard.replace('-', '_')] = context

    def _analyze_files(self, all_files: Dict[str, List[str]], global_standards: List[str]) -> List[Dict]:
        """Analyze categorized files."""
        all_analyses = []
        
        for category, file_paths in all_files.items():
            if category == FileCategories.TECHNICAL_DOC: continue
            
            logger.info(f"  Analyzing {category} files...")
            for file_path in file_paths:
                # Determine which standard this file contributes to
                standard_file = self._get_standard_for_file(category, file_path)
                
                # Create context
                context = FileAnalysisContext(
                    path=file_path,
                    category=category,
                    standard_file=standard_file
                )
                
                # Analyze
                analysis = self.file_analyzer.analyze_file(context)
                if analysis:
                    # Save analysis to staging
                    analysis_file = self.staging_dir / f"{category}_analyses.json"
                    
                    # Load existing or create new
                    existing = []
                    if analysis_file.exists():
                        with open(analysis_file, 'r', encoding='utf-8') as f:
                            existing = json.load(f)
                    
                    existing.append(analysis)
                    with open(analysis_file, 'w', encoding='utf-8') as f:
                        json.dump(existing, f, indent=2)
                    
                    all_analyses.append(analysis)
        
        return all_analyses

    def _get_standard_for_file(self, category: str, file_path: str) -> str:
        """Determine which standard file a source file contributes to."""
        if category == FileCategories.DEPENDENCY:
            return 'global/tech-stack.md'
        
        # For code files, we might want to be more specific, but for now:
        return 'global/general.md'

    def _synthesize_standards(self, is_product_mode: bool = False) -> Dict[str, str]:
        """Synthesize final standard files from analyses."""
        results = {}
        
        # 1. Tech Stack Synthesis (Special handling for Strategy Pattern)
        results.update(self._synthesize_tech_stack(is_product_mode))
        
        # Skip other standards if in product mode
        if is_product_mode:
            return results
            
        # 2. Other Standards Synthesis
        other_standards = [
            ('error_handling', 'error-handling.md', ErrorHandlingStrategy(self.llm_client, self.content_extractor)),
            ('validation', 'validation.md', ValidationStrategy(self.llm_client, self.content_extractor)),
            ('coding_style', 'coding-style.md', CodingStyleStrategy(self.llm_client, self.content_extractor)),
            ('conventions', 'conventions.md', ConventionsStrategy(self.llm_client, self.content_extractor)),
            ('commenting', 'commenting.md', CommentingStrategy(self.llm_client, self.content_extractor)),
        ]

        # Add structural analysis strategy if enabled
        ast_enabled = os.environ.get('AST_ANALYSIS_ENABLED', 'false').lower() == 'true'
        deterministic_only = os.environ.get('AST_ANALYSIS_DETERMINISTIC_ONLY', 'false').lower() == 'true'
        if ast_enabled:
            ast_strategy = AstAnalysisStrategy(
                self.llm_client, self.content_extractor,
                deterministic_only=deterministic_only,
            )
            other_standards.append(
                ('structural_analysis', 'structural-analysis.md', ast_strategy)
            )
        
        for category, output_file, strategy in other_standards:
            logger.info(f"  Synthesizing {output_file}...")
            
            # Load analyses
            analyses = []
            analysis_file = self.staging_dir / f"{category}_analyses.json"
            if analysis_file.exists():
                with open(analysis_file, 'r', encoding='utf-8') as f:
                    analyses = json.load(f)
            
            if analyses:
                content = self.standards_synthesizer.execute_synthesis_strategy(strategy, analyses)
                output_path = self.standards_dir / output_file
                output_path.parent.mkdir(parents=True, exist_ok=True)
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                results[output_file] = str(output_path)
            else:
                # Fallback: Use template when no analyses available
                logger.info(f"No analyses found for {category}, using template as baseline")
                template_content = self.standards_synthesizer.load_template(f'global/{output_file}')
                if template_content:
                    output_path = self.standards_dir / output_file
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, 'w', encoding='utf-8') as f:
                        f.write(template_content)
                    results[output_file] = str(output_path)
                    logger.info(f"Created {output_file} from template")
        
        return results

    def _synthesize_tech_stack(self, is_product_mode: bool) -> Dict[str, str]:
        """Synthesize tech stack using Strategy Pattern."""
        results = {}
        providers = []
        output_path = self.output_dir
        
        # Load analyses from staging
        dependency_file = self.staging_dir / 'dependency_analyses.json'
        metamodel_file = self.staging_dir / 'metamodel_analyses.json'
        
        # Add Dependency Provider
        if dependency_file.exists():
            with open(dependency_file, 'r', encoding='utf-8') as f:
                providers.append(DependencyProvider(json.load(f)))
        
        # Add Metamodel Provider
        metamodel_analyses = []
        if metamodel_file.exists():
            with open(metamodel_file, 'r', encoding='utf-8') as f:
                metamodel_analyses = json.load(f)
        
        # Check local metamodel if in product mode
        if not metamodel_analyses and is_product_mode:
            # Metamodel is at {project_dir}/metamodel/architecture.json
            local_arch_file = self.base_output_dir / 'metamodel' / 'architecture.json'
            if local_arch_file.exists():
                context = FileAnalysisContext(path=str(local_arch_file), category=FileCategories.METAMODEL, standard_file='global/tech-stack.md')
                analysis = self.file_analyzer.analyze_file(context)
                if analysis: metamodel_analyses = [analysis]
        
        if metamodel_analyses:
            providers.append(MetamodelProvider(metamodel_analyses))
            
        # Execute Strategy
        if is_product_mode:
            # Strategy: Product Tech-Stack (Precedence: Metamodel > Global Baseline)
            # Global standards are at {global_dir}/haikai/standards/global/tech-stack.md
            if self.global_dir:
                global_tech_stack_path = self.global_dir / 'haikai' / 'standards' / 'global' / 'tech-stack.md'
            else:
                global_tech_stack_path = None
            
            if global_tech_stack_path and global_tech_stack_path.exists():
                with open(global_tech_stack_path, 'r', encoding='utf-8') as f:
                    providers.append(GlobalStandardProvider(f.read(), precedence=0))
            else:
                template = self.standards_synthesizer.load_template('global/tech-stack.md')
                providers.append(GlobalStandardProvider(template, precedence=0))
            
            strategy = ProductTechStackStrategy()
            synthesized_doc = self.standards_synthesizer.execute_synthesis_strategy(strategy, providers)
            
            # output_dir already points to {project_dir}/haikai/product
            product_file = output_path / 'tech-stack.md'
            product_file.parent.mkdir(parents=True, exist_ok=True)
            with open(product_file, 'w', encoding='utf-8') as f:
                f.write(synthesized_doc)
            results['product/tech-stack.md'] = str(product_file)
        else:
            # Strategy: Global Tech-Stack (Standard merge)
            strategy = GlobalTechStackStrategy()
            synthesized_doc = self.standards_synthesizer.execute_synthesis_strategy(strategy, providers)
            
            # output_dir now points to {global_dir}/haikai/standards/global
            global_file = output_path / 'tech-stack.md'
            global_file.parent.mkdir(parents=True, exist_ok=True)
            with open(global_file, 'w', encoding='utf-8') as f:
                f.write(synthesized_doc)
            results['global/tech-stack.md'] = str(global_file)
            
            # Also copy tech-stack.md to profiles directory for Haikai compatibility
            if hasattr(self, 'profiles_standards_dir'):
                import shutil
                profiles_file = self.profiles_standards_dir / 'tech-stack.md'
                profiles_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(global_file, profiles_file)
                results['profiles/global/tech-stack.md'] = str(profiles_file)
                logger.info(f"Copied tech-stack.md to profiles directory: {profiles_file}")
            
        return results

    def _is_repo_url(self, url: str) -> bool:
        """
        Determine if URL is a repository root (to be cloned) vs a file/directory.
        Returns True only for repo roots that should be git cloned.
        """
        if url.startswith("git@"):
            return True
        try:
            host = urlparse(url).netloc.lower()
            path = urlparse(url).path
        except Exception:
            return False
        
        if host not in {"github.com", "gitlab.com", "bitbucket.org"}:
            return False
        
        # URLs with /blob/, /raw/, /tree/ are NOT repo roots
        if any(indicator in path for indicator in ['/blob/', '/raw/', '/tree/', '/-/blob/', '/-/raw/', '/-/tree/']):
            return False
        
        # Plain repo URL (e.g., github.com/org/repo) - treat as repo
        return True

    def _is_file_url(self, url: str) -> bool:
        """Check if URL points to a specific file (has extension in last path segment)."""
        try:
            path = urlparse(url).path.rstrip('/')
            last_segment = path.split('/')[-1]
            return '.' in last_segment and not last_segment.startswith('.')
        except Exception:
            return False

    def _is_github_directory_url(self, url: str) -> bool:
        """Check if URL is a GitHub directory URL (blob/tree without file extension)."""
        try:
            host = urlparse(url).netloc.lower()
            path = urlparse(url).path
            if host != 'github.com':
                return False
            if '/blob/' in path or '/tree/' in path:
                return not self._is_file_url(url)
            return False
        except Exception:
            return False

    def _expand_github_directory(self, url: str) -> List[str]:
        """
        Expand a GitHub directory URL to individual file URLs using GitHub API.
        Returns list of raw file URLs for markdown/text files in the directory.
        """
        try:
            # Parse GitHub URL: https://github.com/owner/repo/blob/branch/path or /tree/branch/path
            pattern = r'https://github\.com/([^/]+)/([^/]+)/(blob|tree)/([^/]+)/(.+?)/?$'
            match = re.match(pattern, url)
            if not match:
                logger.warning(f"Could not parse GitHub directory URL: {url}")
                return []
            
            owner, repo, url_type, branch, path = match.groups()
            path = path.rstrip('/')
            
            # Use GitHub API to list directory contents
            api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}"
            logger.info(f"Fetching directory contents from GitHub API: {api_url}")
            
            response = requests.get(api_url, headers={'Accept': 'application/vnd.github.v3+json'}, timeout=30)
            if response.status_code != 200:
                logger.error(f"GitHub API error {response.status_code}: {response.text[:200]}")
                return []
            
            items = response.json()
            if not isinstance(items, list):
                logger.warning(f"Expected directory listing but got: {type(items)}")
                return []
            
            # Collect file URLs (markdown, text, json, yaml files)
            file_urls = []
            processable_extensions = {'.md', '.txt', '.json', '.yaml', '.yml', '.rst', '.adoc'}
            
            for item in items:
                if item.get('type') == 'file':
                    name = item.get('name', '')
                    ext = '.' + name.split('.')[-1].lower() if '.' in name else ''
                    if ext in processable_extensions:
                        # Use blob URL for the file
                        file_url = f"https://github.com/{owner}/{repo}/blob/{branch}/{path}/{name}"
                        file_urls.append(file_url)
                        logger.info(f"  Found file: {name}")
            
            logger.info(f"Expanded directory to {len(file_urls)} files")
            return file_urls
            
        except Exception as e:
            logger.error(f"Failed to expand GitHub directory {url}: {e}")
            return []

    def _split_sources(self, sources: List[str]) -> Tuple[List[str], List[str], List[str]]:
        """
        Returns: (local_paths, repo_urls, doc_urls)
        Handles:
        - Local paths → local_paths
        - GitHub repo roots → repo_urls (for cloning)
        - GitHub file URLs (/blob/...file.md) → doc_urls
        - GitHub directory URLs (/blob/...dir/ or /tree/...dir/) → expanded to file URLs → doc_urls
        """
        local_paths, repo_urls, doc_urls = [], [], []
        for s in sources:
            if self._is_url(s):
                if self._is_repo_url(s):
                    repo_urls.append(s)
                elif self._is_github_directory_url(s):
                    # Expand directory to individual files
                    logger.info(f"Expanding GitHub directory URL: {s}")
                    file_urls = self._expand_github_directory(s)
                    if file_urls:
                        doc_urls.extend(file_urls)
                    else:
                        logger.warning(f"Could not expand directory URL, skipping: {s}")
                else:
                    doc_urls.append(s)
            else:
                local_paths.append(s)
        return local_paths, repo_urls, doc_urls

    def _expand_urls_to_all_tech_doc_categories(self, urls: List[str]) -> Dict[str, List[str]]:
        """
        Convert a list of doc URLs into a technical_documents dict that applies to ALL categories.
        """
        if not urls:
            return {}

        all_categories = ["tech_stack", "coding_style", "conventions", "error_handling", "validation", "commenting"]

        # Same URLs in every category (intentionally)
        return {cat: list(urls) for cat in all_categories}

