"""Config-driven language loader for tree-sitter extractors.

Reads config/treesitter_languages.yaml, dynamically imports extractor classes,
and returns available extractors grouped by file extension.
"""
import importlib
import logging
import os
from pathlib import Path
from typing import Optional

import yaml

from src.ast.extractors.base import LanguageExtractor

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = "config/treesitter_languages.yaml"


def load_extractors(
    config_path: Optional[str] = None,
) -> dict[str, LanguageExtractor]:
    """Load available extractors from config.

    Returns:
        {'.py': PythonExtractor(), '.pyi': PythonExtractor(), ...}
        Only includes extractors whose grammar packages are installed.
    """
    config_path = config_path or DEFAULT_CONFIG_PATH

    languages = _load_config(config_path)
    if not languages:
        # Fallback: Python-only if config missing
        return _fallback_python()

    extractors: dict[str, LanguageExtractor] = {}

    for lang_name, lang_config in languages.items():
        if not lang_config.get("enabled", True):
            logger.debug(f"Tree-sitter {lang_name}: disabled in config")
            continue

        # Check if grammar package is installed
        package = lang_config.get("package")
        if package and not _is_package_available(package):
            logger.warning(
                f"Tree-sitter {lang_name}: grammar package '{package}' not installed, skipping"
            )
            continue

        # Dynamically import extractor class
        extractor_path = lang_config.get("extractor")
        if not extractor_path:
            logger.warning(f"Tree-sitter {lang_name}: no extractor class configured")
            continue

        try:
            extractor = _import_extractor(
                extractor_path,
                package=package,
                extensions=lang_config.get("extensions", []),
            )
            for ext in lang_config.get("extensions", []):
                extractors[ext] = extractor
            logger.info(
                f"Tree-sitter {lang_name}: loaded {extractor_path} "
                f"for {lang_config.get('extensions')}"
            )
        except Exception as e:
            logger.warning(f"Tree-sitter {lang_name}: failed to load extractor: {e}")

    if not extractors:
        logger.warning("No tree-sitter extractors loaded, falling back to Python-only")
        return _fallback_python()

    return extractors


def _load_config(config_path: str) -> dict:
    """Load language config from YAML file."""
    try:
        with open(config_path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        return raw.get("languages", {})
    except FileNotFoundError:
        logger.warning(f"Tree-sitter config not found: {config_path}")
        return {}
    except Exception as e:
        logger.warning(f"Tree-sitter config error: {e}")
        return {}


def _is_package_available(package_name: str) -> bool:
    """Check if a Python package is importable."""
    try:
        importlib.import_module(package_name)
        return True
    except ImportError:
        return False


def _import_extractor(
    dotted_path: str,
    package: str = None,
    extensions: list[str] = None,
) -> LanguageExtractor:
    """Dynamically import and instantiate an extractor class.

    For GenericExtractor, loads the grammar from the package and passes
    the Language object + extensions at construction time.
    """
    module_path, class_name = dotted_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    cls = getattr(module, class_name)

    if class_name == "GenericExtractor" and package:
        from tree_sitter import Language
        grammar_module = importlib.import_module(package)
        # Most packages export language(), but some (e.g. tree_sitter_php)
        # use language_<name>() instead
        lang_fn = getattr(grammar_module, "language", None)
        if lang_fn is None:
            # Try language_<suffix> pattern (e.g. language_php)
            suffix = package.replace("tree_sitter_", "")
            lang_fn = getattr(grammar_module, f"language_{suffix}", None)
        if lang_fn is None:
            raise ImportError(f"No language() function in {package}")
        language = Language(lang_fn())
        return cls(language=language, extensions=extensions or [])

    return cls()


def _fallback_python() -> dict[str, LanguageExtractor]:
    """Fallback: load Python extractor directly (no config needed)."""
    try:
        from src.ast.extractors.python import PythonExtractor
        extractor = PythonExtractor()
        return {ext: extractor for ext in extractor.file_extensions}
    except ImportError:
        logger.error("Cannot load Python extractor — tree-sitter-python not installed")
        return {}
