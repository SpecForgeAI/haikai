"""Versioned kind mapping loader.

Loads provider-specific kind label → canonical SymbolKind mappings from
config/symbol_kind_mappings.yaml. Versioned per provider — hard stop
if the installed version is not in the YAML.
"""
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

import yaml

from src.ast.models import SymbolKind

logger = logging.getLogger(__name__)

# Default config path relative to project root
DEFAULT_CONFIG_PATH = "config/symbol_kind_mappings.yaml"

# Map string names to SymbolKind enum values
_KIND_NAME_MAP = {
    "class": SymbolKind.CLASS,
    "function": SymbolKind.FUNCTION,
    "method": SymbolKind.METHOD,
    "variable": SymbolKind.VARIABLE,
    "constant": SymbolKind.CONSTANT,
    "interface": SymbolKind.INTERFACE,
    "decorator": SymbolKind.DECORATOR,
    "module": SymbolKind.MODULE,
    "property": SymbolKind.PROPERTY,
    "unknown": SymbolKind.UNKNOWN,
}


class VersionNotFoundError(Exception):
    """Raised when a provider version is not found in the mappings YAML."""
    pass


def load_kind_mappings(
    provider: str,
    version: str,
    config_path: str = None,
) -> dict[str, SymbolKind]:
    """Load kind mappings for a specific provider and version.

    Args:
        provider: Provider name (e.g. 'ctags', 'lsp')
        version: Provider version string (e.g. '6.1', '1.1.380')
        config_path: Path to YAML config. Defaults to config/symbol_kind_mappings.yaml

    Returns:
        Dict mapping provider kind labels to canonical SymbolKind values.

    Raises:
        VersionNotFoundError: If version not found in YAML — hard stop.
        FileNotFoundError: If YAML config file does not exist.
    """
    if config_path is None:
        config_path = _find_config_path()

    config_file = Path(config_path)
    if not config_file.exists():
        raise FileNotFoundError(
            f"Symbol kind mappings config not found: {config_path}. "
            f"Create {DEFAULT_CONFIG_PATH} with version entries."
        )

    with open(config_file, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    if config is None:
        raise FileNotFoundError(f"Empty config file: {config_path}")

    provider_config = config.get(provider)
    if provider_config is None:
        raise VersionNotFoundError(
            f"Provider '{provider}' not found in {config_path}. "
            f"Add a '{provider}' section with version entries."
        )

    # Try exact match first, then major.minor match
    version_config = provider_config.get(version) or provider_config.get(str(version))
    if version_config is None:
        # Try matching major.minor only (e.g., "6.1.0" matches "6.1")
        short_version = ".".join(version.split(".")[:2])
        version_config = provider_config.get(short_version) or provider_config.get(str(short_version))

    if version_config is None:
        available = list(provider_config.keys())
        raise VersionNotFoundError(
            f"{provider} version '{version}' not found in {config_path}. "
            f"Available versions: {available}. "
            f"Add a '{version}' entry under '{provider}' before running."
        )

    # Convert string kind names to SymbolKind enum values
    mappings = {}
    for label, kind_name in version_config.items():
        kind = _KIND_NAME_MAP.get(kind_name, SymbolKind.UNKNOWN)
        mappings[label] = kind

    logger.info(f"Loaded {len(mappings)} kind mappings for {provider} v{version}")
    return mappings


def detect_ctags_version() -> Optional[str]:
    """Detect installed ctags version by running `ctags --version`.

    Returns:
        Version string (e.g. '6.1') or None if ctags not available.
    """
    try:
        result = subprocess.run(
            ["ctags", "--version"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            # Parse version from output like:
            # "Universal Ctags 6.1.0(5c447cb3), ..."
            # "Universal Ctags 6.0.0, ..."
            match = re.search(r"Universal Ctags (\d+\.\d+(?:\.\d+)?)", result.stdout)
            if match:
                version = match.group(1)
                # Return major.minor for config lookup
                parts = version.split(".")
                return f"{parts[0]}.{parts[1]}" if len(parts) >= 2 else version
            # Fallback: try "Exuberant Ctags" format
            match = re.search(r"Exuberant Ctags (\d+\.\d+)", result.stdout)
            if match:
                return match.group(1)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass

    return None


def _find_config_path() -> str:
    """Find the config file, searching from CWD upward."""
    # Try relative to CWD first
    cwd = Path.cwd()
    candidate = cwd / DEFAULT_CONFIG_PATH
    if candidate.exists():
        return str(candidate)

    # Try relative to this file's location (project root)
    project_root = Path(__file__).parent.parent.parent
    candidate = project_root / DEFAULT_CONFIG_PATH
    if candidate.exists():
        return str(candidate)

    return str(cwd / DEFAULT_CONFIG_PATH)
