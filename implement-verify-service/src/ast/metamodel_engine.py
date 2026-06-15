"""Metamodel population engine.

Populates architecture.json entities from structural analysis data.
Uses versioned mappings from config/metamodel_mappings.yaml.
Hard stop if metamodel version_id is unknown.
"""
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

import yaml

from src.ast.kind_mapping_loader import VersionNotFoundError
from src.ast.models import StructuralAnalysis, SymbolKind

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = "config/metamodel_mappings.yaml"

# Canonical kind name → SymbolKind for reverse lookup
_KIND_NAME_TO_ENUM = {
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

# Heuristic detection file patterns
_DOCKERFILE_NAMES = {"Dockerfile", "dockerfile", "Dockerfile.dev", "Dockerfile.prod"}
_MAIN_ENTRYPOINTS = {"main.py", "app.py", "server.py", "index.js", "main.go", "Main.java"}
_ROUTE_DECORATORS = {"@app.route", "@router.", "@app.get", "@app.post", "@app.put", "@app.delete", "@api_view"}


class MetamodelEngine:
    """Populate metamodel entities from structural analysis data.

    Reads config/metamodel_mappings.yaml for version-qualified mapping rules.
    Hard stop (VersionNotFoundError) if metamodel version_id not found.
    """

    def __init__(self, config_path: str = None):
        if config_path is None:
            config_path = _find_config_path()
        self._config_path = config_path
        self._mappings_cache: dict = {}

    def populate(
        self,
        metamodel: dict,
        analyses: dict[str, StructuralAnalysis],
        project_root: str = ".",
    ) -> dict:
        """Populate metamodel with entities from structural analysis.

        Args:
            metamodel: The architecture.json dict to enrich.
            analyses: Dict of file_path → StructuralAnalysis.
            project_root: Root directory for heuristic detection.

        Returns:
            Enriched metamodel dict with new entities and relationships.

        Raises:
            VersionNotFoundError: If metamodel version_id not in config.
        """
        version_id = self._check_version(metamodel)
        mappings = self._load_mappings(version_id)

        # Apply direct entity mappings
        self._apply_direct_mappings(metamodel, analyses, mappings)

        # Apply heuristic mappings
        self._apply_heuristic_mappings(metamodel, analyses, mappings, project_root)

        # Apply relationship mappings
        self._apply_relationship_mappings(metamodel, analyses, mappings)

        return metamodel

    def _check_version(self, metamodel: dict) -> str:
        """Read version_id from metamodel. Hard stop if not found in config."""
        version_id = metamodel.get("version_id")
        if version_id is None:
            # Default to "1" and set it
            version_id = 1
            metamodel["version_id"] = version_id

        version_str = str(version_id)

        # Verify this version exists in our mappings
        config_file = Path(self._config_path)
        if not config_file.exists():
            raise FileNotFoundError(
                f"Metamodel mappings config not found: {self._config_path}"
            )

        with open(config_file, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)

        if config is None or version_str not in config:
            available = list(config.keys()) if config else []
            raise VersionNotFoundError(
                f"Metamodel version_id '{version_str}' not found in {self._config_path}. "
                f"Available versions: {available}."
            )

        return version_str

    def _load_mappings(self, version_id: str) -> dict:
        """Load mappings for a specific version. Cached."""
        if version_id in self._mappings_cache:
            return self._mappings_cache[version_id]

        with open(self._config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)

        mappings = config[version_id]
        self._mappings_cache[version_id] = mappings
        return mappings

    def _apply_direct_mappings(
        self,
        metamodel: dict,
        analyses: dict[str, StructuralAnalysis],
        mappings: dict,
    ):
        """Map symbols to metamodel entities based on kind."""
        entity_mappings = mappings.get("entity_mappings", {})

        for entity_type, mapping in entity_mappings.items():
            source_kind_name = mapping.get("source_kind")
            if not source_kind_name:
                continue

            source_kind = _KIND_NAME_TO_ENUM.get(source_kind_name)
            if source_kind is None:
                continue

            id_prefix = mapping.get("id_prefix", entity_type)
            parent_ref = mapping.get("parent_ref", False)

            # Ensure entity list exists
            if entity_type not in metamodel:
                metamodel[entity_type] = []

            existing_names = {e.get("name") for e in metamodel[entity_type]}

            for file_path, analysis in analyses.items():
                for symbol in analysis.symbols:
                    if symbol.kind == source_kind and symbol.name not in existing_names:
                        entity = {
                            "id": _generate_entity_id(id_prefix, symbol.name),
                            "name": symbol.name,
                            "source_file": file_path,
                        }
                        if parent_ref and symbol.scope:
                            entity["parent_ref"] = _generate_entity_id(
                                entity_mappings.get("classes", {}).get("id_prefix", "class"),
                                symbol.scope,
                            )
                        if symbol.signature:
                            entity["signature"] = symbol.signature

                        metamodel[entity_type].append(entity)
                        existing_names.add(symbol.name)

    def _apply_heuristic_mappings(
        self,
        metamodel: dict,
        analyses: dict[str, StructuralAnalysis],
        mappings: dict,
        project_root: str,
    ):
        """Detect services, components, endpoints via heuristic rules."""
        heuristic_mappings = mappings.get("heuristic_mappings", {})
        project_path = Path(project_root)

        for entity_type, mapping in heuristic_mappings.items():
            detect_rules = mapping.get("detect_by", [])
            id_prefix = mapping.get("id_prefix", entity_type)

            if entity_type not in metamodel:
                metamodel[entity_type] = []

            existing_names = {e.get("name") for e in metamodel[entity_type]}

            if "has_dockerfile" in detect_rules:
                self._detect_services_by_dockerfile(
                    metamodel, entity_type, id_prefix, analyses, project_path, existing_names
                )

            if "top_level_directory_with_sources" in detect_rules:
                self._detect_components_by_directory(
                    metamodel, entity_type, id_prefix, analyses, existing_names
                )

            if "has_route_decorator" in detect_rules:
                self._detect_endpoints(
                    metamodel, entity_type, id_prefix, analyses, existing_names
                )

    def _detect_services_by_dockerfile(
        self, metamodel, entity_type, id_prefix, analyses, project_path, existing_names
    ):
        """Detect service entities by presence of Dockerfile or main entrypoints."""
        # Group files by top-level directory
        directories: dict[str, list[str]] = {}
        for file_path in analyses:
            parts = Path(file_path).parts
            if len(parts) > 1:
                top_dir = parts[0]
            else:
                top_dir = "."
            directories.setdefault(top_dir, []).append(file_path)

        for dir_name, files in directories.items():
            # Check for Dockerfile or main entrypoint
            has_docker = any(Path(f).name in _DOCKERFILE_NAMES for f in files)
            has_main = any(Path(f).name in _MAIN_ENTRYPOINTS for f in files)
            has_routes = any(
                any(symbol.name.startswith(("route", "endpoint", "api"))
                    for symbol in analyses[f].symbols)
                for f in files
                if f in analyses
            )

            if (has_docker or has_main or has_routes) and dir_name not in existing_names:
                metamodel[entity_type].append({
                    "id": _generate_entity_id(id_prefix, dir_name),
                    "name": dir_name,
                    "detected_by": [
                        r for r in ["has_dockerfile", "has_main_entrypoint", "has_api_routes"]
                        if (r == "has_dockerfile" and has_docker) or
                           (r == "has_main_entrypoint" and has_main) or
                           (r == "has_api_routes" and has_routes)
                    ],
                })
                existing_names.add(dir_name)

    def _detect_components_by_directory(
        self, metamodel, entity_type, id_prefix, analyses, existing_names
    ):
        """Detect components as top-level directories containing source files."""
        top_dirs = set()
        for file_path in analyses:
            parts = Path(file_path).parts
            if len(parts) > 1:
                top_dirs.add(parts[0])

        for dir_name in sorted(top_dirs):
            if dir_name not in existing_names:
                metamodel[entity_type].append({
                    "id": _generate_entity_id(id_prefix, dir_name),
                    "name": dir_name,
                })
                existing_names.add(dir_name)

    def _detect_endpoints(
        self, metamodel, entity_type, id_prefix, analyses, existing_names
    ):
        """Detect API endpoints from route decorators."""
        for file_path, analysis in analyses.items():
            for symbol in analysis.symbols:
                # Check for route-like functions
                if symbol.kind == SymbolKind.FUNCTION and symbol.scope:
                    # Simple heuristic: functions with route-like names
                    if any(kw in (symbol.scope or "") for kw in ("route", "router", "api")):
                        if symbol.name not in existing_names:
                            metamodel[entity_type].append({
                                "id": _generate_entity_id(id_prefix, symbol.name),
                                "name": symbol.name,
                                "source_file": file_path,
                            })
                            existing_names.add(symbol.name)

    def _apply_relationship_mappings(
        self,
        metamodel: dict,
        analyses: dict[str, StructuralAnalysis],
        mappings: dict,
    ):
        """Map import relationships between services to interactions."""
        rel_mappings = mappings.get("relationship_mappings", {})

        for rel_type, mapping in rel_mappings.items():
            if rel_type not in metamodel:
                metamodel[rel_type] = []

            # For now, detect import-based relationships between top-level dirs
            id_prefix = mapping.get("id_prefix", rel_type)
            between = mapping.get("between", "services")

            service_names = {
                e.get("name")
                for e in metamodel.get(between, [])
            }

            if not service_names:
                continue

            # Build import graph between services
            existing_rels = {
                (r.get("source"), r.get("target"))
                for r in metamodel[rel_type]
            }

            for file_path, analysis in analyses.items():
                source_dir = Path(file_path).parts[0] if Path(file_path).parts else ""
                if source_dir not in service_names:
                    continue

                for imp in (analysis.imports or []):
                    target_module = imp if isinstance(imp, str) else str(imp)
                    target_dir = target_module.split(".")[0] if "." in target_module else target_module
                    if (
                        target_dir in service_names
                        and target_dir != source_dir
                        and (source_dir, target_dir) not in existing_rels
                    ):
                        metamodel[rel_type].append({
                            "id": _generate_entity_id(id_prefix, f"{source_dir}_to_{target_dir}"),
                            "source": source_dir,
                            "target": target_dir,
                        })
                        existing_rels.add((source_dir, target_dir))


def _generate_entity_id(prefix: str, name: str) -> str:
    """Generate a deterministic entity ID matching architecture.json pattern."""
    sanitized = name.replace("-", "_").replace(".", "_").replace("/", "_").replace(" ", "_").lower()
    return f"{prefix}_{sanitized}"


def _find_config_path() -> str:
    """Find the config file."""
    cwd = Path.cwd()
    candidate = cwd / DEFAULT_CONFIG_PATH
    if candidate.exists():
        return str(candidate)

    project_root = Path(__file__).parent.parent.parent
    candidate = project_root / DEFAULT_CONFIG_PATH
    if candidate.exists():
        return str(candidate)

    return str(cwd / DEFAULT_CONFIG_PATH)
