"""
Central definition of all file categories.
Single source of truth for category management across the application.
"""

from typing import Dict, List


class FileCategories:
    """
    File category definitions and utilities.
    
    This class provides a single source of truth for all file categories
    used throughout the application. All category-related operations should
    reference these constants to maintain consistency.
    """
    
    # Category constants
    BACKEND = 'backend'
    FRONTEND = 'frontend'
    TESTING = 'testing'
    GLOBAL = 'global'
    DEPENDENCY = 'dependency'
    TECHNICAL_DOC = 'technical_doc'
    METAMODEL = 'metamodel'
    UNCATEGORIZED = 'uncategorized'
    
    # List of all valid categories
    ALL = [BACKEND, FRONTEND, TESTING, GLOBAL, DEPENDENCY, TECHNICAL_DOC, METAMODEL, UNCATEGORIZED]
    
    # Categories that contain code files (not dependencies)
    CODE_CATEGORIES = [BACKEND, FRONTEND, TESTING, GLOBAL]
    
    # Categories that require special handling
    SPECIAL_CATEGORIES = [DEPENDENCY, TECHNICAL_DOC, METAMODEL, UNCATEGORIZED]
    
    @classmethod
    def get_empty_dict(cls) -> Dict[str, List[str]]:
        """
        Get an empty categorized files dictionary.
        
        Returns:
            Dictionary with all categories initialized to empty lists
            
        Example:
            >>> categorized_files = FileCategories.get_empty_dict()
            >>> categorized_files
            {'backend': [], 'frontend': [], 'testing': [], 'global': [], 
             'dependency': [], 'uncategorized': []}
        """
        return {category: [] for category in cls.ALL}
    
    @classmethod
    def is_valid_category(cls, category: str) -> bool:
        """
        Check if a category is valid.
        
        Args:
            category: Category name to validate
            
        Returns:
            True if category is valid, False otherwise
            
        Example:
            >>> FileCategories.is_valid_category('backend')
            True
            >>> FileCategories.is_valid_category('invalid')
            False
        """
        return category in cls.ALL
    
    @classmethod
    def is_code_category(cls, category: str) -> bool:
        """
        Check if a category contains code files.
        
        Args:
            category: Category name to check
            
        Returns:
            True if category contains code files, False otherwise
            
        Example:
            >>> FileCategories.is_code_category('backend')
            True
            >>> FileCategories.is_code_category('dependency')
            False
        """
        return category in cls.CODE_CATEGORIES
    
    @classmethod
    def is_special_category(cls, category: str) -> bool:
        """
        Check if a category requires special handling.
        
        Args:
            category: Category name to check
            
        Returns:
            True if category requires special handling, False otherwise
            
        Example:
            >>> FileCategories.is_special_category('dependency')
            True
            >>> FileCategories.is_special_category('backend')
            False
        """
        return category in cls.SPECIAL_CATEGORIES
