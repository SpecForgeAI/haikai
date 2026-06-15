"""
File scanner module for discovering and categorizing source files.
"""
import os
from pathlib import Path
from typing import List, Dict, Set, Optional
import yaml
import pathspec

from src.categories import FileCategories


class DependencyFileManager:
    """Manages dependency file definitions from configuration."""
    
    def __init__(self, config_dir: Path):
        """Initialize with config directory."""
        dependency_file = config_dir / "dependency_files.yaml"
        with open(dependency_file, 'r', encoding="utf-8") as f:
            config = yaml.safe_load(f)
        self.dependency_files = config.get('dependency_files', {})
    
    def is_dependency_file(self, filename: str) -> bool:
        """Check if filename is a dependency file."""
        return filename in self.dependency_files
    
    def get_file_type(self, filename: str) -> str:
        """Get dependency file type."""
        if filename in self.dependency_files:
            return self.dependency_files[filename]['type']
        return 'Unknown dependency file'
    
    def get_ecosystem(self, filename: str) -> str:
        """Get ecosystem (python, javascript, java, etc.)."""
        if filename in self.dependency_files:
            return self.dependency_files[filename]['ecosystem']
        return 'unknown'
    
    def get_purpose(self, filename: str) -> str:
        """Get purpose (frontend, backend, mobile, both)."""
        if filename in self.dependency_files:
            return self.dependency_files[filename]['purpose']
        return 'unknown'
    
    def get_all_dependency_filenames(self) -> List[str]:
        """Get list of all recognized dependency filenames."""
        return list(self.dependency_files.keys())


class FileScanner:
    """Scans directories and categorizes files based on patterns and rules."""
    
    def __init__(self, config_dir: str = "config"):
        """Initialize the file scanner with configuration."""
        self.config_dir = Path(config_dir)
        self.exclusions = self._load_exclusions()
        self.categorization_rules = self._load_categorization_rules()
        self.pathspec = self._build_pathspec()
        self.dependency_manager = DependencyFileManager(self.config_dir)
    
    def _load_exclusions(self) -> Dict:
        """Load exclusion patterns from config."""
        exclusions_file = self.config_dir / "exclusions.yaml"
        with open(exclusions_file, 'r', encoding="utf-8") as f:
            return yaml.safe_load(f)
    
    def _load_categorization_rules(self) -> Dict:
        """Load categorization rules from config."""
        categorization_file = self.config_dir / "categorization.yaml"
        with open(categorization_file, 'r', encoding="utf-8") as f:
            return yaml.safe_load(f)
    
    def _build_pathspec(self) -> pathspec.PathSpec:
        """Build a pathspec for exclusion patterns."""
        patterns = []
        
        # Add directory patterns
        patterns.extend(self.exclusions.get('directories', []))
        
        # Add file patterns
        patterns.extend(self.exclusions.get('files', []))
        
        return pathspec.PathSpec.from_lines('gitignore', patterns)
    
    def should_exclude(self, file_path: str) -> bool:
        """Check if a file should be excluded based on patterns."""
        return self.pathspec.match_file(file_path)
    
    def should_include_extension(self, file_path: str) -> bool:
        """Check if file extension should be included."""
        include_extensions = self.exclusions.get('include_extensions', [])
        
        # If no extensions specified, include all
        if not include_extensions:
            return True
        
        file_ext = Path(file_path).suffix
        return file_ext in include_extensions
    
    def is_dependency_file(self, file_path: str) -> bool:
        """Check if file is a dependency file."""
        filename = Path(file_path).name
        return self.dependency_manager.is_dependency_file(filename)
    
    def should_include_file(self, file_path: str) -> bool:
        """
        Determine if a file should be included in analysis.
        Combines exclusion, extension, and dependency checks.
        
        Args:
            file_path: Path to the file
            
        Returns:
            True if file should be included, False otherwise
        """
        # Excluded paths
        if self.should_exclude(file_path):
            return False
        
        # Code files with valid extensions
        if self.should_include_extension(file_path):
            return True
        
        # Dependency files
        if self.is_dependency_file(file_path):
            return True
        
        return False
    
    def scan(self, directory: str, recursive: bool = True) -> Dict[str, List[str]]:
        """
        Alias for scan_directory to maintain backward compatibility.
        """
        return self.scan_directory(directory, recursive)

    def scan_directory(self, directory: str, recursive: bool = True) -> Dict[str, List[str]]:
        """
        Scan a directory and return categorized files.
        
        Args:
            directory: Path to directory to scan
            recursive: Whether to scan subdirectories
            
        Returns:
            Dictionary mapping categories to lists of file paths
        """
        directory_path = Path(directory)
        
        if not directory_path.exists():
            raise ValueError(f"Directory does not exist: {directory}")
        
        # Use centralized category definitions
        categorized_files = FileCategories.get_empty_dict()
        
        # Scan files
        if recursive:
            files = directory_path.rglob('*')
        else:
            files = directory_path.glob('*')
        
        for file_path in files:
            if not file_path.is_file():
                continue
            
            # Convert to relative path for pattern matching
            try:
                rel_path = file_path.relative_to(directory_path)
            except ValueError:
                rel_path = file_path
            
            rel_path_str = str(rel_path)
            
            # Use unified inclusion check
            if not self.should_include_file(rel_path_str):
                continue
            
            # Categorize the file
            if self.is_dependency_file(rel_path_str):
                category = FileCategories.DEPENDENCY
            else:
                category = self.categorize_file(rel_path_str)
            
            categorized_files[category].append(str(file_path))
        
        return categorized_files
    
    def categorize_file(self, file_path: str) -> str:
        """
        Categorize a file based on its path and name.
        
        Args:
            file_path: Path to the file (relative or absolute)
            
        Returns:
            Category name from FileCategories
        """
        file_path_lower = file_path.lower()
        file_name = Path(file_path).name
        file_ext = Path(file_path).suffix
        
        rules = self.categorization_rules.get('categorization_rules', {})
        
        # Check each category
        for category, category_rules in rules.items():
            # Validate category
            if not FileCategories.is_valid_category(category):
                continue
            
            # Check directory patterns
            directories = category_rules.get('directories', [])
            for dir_pattern in directories:
                if dir_pattern.lower() in file_path_lower:
                    return category
            
            # Check file patterns
            file_patterns = category_rules.get('file_patterns', [])
            for pattern in file_patterns:
                # Convert glob pattern to simple matching
                pattern_lower = pattern.lower().replace('*', '')
                if pattern_lower in file_name.lower():
                    return category
            
            # Check extensions
            extensions = category_rules.get('extensions', [])
            if file_ext in extensions:
                return category
        
        return FileCategories.UNCATEGORIZED
    
    def get_file_info(self, file_path: str) -> Dict:
        """
        Get detailed information about a file.
        
        Args:
            file_path: Path to the file
            
        Returns:
            Dictionary with file information
        """
        file_path_obj = Path(file_path)
        filename = file_path_obj.name
        
        info = {
            'path': str(file_path),
            'name': filename,
            'extension': file_path_obj.suffix,
            'size_kb': file_path_obj.stat().st_size / 1024,
            'category': self.categorize_file(str(file_path)),
            'is_dependency': self.is_dependency_file(str(file_path))
        }
        
        # Add dependency-specific info if applicable
        if info['is_dependency']:
            info['dependency_type'] = self.dependency_manager.get_file_type(filename)
            info['ecosystem'] = self.dependency_manager.get_ecosystem(filename)
            info['purpose'] = self.dependency_manager.get_purpose(filename)
        
        return info
    
    def get_standard_file_mapping(self, category: str, file_path: str) -> Optional[str]:
        """
        Determine which standard file a categorized file should contribute to.
        
        Args:
            category: The category of the file
            file_path: Path to the file
            
        Returns:
            Standard file path (e.g., 'backend/api.md') or None
        """
        # Handle dependency files - always map to tech-stack
        if category == FileCategories.DEPENDENCY:
            return 'global/tech-stack.md'
        
        # Handle technical documentation files - map based on standard type
        if category == FileCategories.TECHNICAL_DOC:
            # This will be determined by the CLI flag used (--standards.tech_stack, etc.)
            # For now, default to tech-stack
            return 'global/tech-stack.md'
        
        mapping = self.categorization_rules.get('standard_file_mapping', {})
        
        if category not in mapping:
            return None
        
        category_mapping = mapping[category]
        file_path_lower = file_path.lower()
        file_name = Path(file_path).name.lower()
        
        # Try to match based on file characteristics
        if category == FileCategories.BACKEND:
            if any(x in file_path_lower for x in ['controller', 'route', 'handler', 'api']):
                return category_mapping.get('api')
            elif any(x in file_path_lower for x in ['model', 'entity', 'schema']):
                return category_mapping.get('models')
            elif any(x in file_path_lower for x in ['query', 'queries', 'repository', 'dao']):
                return category_mapping.get('queries')
        
        elif category == FileCategories.FRONTEND:
            if any(x in file_path_lower for x in ['component', 'widget']):
                return category_mapping.get('components')
            elif any(x in file_name for x in ['.css', '.scss', '.sass', '.less']):
                return category_mapping.get('css')
            elif 'accessibility' in file_path_lower or 'a11y' in file_path_lower:
                return category_mapping.get('accessibility')
        
        elif category == FileCategories.TESTING:
            return category_mapping.get('test_writing')
        
        elif category == FileCategories.GLOBAL:
            if any(x in file_name for x in ['eslint', 'prettier', 'pylint', 'flake8', 'rubocop']):
                return category_mapping.get('coding_style')
            else:
                return category_mapping.get('conventions')
        
        # Default to first available standard in category
        if category_mapping:
            return list(category_mapping.values())[0]
        
        return None
