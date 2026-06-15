"""
Unit tests for FileAnalyzer class.
"""
import unittest
from unittest.mock import Mock, MagicMock, patch, mock_open
import json
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.file_analyzer import FileAnalyzer, FileAnalysisContext
from src.categories import FileCategories


class TestFileAnalyzer(unittest.TestCase):
    """Test FileAnalyzer class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.mock_llm_client = Mock()
        self.analyzer = FileAnalyzer(
            llm_client=self.mock_llm_client,
            max_file_size_kb=500,
            config_dir='config'
        )
    
    def test_initialization(self):
        """Test FileAnalyzer initialization."""
        self.assertEqual(self.analyzer.max_file_size_kb, 500)
        self.assertEqual(self.analyzer.max_file_size_bytes, 500 * 1024)
        self.assertIsNotNone(self.analyzer.strategies)
        self.assertIn('code', self.analyzer.strategies)
        self.assertIn('dependency', self.analyzer.strategies)
    
    def test_get_strategy_for_code_category(self):
        """Test _get_strategy returns code strategy for code categories."""
        from src.file_analyzer import CodeAnalysisStrategy
        
        strategy = self.analyzer._get_strategy(FileCategories.BACKEND)
        self.assertIsInstance(strategy, CodeAnalysisStrategy)
        
        strategy = self.analyzer._get_strategy(FileCategories.FRONTEND)
        self.assertIsInstance(strategy, CodeAnalysisStrategy)
        
        strategy = self.analyzer._get_strategy(FileCategories.TESTING)
        self.assertIsInstance(strategy, CodeAnalysisStrategy)
        
        strategy = self.analyzer._get_strategy(FileCategories.GLOBAL)
        self.assertIsInstance(strategy, CodeAnalysisStrategy)
    
    def test_get_strategy_for_dependency_category(self):
        """Test _get_strategy returns dependency strategy for dependency category."""
        from src.file_analyzer import DependencyAnalysisStrategy
        
        strategy = self.analyzer._get_strategy(FileCategories.DEPENDENCY)
        self.assertIsInstance(strategy, DependencyAnalysisStrategy)
    
    @patch('builtins.open', new_callable=mock_open, read_data='def hello(): pass')
    def test_analyze_file_code_success(self, mock_file):
        """Test analyze_file successfully analyzes code file."""
        # Mock LLM response
        llm_response = json.dumps({
            'patterns': ['Pattern 1'],
            'conventions': ['Convention 1']
        })
        self.mock_llm_client.generate.return_value = llm_response
        
        context = FileAnalysisContext(
            path='/path/to/file.py',
            category=FileCategories.BACKEND,
            standard_file='backend/api.md'
        )
        
        result = self.analyzer.analyze_file(context)
        
        # Verify result structure
        self.assertIsNotNone(result)
        self.assertIn('patterns', result)
        self.assertIn('conventions', result)
        self.assertIn('source_file', result)
        self.assertIn('category', result)
        self.assertIn('standard_file', result)
        self.assertIn('file_size_bytes', result)
        
        # Verify metadata
        self.assertEqual(result['source_file'], '/path/to/file.py')
        self.assertEqual(result['category'], FileCategories.BACKEND)
        self.assertEqual(result['standard_file'], 'backend/api.md')
        
        # Verify LLM was called
        self.mock_llm_client.generate.assert_called_once()
    
    @patch('builtins.open', new_callable=mock_open, read_data='flask==2.0.0')
    def test_analyze_file_dependency_success(self, mock_file):
        """Test analyze_file successfully analyzes dependency file."""
        # Mock LLM response
        llm_response = json.dumps({
            'dependencies': ['flask'],
            'versions': ['2.0.0']
        })
        self.mock_llm_client.generate.return_value = llm_response
        
        context = FileAnalysisContext(
            path='/path/to/requirements.txt',
            category=FileCategories.DEPENDENCY,
            standard_file='global/tech-stack.md'
        )
        
        result = self.analyzer.analyze_file(context)
        
        # Verify result structure
        self.assertIsNotNone(result)
        self.assertIn('dependencies', result)
        self.assertIn('source_file', result)
        self.assertIn('category', result)
        self.assertIn('standard_file', result)
        self.assertIn('ecosystem', result)
        self.assertIn('purpose', result)
        self.assertIn('file_type', result)
        
        # Verify metadata
        self.assertEqual(result['source_file'], '/path/to/requirements.txt')
        self.assertEqual(result['category'], FileCategories.DEPENDENCY)
        self.assertEqual(result['standard_file'], 'global/tech-stack.md')
    
    @patch('builtins.open', side_effect=FileNotFoundError)
    def test_analyze_file_file_not_found(self, mock_file):
        """Test analyze_file handles file not found."""
        context = FileAnalysisContext(
            path='/nonexistent/file.py',
            category=FileCategories.BACKEND,
            standard_file='backend/api.md'
        )
        
        result = self.analyzer.analyze_file(context)
        self.assertIsNone(result)
    
    @patch('builtins.open', new_callable=mock_open, read_data='def hello(): pass')
    def test_analyze_file_llm_error(self, mock_file):
        """Test analyze_file handles LLM errors."""
        self.mock_llm_client.generate.side_effect = Exception("LLM error")
        
        context = FileAnalysisContext(
            path='/path/to/file.py',
            category=FileCategories.BACKEND,
            standard_file='backend/api.md'
        )
        
        result = self.analyzer.analyze_file(context)
        self.assertIsNone(result)
    
    @patch('builtins.open', new_callable=mock_open, read_data='x' * 600000)
    def test_analyze_file_truncates_large_files(self, mock_file):
        """Test analyze_file truncates files exceeding max size."""
        llm_response = json.dumps({'patterns': []})
        self.mock_llm_client.generate.return_value = llm_response
        
        context = FileAnalysisContext(
            path='/path/to/large_file.py',
            category=FileCategories.BACKEND,
            standard_file='backend/api.md'
        )
        
        result = self.analyzer.analyze_file(context)
        
        # Verify LLM was called with truncated content
        call_args = self.mock_llm_client.generate.call_args
        messages = call_args[0][0]
        user_message = messages[1]['content']
        
        self.assertIn('file truncated due to size', user_message)
    
    @patch('builtins.open', new_callable=mock_open, read_data='def hello(): pass')
    def test_analyze_batch_single_file(self, mock_file):
        """Test analyze_batch with single file."""
        llm_response = json.dumps({'patterns': ['Pattern 1']})
        self.mock_llm_client.generate.return_value = llm_response
        
        contexts = [
            FileAnalysisContext(
                path='/path/to/file.py',
                category=FileCategories.BACKEND,
                standard_file='backend/api.md'
            )
        ]
        
        results = self.analyzer.analyze_batch(contexts, show_progress=False)
        
        self.assertEqual(len(results), 1)
        self.assertIn('patterns', results[0])
        self.assertEqual(results[0]['source_file'], '/path/to/file.py')
    
    @patch('builtins.open', new_callable=mock_open, read_data='def hello(): pass')
    def test_analyze_batch_multiple_files(self, mock_file):
        """Test analyze_batch with multiple files."""
        llm_response = json.dumps({'patterns': ['Pattern 1']})
        self.mock_llm_client.generate.return_value = llm_response
        
        contexts = [
            FileAnalysisContext(
                path='/path/to/file1.py',
                category=FileCategories.BACKEND,
                standard_file='backend/api.md'
            ),
            FileAnalysisContext(
                path='/path/to/file2.py',
                category=FileCategories.FRONTEND,
                standard_file='frontend/components.md'
            )
        ]
        
        results = self.analyzer.analyze_batch(contexts, show_progress=False)
        
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]['source_file'], '/path/to/file1.py')
        self.assertEqual(results[1]['source_file'], '/path/to/file2.py')
    
    @patch('builtins.open', new_callable=mock_open, read_data='def hello(): pass')
    def test_analyze_batch_skips_failed_analyses(self, mock_file):
        """Test analyze_batch skips files that fail analysis."""
        # First call succeeds, second fails
        self.mock_llm_client.generate.side_effect = [
            json.dumps({'patterns': ['Pattern 1']}),
            Exception("LLM error")
        ]
        
        contexts = [
            FileAnalysisContext(
                path='/path/to/file1.py',
                category=FileCategories.BACKEND,
                standard_file='backend/api.md'
            ),
            FileAnalysisContext(
                path='/path/to/file2.py',
                category=FileCategories.BACKEND,
                standard_file='backend/api.md'
            )
        ]
        
        results = self.analyzer.analyze_batch(contexts, show_progress=False)
        
        # Only successful analysis should be in results
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['source_file'], '/path/to/file1.py')
    
    def test_parse_json_response_valid_json(self):
        """Test _parse_json_response with valid JSON."""
        json_str = '{"key": "value"}'
        result = self.analyzer._parse_json_response(json_str)
        
        self.assertIsNotNone(result)
        self.assertEqual(result['key'], 'value')
    
    def test_parse_json_response_markdown_code_block(self):
        """Test _parse_json_response extracts JSON from markdown."""
        markdown = '```json\n{"key": "value"}\n```'
        result = self.analyzer._parse_json_response(markdown)
        
        self.assertIsNotNone(result)
        self.assertEqual(result['key'], 'value')
    
    def test_parse_json_response_generic_code_block(self):
        """Test _parse_json_response extracts JSON from generic code block."""
        markdown = '```\n{"key": "value"}\n```'
        result = self.analyzer._parse_json_response(markdown)
        
        self.assertIsNotNone(result)
        self.assertEqual(result['key'], 'value')
    
    def test_parse_json_response_invalid_json(self):
        """Test _parse_json_response handles invalid JSON."""
        invalid_json = 'not json at all'
        result = self.analyzer._parse_json_response(invalid_json)
        
        self.assertIsNone(result)
    
    @patch('builtins.open', new_callable=mock_open, read_data='content')
    def test_read_file_success_utf8(self, mock_file):
        """Test _read_file successfully reads UTF-8 file."""
        content = self.analyzer._read_file('/path/to/file.py')
        
        self.assertEqual(content, 'content')
        mock_file.assert_called_once_with('/path/to/file.py', 'r', encoding='utf-8')
    
    @patch('builtins.open')
    def test_read_file_fallback_latin1(self, mock_file):
        """Test _read_file falls back to latin-1 encoding."""
        # First call raises UnicodeDecodeError, second succeeds
        mock_file.side_effect = [
            UnicodeDecodeError('utf-8', b'', 0, 1, 'invalid'),
            mock_open(read_data='content').return_value
        ]
        
        content = self.analyzer._read_file('/path/to/file.py')
        
        self.assertEqual(content, 'content')
        self.assertEqual(mock_file.call_count, 2)
    
    @patch('builtins.open', side_effect=FileNotFoundError)
    def test_read_file_not_found(self, mock_file):
        """Test _read_file handles file not found."""
        content = self.analyzer._read_file('/nonexistent/file.py')
        
        self.assertIsNone(content)


class TestFileAnalyzerSaveAnalyses(unittest.TestCase):
    """Test FileAnalyzer save_analyses method."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.mock_llm_client = Mock()
        self.analyzer = FileAnalyzer(
            llm_client=self.mock_llm_client,
            max_file_size_kb=500,
            config_dir='config'
        )
    
    @patch('pathlib.Path.mkdir')
    @patch('builtins.open', new_callable=mock_open)
    def test_save_analyses_groups_by_standard_file(self, mock_file, mock_mkdir):
        """Test save_analyses groups analyses by standard file."""
        analyses = [
            {
                'source_file': '/path/to/file1.py',
                'category': FileCategories.BACKEND,
                'standard_file': 'backend/api.md',
                'patterns': []
            },
            {
                'source_file': '/path/to/file2.py',
                'category': FileCategories.BACKEND,
                'standard_file': 'backend/api.md',
                'patterns': []
            },
            {
                'source_file': '/path/to/file3.py',
                'category': FileCategories.FRONTEND,
                'standard_file': 'frontend/components.md',
                'patterns': []
            }
        ]
        
        self.analyzer.save_analyses(analyses, '/output/dir')
        
        # Should create 2 files (backend_api, frontend_components)
        self.assertEqual(mock_file.call_count, 2)
    
    @patch('pathlib.Path.mkdir')
    @patch('builtins.open', new_callable=mock_open)
    def test_save_analyses_groups_dependencies_separately(self, mock_file, mock_mkdir):
        """Test save_analyses groups dependency analyses separately."""
        analyses = [
            {
                'source_file': '/path/to/requirements.txt',
                'category': FileCategories.DEPENDENCY,
                'standard_file': 'global/tech-stack.md',
                'dependencies': []
            }
        ]
        
        self.analyzer.save_analyses(analyses, '/output/dir')
        
        # Should create dependency_tech_stack file
        mock_file.assert_called_once()
        call_args = mock_file.call_args[0][0]
        self.assertIn('dependency_tech_stack', str(call_args))


if __name__ == '__main__':
    unittest.main()
