"""Interaction classifier — orchestrates pre-classified + LLM classification.

Takes all call sites from AST extraction. Interactions already identified
by tree-sitter are pre-classified; remaining calls go to the LLM agent.
"""
import logging
import yaml
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from src.ast.models import StructuralAnalysis, CallInfo, InteractionInfo
from src.ast.framework_detector import detect_frameworks, FrameworkMatch, FRAMEWORK_SIGNATURES

logger = logging.getLogger(__name__)


# Categories that are NOT external interactions — skip these frameworks
INTERNAL_CATEGORIES = {"testing", "validation", "serialization", "utility", "frontend"}


@dataclass
class UnclassifiedCall:
    """A call site not yet classified as an external interaction."""
    call: CallInfo
    file_path: str
    framework: Optional[str] = None  # detected framework, if any
    framework_category: Optional[str] = None


@dataclass
class FrameworkBatch:
    """A group of unclassified calls from the same framework."""
    framework: str
    category: str
    language: str
    calls: list[UnclassifiedCall] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)  # relevant import modules


@dataclass
class ClassificationResult:
    """Output of the classification process."""
    pre_classified: list[InteractionInfo]      # from tree-sitter extraction
    llm_classified: list[InteractionInfo]      # from LLM agent
    unclassified_batches: list[FrameworkBatch]  # grouped for LLM processing
    stats: dict = field(default_factory=dict)


class InteractionClassifier:
    """Orchestrates interaction classification.

    Flow:
    1. Collect all calls + already-classified interactions from AST results
    2. Identify unclassified calls (not pre-classified by tree-sitter)
    3. Group unclassified by framework
    4. (Phase 3) Send batches to LLM agent for classification
    """

    def __init__(self):
        self._classified_keys: set[str] = set()

    def detect_unclassified(
        self,
        analyses: dict[str, StructuralAnalysis],
    ) -> tuple[list[InteractionInfo], list[UnclassifiedCall]]:
        """Separate pre-classified interactions from unclassified calls.

        Returns:
            (pre_classified, unclassified) — interactions already identified
            by tree-sitter, and calls that need LLM classification.
        """
        pre_classified: list[InteractionInfo] = []
        unclassified: list[UnclassifiedCall] = []

        for file_path, analysis in analyses.items():
            # Collect pre-classified interactions (from tree-sitter)
            for interaction in analysis.interactions:
                pre_classified.append(interaction)
                # Track classified call sites by (file, line) to avoid duplicates
                self._classified_keys.add((file_path, interaction.line))

            # Find calls that weren't classified
            for call in analysis.calls:
                key = (call.caller_file, call.line)
                if key not in self._classified_keys:
                    # Skip obvious internal calls (stdlib, builtins)
                    if self._is_likely_internal(call):
                        continue
                    unclassified.append(UnclassifiedCall(
                        call=call,
                        file_path=call.caller_file,
                    ))

        logger.info(
            f"Classification: {len(pre_classified)} pre-classified, "
            f"{len(unclassified)} unclassified calls"
        )
        return pre_classified, unclassified

    def batch_by_framework(
        self,
        unclassified: list[UnclassifiedCall],
        analyses: dict[str, StructuralAnalysis],
    ) -> list[FrameworkBatch]:
        """Group unclassified calls by detected framework.

        Uses framework_detector to identify which framework each call
        likely belongs to, based on the file's imports.
        """
        # Detect frameworks across the repo
        frameworks = detect_frameworks(analyses)
        framework_map = {fw.name: fw for fw in frameworks}

        # Build file → imports mapping
        file_imports: dict[str, list[str]] = {}
        for file_path, analysis in analyses.items():
            file_imports[file_path] = [imp.module for imp in analysis.imports]

        # Build file → framework mapping (which frameworks does each file use?)
        file_frameworks: dict[str, list[FrameworkMatch]] = {}
        for file_path, analysis in analyses.items():
            for imp in analysis.imports:
                for prefix, (fw_name, fw_cat) in FRAMEWORK_SIGNATURES.items():
                    if imp.module == prefix or imp.module.startswith(f"{prefix}."):
                        file_frameworks.setdefault(file_path, []).append(
                            framework_map.get(fw_name, FrameworkMatch(
                                name=fw_name, category=fw_cat,
                                confidence=0.5, import_count=1, evidence=[imp.module]
                            ))
                        )

        # Group calls by framework
        batches: dict[str, FrameworkBatch] = {}
        unknown_batch = FrameworkBatch(
            framework="unknown", category="unknown", language="unknown"
        )

        for uc in unclassified:
            file_fws = file_frameworks.get(uc.file_path, [])
            # Filter out internal frameworks (testing, validation, etc.)
            external_fws = [fw for fw in file_fws if fw.category not in INTERNAL_CATEGORIES]

            if external_fws:
                # Assign to the most relevant framework (highest import count)
                best_fw = max(external_fws, key=lambda fw: fw.import_count)
                uc.framework = best_fw.name
                uc.framework_category = best_fw.category

                key = best_fw.name
                if key not in batches:
                    # Detect language from file extension
                    lang = self._detect_language(uc.file_path)
                    batches[key] = FrameworkBatch(
                        framework=best_fw.name,
                        category=best_fw.category,
                        language=lang,
                        imports=best_fw.evidence[:10],
                    )
                batches[key].calls.append(uc)
            else:
                unknown_batch.calls.append(uc)

        result = list(batches.values())
        if unknown_batch.calls:
            result.append(unknown_batch)

        # Sort by call count descending (process largest batches first)
        result.sort(key=lambda b: len(b.calls), reverse=True)

        for batch in result:
            logger.info(
                f"Batch: {batch.framework} ({batch.category}) — "
                f"{len(batch.calls)} unclassified calls"
            )

        return result

    def _is_likely_internal(self, call: CallInfo) -> bool:
        """Quick filter for obviously internal calls."""
        callee = call.callee_name.lower()

        # Standard library / builtins
        internal_prefixes = (
            "print", "len", "str", "int", "float", "bool", "list", "dict",
            "set", "tuple", "range", "enumerate", "zip", "map", "filter",
            "isinstance", "issubclass", "hasattr", "getattr", "setattr",
            "super", "type", "id", "hash", "repr", "format",
            # Logging
            "logger.", "log.", "logging.",
            # Common internal
            "self.", "this.", "assert",
        )
        if any(callee.startswith(p) for p in internal_prefixes):
            return True

        # Unresolved calls with very low confidence are likely internal
        if call.confidence <= 0.20 and call.callee_file == "-":
            # Check if the method name looks like a stdlib call
            method = callee.rsplit(".", 1)[-1] if "." in callee else callee
            stdlib_methods = {
                "append", "extend", "insert", "remove", "pop", "clear",
                "sort", "reverse", "copy", "keys", "values", "items",
                "get", "update", "join", "split", "strip", "replace",
                "startswith", "endswith", "lower", "upper", "format",
                "encode", "decode", "read", "write", "close", "flush",
            }
            if method in stdlib_methods:
                return True

        return False

    def _detect_language(self, file_path: str) -> str:
        """Detect language from file extension."""
        ext_map = {
            ".py": "python", ".pyi": "python",
            ".java": "java",
            ".ts": "typescript", ".tsx": "typescript",
            ".js": "javascript", ".jsx": "javascript",
            ".go": "go",
            ".cs": "csharp",
            ".c": "c", ".h": "c",
            ".cpp": "cpp", ".hpp": "cpp",
            ".rs": "rust",
        }
        for ext, lang in ext_map.items():
            if file_path.endswith(ext):
                return lang
        return "unknown"

    # --- Orchestration ---

    def classify(
        self,
        analyses: dict[str, StructuralAnalysis],
        llm_client=None,
        project_root: str = ".",
        snapshot_path: str = None,
    ) -> ClassificationResult:
        """Run full classification: pre-classified + optional LLM.

        Args:
            analyses: AST extraction results
            llm_client: Optional LLMClient for LLM classification.
                        If None, only pre-classified interactions are used.
            project_root: Root path for source file reading.

        Returns:
            ClassificationResult with all classified interactions.
        """
        pre_classified, unclassified = self.detect_unclassified(analyses)
        batches = self.batch_by_framework(unclassified, analyses)

        llm_classified: list[InteractionInfo] = []

        if llm_client and batches:
            from src.ast.interaction_agent import classify_batch

            for batch in batches:
                if batch.framework == "unknown" and not batch.calls:
                    continue
                results = classify_batch(batch, llm_client, project_root)
                llm_classified.extend(results)

        # Enrich all classified interactions (resolve targets + data_hint)
        all_classified = pre_classified + llm_classified
        if llm_client and all_classified:
            from src.ast.interaction_enricher import enrich_interactions
            enrich_interactions(all_classified, llm_client, project_root, snapshot_path)

        total = len(pre_classified) + len(llm_classified)
        enriched_count = sum(1 for i in all_classified if i.data_hint)
        stats = {
            "pre_classified": len(pre_classified),
            "llm_classified": len(llm_classified),
            "enriched": enriched_count,
            "unclassified_calls": sum(len(b.calls) for b in batches),
            "framework_batches": len(batches),
            "total_interactions": total,
        }

        logger.info(
            f"Classification complete: {stats['pre_classified']} pre-classified, "
            f"{stats['llm_classified']} llm, {enriched_count} enriched, "
            f"{stats['total_interactions']} total"
        )

        return ClassificationResult(
            pre_classified=pre_classified,
            llm_classified=llm_classified,
            unclassified_batches=batches,
            stats=stats,
        )

    # --- Output writers ---

    @staticmethod
    def write_classified_interactions(
        path: Path,
        result: ClassificationResult,
        project_root: str = "",
    ):
        """Write _interactions.txt with classified_by provenance column."""
        lines = [
            "# type\ttarget\tdirection\tmechanism\tdata_entity\t"
            "source_class\tsource_method\tfile\tline\tconfidence\tclassified_by"
        ]

        def _normalize(file_path: str) -> str:
            if project_root and file_path.startswith(project_root):
                return file_path[len(project_root):].lstrip("/\\")
            return file_path.replace("\\", "/")

        def _tsv_safe(v) -> str:
            """Strip tabs/newlines from TSV cells.

            LLM-derived field values (target, source_class, etc) can contain
            literal `\\t` or `\\n` which would shift columns or split rows.
            Replace with a single space to keep the TSV parseable.
            """
            s = "" if v is None else str(v)
            return s.replace("\t", " ").replace("\n", " ").replace("\r", " ")

        def _row(interaction, classified_by: str) -> str:
            return (
                f"{_tsv_safe(interaction.target_type)}\t"
                f"{_tsv_safe(interaction.target)}\t"
                f"{_tsv_safe(interaction.direction)}\t"
                f"{_tsv_safe(interaction.mechanism)}\t"
                f"{_tsv_safe(interaction.data_hint)}\t"
                f"{_tsv_safe(interaction.source_class)}\t"
                f"{_tsv_safe(interaction.source_method)}\t"
                f"{_tsv_safe(_normalize(interaction.file))}\t"
                f"{interaction.line}\t"
                f"{interaction.confidence:.2f}\t"
                f"{classified_by}"
            )

        for interaction in result.pre_classified:
            lines.append(_row(interaction, "pre_classified"))

        for interaction in result.llm_classified:
            lines.append(_row(interaction, "llm"))

        with open(path / "_interactions.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    @staticmethod
    def write_classification_meta(path: Path, result: ClassificationResult):
        """Write _classification_meta.yaml with stats."""
        meta = {
            "classification": {
                "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "stats": result.stats,
                "framework_batches": [
                    {
                        "framework": b.framework,
                        "category": b.category,
                        "language": b.language,
                        "unclassified_calls": len(b.calls),
                    }
                    for b in result.unclassified_batches
                ],
            }
        }

        with open(path / "_classification_meta.yaml", "w", encoding="utf-8") as f:
            yaml.dump(meta, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
