"""Versioned serialiser config loader.

Loads diagram output format configs from config/diagram_serialisers.yaml.
Hard stop if format or version not found.
"""
import logging
from pathlib import Path

import yaml

from src.ast.kind_mapping_loader import VersionNotFoundError

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = "config/diagram_serialisers.yaml"


def load_serialiser_config(
    format: str,
    version: str = "1",
    config_path: str = None,
) -> dict:
    """Load serialiser config for a specific format and version.

    Args:
        format: Output format (mermaid, plantuml, graphviz, metamodel).
        version: Version string. Defaults to "1".
        config_path: Path to YAML config. Auto-detected if None.

    Returns:
        Dict with format-specific configuration.

    Raises:
        VersionNotFoundError: If format or version not in YAML.
        FileNotFoundError: If YAML config file does not exist.
    """
    if config_path is None:
        config_path = _find_config_path()

    config_file = Path(config_path)
    if not config_file.exists():
        raise FileNotFoundError(
            f"Diagram serialiser config not found: {config_path}. "
            f"Create {DEFAULT_CONFIG_PATH} with format+version entries."
        )

    with open(config_file, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    if config is None:
        raise FileNotFoundError(f"Empty config file: {config_path}")

    format_config = config.get(format)
    if format_config is None:
        available = list(config.keys())
        raise VersionNotFoundError(
            f"Format '{format}' not found in {config_path}. "
            f"Available formats: {available}."
        )

    version_config = format_config.get(version) or format_config.get(str(version))
    if version_config is None:
        available = list(format_config.keys())
        raise VersionNotFoundError(
            f"{format} version '{version}' not found in {config_path}. "
            f"Available versions: {available}."
        )

    logger.info(f"Loaded serialiser config for {format} v{version}")
    return version_config


def get_available_formats(config_path: str = None) -> list[str]:
    """Return list of configured output formats."""
    if config_path is None:
        config_path = _find_config_path()

    config_file = Path(config_path)
    if not config_file.exists():
        return []

    with open(config_file, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    return list(config.keys()) if config else []


def get_available_versions(format: str, config_path: str = None) -> list[str]:
    """Return list of configured versions for a format."""
    if config_path is None:
        config_path = _find_config_path()

    config_file = Path(config_path)
    if not config_file.exists():
        return []

    with open(config_file, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    if config and format in config:
        return list(config[format].keys())
    return []


def _find_config_path() -> str:
    """Find the config file, searching from CWD upward."""
    cwd = Path.cwd()
    candidate = cwd / DEFAULT_CONFIG_PATH
    if candidate.exists():
        return str(candidate)

    project_root = Path(__file__).parent.parent.parent
    candidate = project_root / DEFAULT_CONFIG_PATH
    if candidate.exists():
        return str(candidate)

    return str(cwd / DEFAULT_CONFIG_PATH)
