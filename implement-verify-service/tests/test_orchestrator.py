"""
Unit tests for StandardsOrchestrator._analyze_files method.
"""
import unittest
from unittest.mock import Mock, MagicMock, patch, call
import sys
import os
from pathlib import Path
import json
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.standards_orchestrator import StandardsOrchestrator
from src.strategies.base_strategy import FileAnalysisContext
from src.categories import FileCategories


class TestOrchestratorAnalyzeFiles(unittest.TestCase):
    """Test StandardsOrchestrator._analyze_files method."""

    def setUp(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()

        with patch('src.standards_orchestrator.LLMClient'), \
             patch('src.standards_orchestrator.FileScanner'), \
             patch('src.standards_orchestrator.FileAnalyzer'), \
             patch('src.standards_orchestrator.StandardsSynthesizer'), \
             patch('src.standards_orchestrator.ReportGenerator'), \
             patch('src.standards_orchestrator.RepositoryFetcher'), \
             patch('src.standards_orchestrator.TechnicalDocRepository'):

            config = {
                'llm_provider': 'openai',
                'llm_model': 'gpt-4',
                'openai_api_key': 'test-key',
                'output_dir': self.temp_dir,
                'mode': 'create_global_standards'
            }
            self.extractor = StandardsOrchestrator(config)

            # Setup mocks
            self.extractor.file_scanner = Mock()
            self.extractor.file_analyzer = Mock()

    def test_analyze_files_processes_all_categories(self):
        """Test _analyze_files processes all categories except uncategorized and tech docs."""
        all_files = {
            FileCategories.BACKEND: ['/path/to/backend.py'],
            FileCategories.FRONTEND: ['/path/to/frontend.js'],
            FileCategories.TESTING: ['/path/to/test.py'],
        }

        self.extractor.file_analyzer.analyze_file.return_value = {"analysis": "result"}

        result = self.extractor._analyze_files(all_files, global_standards=[])

        # Should call analyze_file for each file
        assert self.extractor.file_analyzer.analyze_file.call_count == 3

    def test_analyze_files_empty_input(self):
        """Test _analyze_files handles empty file dict."""
        result = self.extractor._analyze_files({}, global_standards=[])

        self.extractor.file_analyzer.analyze_file.assert_not_called()
        assert result == []

    def test_analyze_files_skips_uncategorized(self):
        """Test _analyze_files skips UNCATEGORIZED files."""
        all_files = {
            FileCategories.UNCATEGORIZED: ['/path/to/unknown.xyz'],
            FileCategories.BACKEND: ['/path/to/app.py'],
        }

        self.extractor.file_analyzer.analyze_file.return_value = {"analysis": "result"}

        result = self.extractor._analyze_files(all_files, global_standards=[])

        # Only backend file should be analyzed (UNCATEGORIZED is not in the loop unless explicitly handled)
        calls = self.extractor.file_analyzer.analyze_file.call_args_list
        paths = [c[0][0].path for c in calls]
        assert '/path/to/app.py' in paths

    def test_analyze_files_skips_tech_docs(self):
        """Test _analyze_files skips TECHNICAL_DOC category."""
        all_files = {
            FileCategories.TECHNICAL_DOC: ['/path/to/doc.pdf'],
            FileCategories.BACKEND: ['/path/to/app.py'],
        }

        self.extractor.file_analyzer.analyze_file.return_value = {"analysis": "result"}

        self.extractor._analyze_files(all_files, global_standards=[])

        calls = self.extractor.file_analyzer.analyze_file.call_args_list
        paths = [c[0][0].path for c in calls]
        assert '/path/to/doc.pdf' not in paths
        assert '/path/to/app.py' in paths

    def test_analyze_files_creates_valid_contexts(self):
        """Test _analyze_files creates proper FileAnalysisContext objects."""
        all_files = {
            FileCategories.BACKEND: ['/path/to/backend.py'],
        }

        self.extractor.file_analyzer.analyze_file.return_value = {"analysis": "result"}

        self.extractor._analyze_files(all_files, global_standards=[])

        context = self.extractor.file_analyzer.analyze_file.call_args[0][0]
        assert isinstance(context, FileAnalysisContext)
        assert context.path == '/path/to/backend.py'
        assert context.category == FileCategories.BACKEND

    def test_analyze_files_handles_none_analysis(self):
        """Test _analyze_files handles None returns from analyze_file."""
        all_files = {
            FileCategories.BACKEND: ['/path/to/backend.py'],
        }

        self.extractor.file_analyzer.analyze_file.return_value = None

        result = self.extractor._analyze_files(all_files, global_standards=[])

        assert result == []

    def test_analyze_files_handles_multiple_files_per_category(self):
        """Test _analyze_files processes multiple files in a single category."""
        all_files = {
            FileCategories.BACKEND: ['/path/to/a.py', '/path/to/b.py', '/path/to/c.py'],
        }

        self.extractor.file_analyzer.analyze_file.return_value = {"analysis": "result"}

        result = self.extractor._analyze_files(all_files, global_standards=[])

        assert self.extractor.file_analyzer.analyze_file.call_count == 3
        assert len(result) == 3


class TestOrchestratorIntegration(unittest.TestCase):
    """Integration tests for StandardsOrchestrator initialization."""

    def test_standards_orchestrator_initialization(self):
        """Test StandardsOrchestrator initializes with valid config."""
        temp_dir = tempfile.mkdtemp()

        with patch('src.standards_orchestrator.LLMClient'), \
             patch('src.standards_orchestrator.FileScanner'), \
             patch('src.standards_orchestrator.FileAnalyzer'), \
             patch('src.standards_orchestrator.StandardsSynthesizer'), \
             patch('src.standards_orchestrator.ReportGenerator'), \
             patch('src.standards_orchestrator.RepositoryFetcher'), \
             patch('src.standards_orchestrator.TechnicalDocRepository'):

            config = {
                'llm_provider': 'openai',
                'llm_model': 'gpt-4',
                'openai_api_key': 'test-key',
                'output_dir': temp_dir,
                'mode': 'create_global_standards'
            }

            orchestrator = StandardsOrchestrator(config)
            assert orchestrator is not None


if __name__ == '__main__':
    unittest.main()
