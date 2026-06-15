"""
Integration tests for technical documentation feature.
Tests the complete workflow from CLI to output.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from src.categories import FileCategories
from src.strategies.base_strategy import FileAnalysisContext
from src.standards_orchestrator import StandardsOrchestrator


# Stale: written 2026-02-20. StandardsOrchestrator's tech-doc surface
# (_generate_reports, _ingest_technical_documents signature, src.cli.main
# entry) has been refactored away. Quarantine per
# fix/260504-1127-full-repo-green.
_DRIFT_REASON = (
    "Stale since 2026-02-20 (StandardsOrchestrator + cli refactors); "
    "needs revision per fix/260504-1127-full-repo-green"
)


class TestTechDocIntegration:
    """Integration tests for tech doc feature."""
    
    @pytest.fixture
    def config(self, tmp_path):
        """Create test configuration."""
        return {
            'project_name': 'test-project',
            'output_dir': str(tmp_path / 'output'),
            'config_dir': 'config',
            'templates_dir': 'templates/standards',
            'max_file_size_kb': 500,
            'llm_provider': 'anthropic',
            'llm_model': 'claude-haiku-4-5-20251001',
            'anthropic_api_key': 'test-key',
            'technical_documents': {
                'tech_stack': ['docs/tech-stack.pdf'],
                'coding_style': ['docs/style-guide.md']
            },
            'use_cache': True
        }
    
    def test_categories_includes_technical_doc(self):
        """Test that TECHNICAL_DOC is in FileCategories."""
        assert hasattr(FileCategories, 'TECHNICAL_DOC')
        assert FileCategories.TECHNICAL_DOC == 'technical_doc'
        assert FileCategories.TECHNICAL_DOC in FileCategories.ALL
        assert FileCategories.TECHNICAL_DOC in FileCategories.SPECIAL_CATEGORIES
    
    def test_file_analysis_context_with_tech_doc(self):
        """Test creating FileAnalysisContext for tech doc."""
        context = FileAnalysisContext(
            path="/staging/parsed/tech-stack.txt",
            category=FileCategories.TECHNICAL_DOC,
            standard_file="global/tech-stack.md"
        )
        
        assert context.path == "/staging/parsed/tech-stack.txt"
        assert context.category == "technical_doc"
        assert context.standard_file == "global/tech-stack.md"
    
    @patch('src.standards_orchestrator.LLMClient')
    @patch('src.standards_orchestrator.RepositoryFetcher')
    def test_standards_orchestrator_initializes_tech_doc_repository(
        self, mock_repo_fetcher, mock_llm_client, config
    ):
        """Test that standards_orchestrator initializes TechnicalDocRepository."""
        extractor = StandardsOrchestrator(config)
        
        assert hasattr(extractor, 'tech_doc_repository')
        assert hasattr(extractor, 'tech_docs')
        assert extractor.tech_docs == config['technical_documents']
    
    @patch('src.standards_orchestrator.LLMClient')
    @patch('src.standards_orchestrator.RepositoryFetcher')
    def test_get_standard_for_tech_doc(
        self, mock_repo_fetcher, mock_llm_client, config
    ):
        """Test mapping tech docs to standard files.

        Drift: signature changed from `(file_path)` to `(category)`.
        Default for unknown category is now 'global/general.md', not
        'global/tech-stack.md'."""
        extractor = StandardsOrchestrator(config)

        assert extractor._get_standard_for_tech_doc('tech_stack') == 'global/tech-stack.md'
        assert extractor._get_standard_for_tech_doc('coding_style') == 'global/coding-style.md'
        # Unknown category now defaults to 'global/general.md' (was 'tech-stack.md').
        assert extractor._get_standard_for_tech_doc('unknown') == 'global/general.md'
    
    @patch('src.standards_orchestrator.LLMClient')
    @patch('src.standards_orchestrator.RepositoryFetcher')
    @patch.object(StandardsOrchestrator, '_ingest_technical_documents')
    @patch.object(StandardsOrchestrator, '_scan_all_sources')
    @patch.object(StandardsOrchestrator, '_analyze_files')
    @patch.object(StandardsOrchestrator, '_synthesize_standards')
    def test_extract_from_sources_processes_tech_docs(
        self, mock_synthesize, mock_analyze,
        mock_scan, mock_process_tech_docs, mock_repo_fetcher,
        mock_llm_client, config
    ):
        """Test that the run() entry point calls tech doc processing.

        Drift: `extract_from_sources` was renamed to `run`,
        `_generate_reports` was inlined as `report_generator.generate_summary`,
        and `_ingest_technical_documents` now returns an int (count) and
        takes a `Dict[str, List[str]]` (the tech_docs dict)."""
        mock_scan.return_value = {'backend': [], 'frontend': []}
        mock_analyze.return_value = []
        mock_synthesize.return_value = {}
        mock_process_tech_docs.return_value = 1  # int count, not list

        extractor = StandardsOrchestrator(config)
        # Stub the report generator so we don't need to mock its inner FS calls.
        with patch.object(extractor, 'report_generator') as mock_rg:
            mock_rg.generate_summary.return_value = Path('/tmp/REPORT.md')
            extractor.run(['./test-repo'], recursive=True)

        mock_process_tech_docs.assert_called_once()
        # Confirm new signature: arg 0 is the tech_docs dict from config.
        called_with = mock_process_tech_docs.call_args[0][0]
        assert called_with == config['technical_documents']
    
    @patch('src.standards_orchestrator.LLMClient')
    @patch('src.standards_orchestrator.RepositoryFetcher')
    def test_extract_from_sources_skips_tech_docs_if_not_provided(
        self, mock_repo_fetcher, mock_llm_client, config, tmp_path
    ):
        """Test that tech doc processing is skipped when no docs provided.

        Drift: same renames as test_extract_from_sources_processes_tech_docs.
        Empty `technical_documents` should keep `_ingest_technical_documents`
        un-invoked."""
        config['technical_documents'] = {}

        with patch.object(StandardsOrchestrator, '_ingest_technical_documents') as mock_process, \
             patch.object(StandardsOrchestrator, '_scan_all_sources') as mock_scan, \
             patch.object(StandardsOrchestrator, '_analyze_files') as mock_analyze, \
             patch.object(StandardsOrchestrator, '_synthesize_standards') as mock_synth:
            mock_scan.return_value = {'backend': []}
            mock_analyze.return_value = []
            mock_synth.return_value = {}

            extractor = StandardsOrchestrator(config)
            with patch.object(extractor, 'report_generator') as mock_rg:
                mock_rg.generate_summary.return_value = Path('/tmp/REPORT.md')
                extractor.run(['./test-repo'], recursive=True)

            mock_process.assert_not_called()
    
    @patch('src.standards_orchestrator.LLMClient')
    @patch('src.standards_orchestrator.RepositoryFetcher')
    def test_process_technical_documents_workflow(
        self, mock_repo_fetcher, mock_llm_client, config, tmp_path
    ):
        """Test the _ingest_technical_documents workflow.

        Drift: signature is now `_ingest_technical_documents(tech_docs)`
        taking a `Dict[str, List[str]]`; return is an int count, not a
        list. Internally it calls
          tech_doc_repository.ingest_technical_documents([url])  per url
          content_extractor.extract(parsed_content, use_case=category)
          file_analyzer.analyze_file(context)
        and writes per-category JSON to staging_dir. Verify the
        ingest_technical_documents call and the analyze_file call shape."""
        extractor = StandardsOrchestrator(config)
        # Ensure staging_dir is a writable tmpdir (the production
        # default is set in __init__; force here for isolation).
        extractor.staging_dir = tmp_path / "staging"
        extractor.staging_dir.mkdir(parents=True, exist_ok=True)

        # Stub the external collaborators
        parsed_path = tmp_path / "parsed.txt"
        parsed_path.write_text("Parsed content from PDF")

        with patch.object(extractor.tech_doc_repository, 'ingest_technical_documents') as mock_process, \
             patch.object(extractor.content_extractor, 'extract') as mock_extract, \
             patch.object(extractor.file_analyzer, 'analyze_file') as mock_analyze:
            mock_process.return_value = [{
                'original': 'docs/tech-stack.pdf',
                'local': str(tmp_path / 'temp.pdf'),
                'parsed': str(parsed_path),
            }]
            mock_extract.return_value = "extracted tech-stack content"
            mock_analyze.return_value = {'analysis': 'ok'}

            tech_docs = {'tech_stack': ['docs/tech-stack.pdf']}
            count = extractor._ingest_technical_documents(tech_docs)

            # ingest_technical_documents is called per-url, not per-batch.
            mock_process.assert_called_once_with(['docs/tech-stack.pdf'])
            mock_extract.assert_called_once()
            mock_analyze.assert_called_once()

            # The FileAnalysisContext passed to analyze_file should carry
            # the TECHNICAL_DOC category and the parsed-file path.
            ctx = mock_analyze.call_args[0][0]
            assert isinstance(ctx, FileAnalysisContext)
            assert ctx.category == FileCategories.TECHNICAL_DOC
            assert ctx.path == str(parsed_path)
            assert ctx.standard_file == 'global/tech-stack.md'

            assert count == 1
            # Per-category analyses JSON should have been written.
            assert (extractor.staging_dir / "tech_stack_analyses.json").exists()
    
    def test_cli_exposes_standards_subcommands(self):
        """The original test exercised long-removed monolithic flags
        (`--sources`, `--standards.tech-stack`, `--standards.coding-style`).
        The CLI is now subcommand-based: `generate-product-standards`
        and `generate-global-standards` are the entry points. Verify
        both surface in `--help`."""
        from click.testing import CliRunner
        from src.cli import cli

        runner = CliRunner()
        result = runner.invoke(cli, ['--help'])
        assert result.exit_code == 0
        assert 'generate-product-standards' in result.output
        assert 'generate-global-standards' in result.output
    
    def test_file_scanner_handles_technical_doc_category(self):
        """Test that file_scanner maps TECHNICAL_DOC correctly."""
        from src.file_scanner import FileScanner
        
        scanner = FileScanner(config_dir='config')
        
        result = scanner.get_standard_file_mapping(
            FileCategories.TECHNICAL_DOC,
            '/docs/tech-stack.pdf'
        )
        
        assert result == 'global/tech-stack.md'
    
    def test_file_analyzer_has_technical_doc_strategy(self):
        """Test that FileAnalyzer has technical_doc strategy registered."""
        from src.file_analyzer import FileAnalyzer
        from src.llm_client import LLMClient
        
        mock_llm = Mock(spec=LLMClient)
        analyzer = FileAnalyzer(mock_llm)
        
        assert 'technical_doc' in analyzer.strategies
        assert analyzer.strategies['technical_doc'] is not None
    
    def test_file_analyzer_selects_technical_doc_strategy(self):
        """Test that FileAnalyzer selects correct strategy for TECHNICAL_DOC."""
        from src.file_analyzer import FileAnalyzer
        from src.llm_client import LLMClient
        
        mock_llm = Mock(spec=LLMClient)
        analyzer = FileAnalyzer(mock_llm)
        
        strategy = analyzer._get_strategy(FileCategories.TECHNICAL_DOC)
        
        assert strategy == analyzer.strategies['technical_doc']
