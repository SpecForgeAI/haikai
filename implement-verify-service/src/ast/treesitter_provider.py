"""Tree-sitter based call graph extraction.

Config-driven multi-language provider. Routes files to the correct
language extractor based on file extension, then resolves call targets
using the shared 5-stage resolution pipeline.

Architecture:
    config/treesitter_languages.yaml  → extension → extractor mapping
    src/ast/extractors/*.py           → per-language AST walking
    src/ast/treesitter_resolver.py    → language-agnostic resolution
    src/ast/treesitter_utils.py       → index/import file parsing
"""
import logging
from pathlib import Path
from typing import Optional

from src.ast.models import StructuralAnalysis, ImportInfo
from src.ast.provider import AnalysisProvider
from src.ast.treesitter_models import RawCallSite, ResolutionContext
from src.ast.treesitter_resolver import CallResolver
from src.ast.treesitter_utils import parse_index, parse_imports
from src.ast.treesitter_config import load_extractors

logger = logging.getLogger(__name__)


class TreeSitterProvider(AnalysisProvider):
    """Config-driven call graph extraction via tree-sitter AST parsing.

    Routes files to per-language extractors, merges raw call sites,
    then resolves all calls through the shared pipeline.
    """

    def __init__(
        self,
        index_path: Optional[str] = None,
        imports_path: Optional[str] = None,
        config_path: Optional[str] = None,
    ):
        self._index_path = index_path
        self._imports_path = imports_path
        self._resolver = CallResolver()
        self._extractors = load_extractors(config_path)

    @property
    def name(self) -> str:
        return "treesitter"

    def is_available(self) -> bool:
        return len(self._extractors) > 0

    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Parse all files, extract calls, resolve targets.

        Groups files by extension, routes to correct extractor,
        then resolves all calls through the shared pipeline.
        """
        # Group files by extractor
        grouped: dict[str, list[str]] = {}
        for fp in file_paths:
            ext = Path(fp).suffix
            if ext in self._extractors:
                grouped.setdefault(ext, []).append(fp)

        if not grouped:
            return {}

        # Phase 1: Extract raw data from all files using per-language extractors
        all_calls: dict[str, list[RawCallSite]] = {}
        all_assignments: dict[str, str] = {}
        all_annotations: dict[str, str] = {}
        all_imports: dict[str, list[ImportInfo]] = {}

        file_languages: dict[str, str] = {}

        for ext, files in grouped.items():
            extractor = self._extractors[ext]
            for fp in files:
                try:
                    source = Path(fp).read_bytes()
                except Exception:
                    continue

                calls = extractor.extract_calls(source, fp)
                if calls:
                    all_calls[fp] = calls

                assignments = extractor.extract_assignments(source)
                all_assignments.update(assignments)

                annotations = extractor.extract_annotations(source)
                all_annotations.update(annotations)

                raw_imports = extractor.extract_imports(source)
                if raw_imports:
                    all_imports[fp] = [
                        ImportInfo(module=module, names=names, is_relative=is_rel)
                        for module, names, is_rel in raw_imports
                    ]

                # Track language per file (derive from extension)
                file_languages[fp] = ext.lstrip(".")

        # Phase 2: Build resolution context
        context = ResolutionContext(
            assignments=all_assignments,
            annotations=all_annotations,
        )

        if self._index_path:
            context.symbol_index, context.class_index = parse_index(self._index_path)

        if self._imports_path:
            context.imports = parse_imports(self._imports_path)

        # Phase 3: Resolve each call
        all_analyzed_files = []
        for files in grouped.values():
            all_analyzed_files.extend(files)

        results: dict[str, StructuralAnalysis] = {}
        for fp in all_analyzed_files:
            raw = all_calls.get(fp, [])
            resolved = [self._resolver.resolve(c, context) for c in raw]

            # Map extension to language name
            lang = file_languages.get(fp, "unknown")
            lang_map = {"py": "python", "pyi": "python", "ts": "typescript",
                        "tsx": "typescript", "js": "javascript", "jsx": "javascript",
                        "go": "go"}

            results[fp] = StructuralAnalysis(
                file_path=fp,
                language=lang_map.get(lang, lang),
                imports=all_imports.get(fp, []),
                calls=resolved,

                provider_used="treesitter",
                analysis_depth="rich",
            )

        total_calls = sum(len(a.calls) for a in results.values())
        if total_calls:
            logger.info(
                f"Tree-sitter: {len(results)} files, {total_calls} call edges"
            )

        return results
