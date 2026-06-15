"""
Unit tests for FileAnalysisContext and strategy classes.
"""
import unittest
from unittest.mock import Mock, MagicMock
from pathlib import Path
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.file_analyzer import (
    FileAnalysisContext,
    AnalysisStrategy,
    CodeAnalysisStrategy,
    DependencyAnalysisStrategy
)
from src.categories import FileCategories


class TestFileAnalysisContext(unittest.TestCase):
    """Test FileAnalysisContext dataclass."""
    
    def test_valid_context_creation(self):
        """Test creating a valid context."""
        context = FileAnalysisContext(
            path='/path/to/file.py',
            category='backend',
            standard_file='backend/api.md'
        )
        
        self.assertEqual(context.path, '/path/to/file.py')
        self.assertEqual(context.category, 'backend')
        self.assertEqual(context.standard_file, 'backend/api.md')
    
    def test_context_validation_missing_path(self):
        """Test context validation fails with missing path."""
        with self.assertRaises(ValueError):
            FileAnalysisContext(
                path='',
                category='backend',
                standard_file='backend/api.md'
            )
    
    def test_context_validation_missing_category(self):
        """Test context validation fails with missing category."""
        with self.assertRaises(ValueError):
            FileAnalysisContext(
                path='/path/to/file.py',
                category='',
                standard_file='backend/api.md'
            )
    
    def test_context_validation_missing_standard_file(self):
        """Test context validation fails with missing standard_file."""
        with self.assertRaises(ValueError):
            FileAnalysisContext(
                path='/path/to/file.py',
                category='backend',
                standard_file=''
            )
    
    def test_context_immutability(self):
        """Test that context is immutable (dataclass frozen behavior)."""
        context = FileAnalysisContext(
            path='/path/to/file.py',
            category='backend',
            standard_file='backend/api.md'
        )
        
        # Should be able to access attributes
        self.assertEqual(context.path, '/path/to/file.py')


class TestCodeAnalysisStrategy(unittest.TestCase):
    """Test CodeAnalysisStrategy class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.strategy = CodeAnalysisStrategy()
        self.context = FileAnalysisContext(
            path='/path/to/controller.py',
            category='backend',
            standard_file='backend/api.md'
        )
    
    def test_get_prompts_returns_tuple(self):
        """Test get_prompts returns correct tuple structure."""
        content = "def hello(): pass"
        result = self.strategy.get_prompts(
            '/path/to/controller.py',
            content,
            self.context
        )
        
        self.assertIsInstance(result, tuple)
        self.assertEqual(len(result), 3)
        
        system_prompt, user_prompt, max_tokens = result
        self.assertIsInstance(system_prompt, str)
        self.assertIsInstance(user_prompt, str)
        self.assertIsInstance(max_tokens, int)
        self.assertEqual(max_tokens, 4000)
    
    def test_get_prompts_includes_context_info(self):
        """Test user prompt includes context information."""
        content = "def hello(): pass"
        _, user_prompt, _ = self.strategy.get_prompts(
            '/path/to/controller.py',
            content,
            self.context
        )
        
        self.assertIn('/path/to/controller.py', user_prompt)
        self.assertIn('backend', user_prompt)
        self.assertIn('backend/api.md', user_prompt)
        self.assertIn(content, user_prompt)
    
    def test_get_metadata_returns_file_size(self):
        """Test get_metadata returns file size."""
        content = "def hello(): pass"
        metadata = self.strategy.get_metadata(
            '/path/to/controller.py',
            content,
            self.context
        )
        
        self.assertIsInstance(metadata, dict)
        self.assertIn('file_size_bytes', metadata)
        self.assertEqual(metadata['file_size_bytes'], len(content))
    
    def test_get_metadata_with_empty_content(self):
        """Test get_metadata with empty content."""
        content = ""
        metadata = self.strategy.get_metadata(
            '/path/to/controller.py',
            content,
            self.context
        )
        
        self.assertEqual(metadata['file_size_bytes'], 0)


class TestDependencyAnalysisStrategy(unittest.TestCase):
    """Test DependencyAnalysisStrategy class."""
    
    def setUp(self):
        """Set up test fixtures."""
        # Mock dependency manager
        self.mock_dep_manager = Mock()
        self.mock_dep_manager.get_file_type.return_value = 'Python package manifest'
        self.mock_dep_manager.get_ecosystem.return_value = 'python'
        self.mock_dep_manager.get_purpose.return_value = 'backend'
        
        self.strategy = DependencyAnalysisStrategy(self.mock_dep_manager)
        self.context = FileAnalysisContext(
            path='/path/to/requirements.txt',
            category='dependency',
            standard_file='global/tech-stack.md'
        )
    
    def test_get_prompts_returns_tuple(self):
        """Test get_prompts returns correct tuple structure."""
        content = "flask==2.0.0\nrequests==2.28.0"
        result = self.strategy.get_prompts(
            '/path/to/requirements.txt',
            content,
            self.context
        )
        
        self.assertIsInstance(result, tuple)
        self.assertEqual(len(result), 3)
        
        system_prompt, user_prompt, max_tokens = result
        self.assertIsInstance(system_prompt, str)
        self.assertIsInstance(user_prompt, str)
        self.assertIsInstance(max_tokens, int)
        self.assertEqual(max_tokens, 3000)
    
    def test_get_prompts_calls_dependency_manager(self):
        """Test get_prompts calls dependency manager for file type."""
        content = "flask==2.0.0"
        self.strategy.get_prompts(
            '/path/to/requirements.txt',
            content,
            self.context
        )
        
        self.mock_dep_manager.get_file_type.assert_called_once_with('requirements.txt')
    
    def test_get_prompts_includes_file_type(self):
        """Test user prompt includes file type from dependency manager."""
        content = "flask==2.0.0"
        _, user_prompt, _ = self.strategy.get_prompts(
            '/path/to/requirements.txt',
            content,
            self.context
        )
        
        self.assertIn('Python package manifest', user_prompt)
        self.assertIn(content, user_prompt)
    
    def test_get_metadata_returns_dependency_info(self):
        """Test get_metadata returns ecosystem, purpose, file_type."""
        content = "flask==2.0.0"
        metadata = self.strategy.get_metadata(
            '/path/to/requirements.txt',
            content,
            self.context
        )
        
        self.assertIsInstance(metadata, dict)
        self.assertIn('ecosystem', metadata)
        self.assertIn('purpose', metadata)
        self.assertIn('file_type', metadata)
        
        self.assertEqual(metadata['ecosystem'], 'python')
        self.assertEqual(metadata['purpose'], 'backend')
        self.assertEqual(metadata['file_type'], 'Python package manifest')
    
    def test_get_metadata_calls_all_dependency_manager_methods(self):
        """Test get_metadata calls all dependency manager methods."""
        content = "flask==2.0.0"
        self.strategy.get_metadata(
            '/path/to/requirements.txt',
            content,
            self.context
        )
        
        self.mock_dep_manager.get_ecosystem.assert_called_once_with('requirements.txt')
        self.mock_dep_manager.get_purpose.assert_called_once_with('requirements.txt')
        self.mock_dep_manager.get_file_type.assert_called_once_with('requirements.txt')


class TestAnalysisStrategyInterface(unittest.TestCase):
    """Test AnalysisStrategy base class interface."""
    
    def test_base_strategy_cannot_be_instantiated_directly(self):
        """Test that base strategy methods raise NotImplementedError."""
        strategy = AnalysisStrategy()
        context = FileAnalysisContext(
            path='/path/to/file.py',
            category='backend',
            standard_file='backend/api.md'
        )
        
        with self.assertRaises(NotImplementedError):
            strategy.get_prompts('/path/to/file.py', 'content', context)
        
        with self.assertRaises(NotImplementedError):
            strategy.get_metadata('/path/to/file.py', 'content', context)


if __name__ == '__main__':
    unittest.main()
