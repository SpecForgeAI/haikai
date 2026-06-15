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
from colorama import Fore, Style, init

logger = logging.getLogger(__name__)

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

# Initialize colorama
init(autoreset=True)


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
                "Set LLM_MODEL environment variable (e.g., 'claude-haiku-4-5-20251001', 'gpt-4-turbo')."
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
        else:
            llm_api_key = config.get('llm_api_key')
            if not llm_api_key:
                raise ValueError(
                    f"API key required for LLM_PROVIDER={llm_provider}. "
                    "Set the appropriate API key environment variable."
                )
        
        
        self.llm_client = LLMClient(
            provider=llm_provider,
            model=llm_model,
            api_key=llm_api_key
        )
        
        # Setup directories based on mode
        self.base_output_dir = Path(config.get('output_dir', 'standards'))
        self.global_dir = Path(config.get('global_dir', 'standards')) if config.get('global_dir') else None
        
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

    def create_product_standards(self, sources: List[str], recursive: bool = True) -> List[Path]:
        """
        Create product-level technical standards.
        
        Reads from:
        - {global_dir}/haikai/standards/global/tech-stack.md (baseline)
        - {project_dir}/metamodel/architecture.json (if present)
        
        Writes to: {project_dir}/haikai/product/tech-stack.md
        """
        logger.info("=" * 60)
        logger.info("Generating Product Tech Standards")
        logger.info("=" * 60)
        print(f"{Fore.CYAN}{'='*60}")
        print(f"{Fore.CYAN}Generating Product Tech Standards")
        print(f"{Fore.CYAN}{'='*60}{Style.RESET_ALL}\n")
        
        # output_dir is already set in __init__ from config['output_dir']
        # sources parameter contains source code paths to analyze (optional)
        # If sources are provided, they will be scanned for code analysis
        
        logger.info(f"Output directory: {self.output_dir}")
        if sources:
            logger.info(f"Source paths: {sources}")
        print(f"{Fore.GREEN}Output directory:{Style.RESET_ALL} {self.output_dir}")
        if sources:
            print(f"{Fore.GREEN}Source paths:{Style.RESET_ALL} {sources}")
        
        try:
            results = self._synthesize_standards(is_product_mode=True)
            
            logger.info("Product Tech Standards Generation Completed!")
            print(f"\n{Fore.CYAN}{'='*60}")
            print(f"{Fore.CYAN}Product Tech Standards Generation Completed!")
            print(f"{Fore.CYAN}{'='*60}{Style.RESET_ALL}\n")
            
            # Convert dict of paths to list of Path objects
            output_paths = [Path(p) for p in results.values()] if isinstance(results, dict) else []
            return output_paths
        except Exception as e:
            print(f"{Fore.RED}Error during synthesis: {e}{Style.RESET_ALL}")
            import traceback
            traceback.print_exc()
            return []

    def get_metamodel(self, metamodel_id: str) -> Path:
        """Get metamodel from external system and persist."""
        print(f"{Fore.CYAN}Fetching metamodel: {metamodel_id}{Style.RESET_ALL}")
        persisted_path = self.metamodel_gateway.get_and_persist(metamodel_id)
        print(f"{Fore.GREEN}✓ Metamodel persisted to: {persisted_path}{Style.RESET_ALL}")
        return persisted_path

    def run(self, sources: List[str] = None, recursive: bool = True) -> Dict[str, str]:
        """
        Run the full standards extraction process.
        
        Args:
            sources: List of source directories or repository URLs
            recursive: Whether to scan directories recursively
            
        Returns:
            Dictionary mapping standard file names to their output paths
        """
        sources = sources or []
        print(f"{Fore.CYAN}{'='*60}")
        print(f"{Fore.CYAN}Standards Extraction Process")
        print(f"{Fore.CYAN}{'='*60}{Style.RESET_ALL}\n")
        
        print(f"{Fore.GREEN}Mode:{Style.RESET_ALL} {self.mode}")
        print(f"{Fore.GREEN}Sources:{Style.RESET_ALL} {', '.join(sources)}")
        print(f"{Fore.GREEN}Output Directory:{Style.RESET_ALL} {self.output_dir}\n")

        processed_docs = 0

        # Split sources into local paths, repo URLs, and doc URLs
        local_paths, repo_urls, doc_urls = self._split_sources(sources)

        # Treat doc URLs from `sources` as technical documents for ALL categories
        if doc_urls:
            print(
                f"{Fore.YELLOW}[Stage 0A] Processing URL sources as technical documents (all categories)...{Style.RESET_ALL}")
            expanded = self._expand_urls_to_all_tech_doc_categories(doc_urls)
            processed_from_sources = self._process_technical_documents(expanded)
            print(
                f"{Fore.GREEN}✓ Processed {processed_from_sources} URL sources as technical documents{Style.RESET_ALL}\n")

        sources = local_paths + repo_urls

        # Stage 0: Process technical documents (if provided)
        if self.tech_docs:
            print(f"{Fore.YELLOW}[Stage 0] Processing technical documents...{Style.RESET_ALL}")
            
            # Handle metamodel persistence first if provided
            metamodel_files = self.tech_docs.get('metamodel', [])
            project_id = self.config.get('metamodel_get_architecture')
            
            if metamodel_files:
                for metamodel_file in metamodel_files:
                    self.metamodel_gateway.fetch_and_persist(file_path=metamodel_file)
            elif project_id:
                self.metamodel_gateway.fetch_and_persist(project_id=project_id)
            
            processed_docs = self._process_technical_documents(self.tech_docs)
            print(f"{Fore.GREEN}✓ Processed {processed_docs} technical documents{Style.RESET_ALL}\n")
        
        # Stage 1: Scan and categorize source code files
        print(f"{Fore.YELLOW}[Stage 1] Scanning and categorizing source code...{Style.RESET_ALL}")
        all_files = self._scan_all_sources(sources, recursive)
        
        file_count = sum(len(files) for files in all_files.values())
        if file_count > 0:
            print(f"{Fore.GREEN}✓ Found {file_count} source code files across {len(all_files)} categories{Style.RESET_ALL}\n")
        else:
            print(f"{Fore.YELLOW}✓ No source code files found (technical documents only){Style.RESET_ALL}\n")
        
        # Check if we have any work to do (either source files or technical documents)
        has_technical_docs = self.tech_docs and processed_docs > 0
        if file_count == 0 and not has_technical_docs:
            print(f"{Fore.RED}No relevant files or technical documents to analyze. Exiting.{Style.RESET_ALL}")
            return {}
        
        # Skip source code analysis if no source files (but continue to synthesis for technical docs)
        if file_count == 0:
            all_analyses = {}
        else:
            # Stage 2: Analyze source code files
            print(f"{Fore.YELLOW}[Stage 2] Analyzing source code files...{Style.RESET_ALL}")
            global_standards = self._get_global_standards_to_extract()
            all_analyses = self._analyze_files(all_files, global_standards)
            print(f"{Fore.GREEN}✓ Completed analysis of {len(all_analyses)} source code files{Style.RESET_ALL}\n")
        
        # Stage 3: Synthesize standards from all analyses (technical documents + source code)
        print(f"{Fore.YELLOW}[Stage 3] Synthesizing standards from all analyses...{Style.RESET_ALL}")
        results = self._synthesize_standards()
        print(f"{Fore.GREEN}✓ Synthesized {len(results)} standard files{Style.RESET_ALL}\n")
        
        # Stage 4: Generate report
        print(f"{Fore.YELLOW}[Stage 4] Generating final report...{Style.RESET_ALL}")
        report_path = self.report_generator.generate_summary(results, self.output_dir)
        results['REPORT.md'] = str(report_path)
        print(f"{Fore.GREEN}✓ Final report generated at: {report_path}{Style.RESET_ALL}\n")
        
        return results

    def _process_technical_documents(self, tech_docs: Dict[str, List[str]]) -> int:
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
                    processed_docs = self.tech_doc_repository.process_technical_documents([url])
                    
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
        
        # Create a unique temporary directory for this repository
        temp_dir = self.staging_dir / 'temp' / platform / owner / repo
        if path:
            temp_dir = temp_dir / path.replace('/', os.sep)
            
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
        
        # Build clone URL with token for authentication if available
        github_token = self.config.get('github_token')
        if platform == 'github' and github_token:
            clone_url = f"https://{github_token}@github.com/{owner}/{repo}.git"
        elif platform == 'github':
            clone_url = f"https://github.com/{owner}/{repo}.git"
        else:
            clone_url = f"https://gitlab.com/{owner}/{repo}.git"
        clone_args = ['git', 'clone', '--depth', '1']
        if branch: clone_args.extend(['--branch', branch])
        clone_args.extend([clone_url, str(temp_dir)])
        subprocess.run(clone_args, check=True)

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
            
            print(f"  Analyzing {category} files...")
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
            print(f"  Synthesizing {output_file}...")
            
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

