"""
Standards Extractor - Automatically extract coding standards from codebases.
"""

__version__ = "2.3.0"

from .standards_orchestrator import StandardsOrchestrator
from .file_scanner import FileScanner
from .repo_fetcher import RepositoryFetcher
from .file_analyzer import FileAnalyzer
from .strategies.base_strategy import FileAnalysisContext
from .standards_synthesizer import StandardsSynthesizer
from .report_generator import ReportGenerator
from .llm_client import LLMClient

__all__ = [
    'StandardsOrchestrator',
    'FileScanner',
    'RepositoryFetcher',
    'FileAnalyzer',
    'FileAnalysisContext',
    'StandardsSynthesizer',
    'ReportGenerator',
    'LLMClient',
]
