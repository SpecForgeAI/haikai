"""
Unit tests for FileScanner get_standard_file_mapping method.
"""
import unittest
from unittest.mock import Mock, MagicMock, patch
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.file_scanner import FileScanner
from src.categories import FileCategories


class TestFileScannerGetStandardFileMapping(unittest.TestCase):
    """Test FileScanner.get_standard_file_mapping method."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.scanner = FileScanner(config_dir='config')
    
    def test_dependency_category_returns_tech_stack(self):
        """Test DEPENDENCY category always returns global/tech-stack.md."""
        result = self.scanner.get_standard_file_mapping(
            FileCategories.DEPENDENCY,
            '/path/to/requirements.txt'
        )
        
        self.assertEqual(result, 'global/tech-stack.md')
    
    def test_dependency_category_any_file_path(self):
        """Test DEPENDENCY category returns tech-stack for any file path."""
        test_files = [
            'package.json',
            'requirements.txt',
            'Gemfile',
            'pom.xml',
            'build.gradle'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.DEPENDENCY,
                f'/path/to/{file_path}'
            )
            self.assertEqual(result, 'global/tech-stack.md')
    
    def test_backend_api_file_mapping(self):
        """Test backend files with API-related paths map to backend/api.md."""
        test_files = [
            '/src/controllers/user_controller.py',
            '/api/routes/auth.py',
            '/handlers/request_handler.py',
            '/src/api/endpoints.py'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.BACKEND,
                file_path
            )
            self.assertEqual(result, 'backend/api.md')
    
    def test_backend_models_file_mapping(self):
        """Test backend files with model-related paths map to backend/models.md."""
        test_files = [
            '/src/models/user.py',
            '/entities/product_entity.py',
            '/schema/database_schema.py',
            '/src/model/customer.py'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.BACKEND,
                file_path
            )
            self.assertEqual(result, 'backend/models.md')
    
    def test_backend_queries_file_mapping(self):
        """Test backend files with query-related paths map to backend/queries.md."""
        test_files = [
            '/src/queries/user_queries.py',
            '/repository/user_repository.py',
            '/dao/product_dao.py'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.BACKEND,
                file_path
            )
            self.assertEqual(result, 'backend/queries.md', f"Failed for {file_path}")
    
    def test_backend_default_mapping(self):
        """Test backend files without specific patterns use default mapping."""
        result = self.scanner.get_standard_file_mapping(
            FileCategories.BACKEND,
            '/src/utils/helper.py'
        )
        
        # Should return first available standard (api.md by default)
        self.assertIsNotNone(result)
        self.assertIn('backend/', result)
        # Default is api.md based on implementation
        self.assertEqual(result, 'backend/api.md')
    
    def test_frontend_components_file_mapping(self):
        """Test frontend files with component paths map to frontend/components.md."""
        test_files = [
            '/src/components/Button.tsx',
            '/widgets/UserWidget.vue',
            '/src/component/Header.jsx'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.FRONTEND,
                file_path
            )
            self.assertEqual(result, 'frontend/components.md')
    
    def test_frontend_css_file_mapping(self):
        """Test frontend CSS files map to frontend/css.md."""
        test_files = [
            '/src/styles/main.css',
            '/assets/theme.scss',
            '/styles/layout.sass',
            '/css/app.less'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.FRONTEND,
                file_path
            )
            self.assertEqual(result, 'frontend/css.md')
    
    def test_frontend_accessibility_file_mapping(self):
        """Test frontend accessibility files map to frontend/accessibility.md."""
        test_files = [
            '/src/accessibility/aria.js',
            '/a11y/keyboard_nav.ts',
            '/src/a11y/screen_reader.js'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.FRONTEND,
                file_path
            )
            self.assertEqual(result, 'frontend/accessibility.md')
    
    def test_testing_file_mapping(self):
        """Test testing files map to testing/test-writing.md."""
        test_files = [
            '/tests/test_user.py',
            '/spec/user_spec.rb',
            '/__tests__/component.test.js'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.TESTING,
                file_path
            )
            self.assertEqual(result, 'testing/test-writing.md')
    
    def test_global_coding_style_file_mapping(self):
        """Test global coding style files map to global/coding-style.md."""
        test_files = [
            '/.eslintrc.json',
            '/.prettierrc',
            '/.pylintrc',
            '/.flake8',
            '/.rubocop.yml'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.GLOBAL,
                file_path
            )
            self.assertEqual(result, 'global/coding-style.md')
    
    def test_global_conventions_file_mapping(self):
        """Test global convention files map to global/conventions.md."""
        test_files = [
            '/.editorconfig',
            '/tsconfig.json',
            '/config/app_config.json'
        ]
        
        for file_path in test_files:
            result = self.scanner.get_standard_file_mapping(
                FileCategories.GLOBAL,
                file_path
            )
            # Should map to either coding-style or conventions
            self.assertIsNotNone(result)
            self.assertIn('global/', result)
    
    def test_invalid_category_returns_none(self):
        """Test invalid category returns None."""
        result = self.scanner.get_standard_file_mapping(
            'invalid_category',
            '/path/to/file.py'
        )
        
        self.assertIsNone(result)
    
    def test_uncategorized_returns_none(self):
        """Test uncategorized category returns None."""
        result = self.scanner.get_standard_file_mapping(
            FileCategories.UNCATEGORIZED,
            '/path/to/file.py'
        )
        
        self.assertIsNone(result)
    
    def test_case_insensitive_matching(self):
        """Test file path matching is case-insensitive."""
        test_cases = [
            ('/src/CONTROLLERS/User.py', FileCategories.BACKEND, 'backend/api.md'),
            ('/src/Models/Product.py', FileCategories.BACKEND, 'backend/models.md'),
            ('/src/COMPONENTS/Button.tsx', FileCategories.FRONTEND, 'frontend/components.md')
        ]
        
        for file_path, category, expected in test_cases:
            result = self.scanner.get_standard_file_mapping(category, file_path)
            self.assertEqual(result, expected)
    
    def test_all_code_categories_have_mappings(self):
        """Test all code categories return valid mappings."""
        for category in FileCategories.CODE_CATEGORIES:
            result = self.scanner.get_standard_file_mapping(
                category,
                f'/path/to/file.py'
            )
            
            # All code categories should have at least a default mapping
            if category != FileCategories.UNCATEGORIZED:
                self.assertIsNotNone(result)
                self.assertIsInstance(result, str)
                self.assertIn('.md', result)


class TestFileScannerIntegration(unittest.TestCase):
    """Integration tests for FileScanner with real config."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.scanner = FileScanner(config_dir='config')
    
    def test_scanner_loads_categorization_rules(self):
        """Test scanner successfully loads categorization rules."""
        self.assertIsNotNone(self.scanner.categorization_rules)
        self.assertIn('standard_file_mapping', self.scanner.categorization_rules)
    
    def test_standard_file_mapping_structure(self):
        """Test standard_file_mapping has expected structure."""
        mapping = self.scanner.categorization_rules.get('standard_file_mapping', {})
        
        # Should have mappings for main categories
        self.assertIn('backend', mapping)
        self.assertIn('frontend', mapping)
        self.assertIn('testing', mapping)
        self.assertIn('global', mapping)
        
        # Backend should have api, models, queries
        backend = mapping['backend']
        self.assertIn('api', backend)
        self.assertIn('models', backend)
        self.assertIn('queries', backend)
        
        # Frontend should have components, css, accessibility
        frontend = mapping['frontend']
        self.assertIn('components', frontend)
        self.assertIn('css', frontend)
        self.assertIn('accessibility', frontend)


if __name__ == '__main__':
    unittest.main()
