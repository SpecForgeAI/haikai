"""Shared structural analysis pipeline.

Single source of truth for: ctags → store → tree-sitter imports → tree-sitter calls.
Used by both file_analyzer.py (standards extraction) and structural_endpoints.py (API).

Key design decision: tree-sitter import extraction runs FIRST as a separate pass,
writes _imports.txt to the store, THEN call resolution reads it back. This ensures
the ImportFollower resolver stage has fresh import data instead of stale/empty data.
"""

import logging
import os
from pathlib import Path
from typing import Optional

from src.ast.models import StructuralAnalysis
from src.ast.provider import ProviderRegistry
from src.ast.store import FileStore, get_git_info

logger = logging.getLogger(__name__)


def _record_failure(stats: Optional[dict], stage: str) -> None:
    """Append `stage` to stats['failed_stages']. Tolerates None / missing key."""
    if stats is None:
        return
    failed = stats.setdefault("failed_stages", [])
    if stage not in failed:
        failed.append(stage)


def _resolve_to_results_key(
    file_path: str, ctags_results: dict, project_root: Optional[str]
) -> Optional[str]:
    """Find the ctags_results key that matches `file_path`.

    The LLM-driven discoverers may emit `file` values that don't byte-match
    the keys in ctags_results (relative vs absolute, forward vs backslash,
    etc). Try several normalizations before giving up. Returns None if no
    match — the caller must NOT silently fall back to a random key (the
    prior `next(iter(ctags_results))` fallback was attributing endpoints
    to whichever file happened to be analyzed first).
    """
    if not file_path:
        return None
    # 1. Exact match
    if file_path in ctags_results:
        return file_path
    # 2. Resolve relative to project_root → absolute
    if project_root:
        candidate = str(Path(project_root) / file_path)
        if candidate in ctags_results:
            return candidate
        # 3. Forward-slash normalize (Windows mixed paths)
        candidate_fwd = candidate.replace("\\", "/")
        for key in ctags_results:
            if key.replace("\\", "/") == candidate_fwd:
                return key
    # 4. Basename match — only if unique (otherwise ambiguous)
    target_name = Path(file_path).name
    matches = [k for k in ctags_results if Path(k).name == target_name]
    if len(matches) == 1:
        return matches[0]
    return None


def run_structural_pipeline(
    file_paths: list[str],
    ctags_results: dict[str, StructuralAnalysis],
    store: FileStore,
    registry: ProviderRegistry,
    repo_name: Optional[str] = None,
    commit_sha: Optional[str] = None,
    branch: Optional[str] = None,
    project_root: Optional[str] = None,
    llm_client=None,
    discovery_stats: Optional[dict] = None,
) -> dict[str, StructuralAnalysis]:
    """Run the full structural pipeline: ctags → tree-sitter → interaction classification.

    Interaction classification always runs:
    - YAML fast path classifies known patterns (no cost)
    - If llm_client provided, LLM classifies unknown patterns

    Args:
        file_paths: Source files to analyze.
        ctags_results: Pre-computed ctags analysis results.
        store: FileStore instance to persist snapshots.
        registry: ProviderRegistry for result merging.
        repo_name: Override repo name (auto-detected from git if None).
        commit_sha: Override commit SHA (auto-detected if None).
        branch: Override branch name (auto-detected if None).
        project_root: Project root path (inferred from file_paths if None).
        llm_client: Optional LLMClient. If provided, LLM classifies unknown
                    interactions. If None, YAML-only classification.
        discovery_stats: Optional dict the caller provides to receive per-stage
            counters and a `failed_stages: list[str]`. Mutated in place so the
            API surface can expose partial failures.

    Returns:
        Enriched analysis results (ctags + tree-sitter merged).
    """
    # Initialize early so even the tree-sitter try/except below can record
    # failures into the same dict the caller reads back.
    if discovery_stats is None:
        discovery_stats = {}
    discovery_stats.setdefault("pre_classified", 0)
    discovery_stats.setdefault("llm_classified", 0)
    discovery_stats.setdefault("agentic_endpoints", 0)
    discovery_stats.setdefault("agentic_interactions", 0)
    discovery_stats.setdefault("enriched", 0)
    discovery_stats.setdefault("failed_stages", [])

    if not ctags_results:
        return ctags_results

    if project_root is None:
        project_root = str(Path(file_paths[0]).parent) if file_paths else "."

    # Auto-detect git info if not provided
    if repo_name is None or commit_sha is None or branch is None:
        git_info = get_git_info(project_root)
        repo_name = repo_name or git_info["repo_name"]
        commit_sha = commit_sha or git_info["commit_sha"]
        branch = branch or git_info["branch"]

    # Step 1: Write initial ctags snapshot (creates _index.txt, empty _imports.txt)
    snapshot_path = store.write_snapshot(
        repo_name=repo_name,
        commit_sha=commit_sha,
        branch=branch,
        provider="ctags",
        analyses=ctags_results,
        project_root=project_root,
    )

    # Step 2: Tree-sitter enrichment (if available and enabled)
    if os.environ.get("AST_TREESITTER_ENABLED", "true").lower() != "true":
        return ctags_results

    try:
        from src.ast.treesitter_provider import TreeSitterProvider
        ts_check = TreeSitterProvider()
        if not ts_check.is_available():
            return ctags_results
    except ImportError:
        return ctags_results

    try:
        snapshot = Path(snapshot_path)

        # Step 2a: Run tree-sitter IMPORT extraction first (no call resolution yet)
        ts_imports = TreeSitterProvider()  # No index/imports paths — just extract
        import_results = ts_imports.analyze_batch(file_paths)

        # Write fresh _imports.txt from tree-sitter data
        if import_results:
            store.write_imports(snapshot, import_results)
            logger.info(
                f"Tree-sitter imports: {sum(len(a.imports) for a in import_results.values())} "
                f"import lines written"
            )

        # Step 2b: Now run full call resolution WITH fresh imports available.
        # V2's discovery path only reads _imports.txt — call resolution is the
        # slowest stage on huge Java repos (alfresco/keycloak/kibana). Allow
        # callers to short-circuit it via env var.
        if os.environ.get("AST_SKIP_CALLS", "false").lower() == "true":
            logger.info("AST_SKIP_CALLS=true — skipping tree-sitter call resolution")
            # Build the dep graph from what we have (calls table will be empty,
            # but symbols/imports/inheritance still useful)
            _build_depgraph(snapshot_path)
            return ctags_results

        ts_calls = TreeSitterProvider(
            index_path=str(snapshot / "_index.txt"),
            imports_path=str(snapshot / "_imports.txt"),
        )
        call_results = ts_calls.analyze_batch(file_paths)

        if call_results:
            ctags_results = registry._merge_results(ctags_results, call_results)
            # Re-write enriched data to store
            store.write_calls(snapshot, ctags_results)
            store.write_imports(snapshot, ctags_results)
            store.write_endpoints(snapshot, ctags_results)
            store.write_interactions(snapshot, ctags_results)

    except Exception as e:
        logger.error("Tree-sitter enrichment failed", exc_info=True)
        _record_failure(discovery_stats, "treesitter_enrichment")

    # Step 3: Interaction classification (always runs)
    try:
        from src.ast.interaction_classifier import InteractionClassifier

        classifier = InteractionClassifier()
        result = classifier.classify(
            ctags_results,
            llm_client=llm_client,
            project_root=project_root or ".",
            snapshot_path=snapshot_path,
        )

        # Write classified output
        snapshot = Path(snapshot_path) if snapshot_path else None
        if snapshot:
            classifier.write_classified_interactions(snapshot, result, project_root or "")
            classifier.write_classification_meta(snapshot, result)

        discovery_stats["pre_classified"] = result.stats.get("pre_classified", result.stats.get("yaml_classified", 0))
        discovery_stats["llm_classified"] = result.stats.get("llm_classified", 0)
        discovery_stats["enriched"] = result.stats.get("enriched", 0)

        logger.info(
            f"Interaction classification: {discovery_stats['pre_classified']} pre-classified, "
            f"{result.stats.get('llm_classified', 0)} llm"
        )

    except Exception as e:
        logger.error("Interaction classification failed", exc_info=True)
        _record_failure(discovery_stats, "interaction_classification")

    # Step 4: Agentic endpoint discovery (LLM reads structural store)
    try:
        from src.ast.endpoint_discoverer import discover_endpoints

        discovered_endpoints = discover_endpoints(
            llm_client=llm_client,
            project_root=project_root or ".",
            snapshot_path=snapshot_path,
        )

        if discovered_endpoints:
            # Assign endpoints to their source files in the results.
            # Don't silently fall back to a random first key when the LLM's
            # `file` doesn't match — that mis-attributes endpoints. Drop and
            # log instead.
            unmatched: list[str] = []
            for ep in discovered_endpoints:
                key = _resolve_to_results_key(ep.file, ctags_results, project_root)
                if key:
                    ctags_results[key].endpoints.append(ep)
                else:
                    unmatched.append(ep.file)
            if unmatched:
                logger.warning(
                    f"Dropped {len(unmatched)} discovered endpoints whose source file "
                    f"didn't match any analyzed file (first 5: {unmatched[:5]})"
                )

            # Re-write endpoints to store
            snapshot = Path(snapshot_path) if snapshot_path else None
            if snapshot:
                store.write_endpoints(snapshot, ctags_results)

            discovery_stats["agentic_endpoints"] = len(discovered_endpoints) - len(unmatched)
            logger.info(
                f"Agentic endpoint discovery: {len(discovered_endpoints)} discovered, "
                f"{discovery_stats['agentic_endpoints']} attached"
            )

    except Exception as e:
        logger.error("Agentic endpoint discovery failed", exc_info=True)
        _record_failure(discovery_stats, "agentic_endpoints")

    # Step 5: Agentic interaction discovery (LLM reads structural store)
    try:
        from src.ast.interaction_discoverer import discover_interactions

        discovered_interactions = discover_interactions(
            llm_client=llm_client,
            project_root=project_root or ".",
            snapshot_path=snapshot_path,
        )

        if discovered_interactions:
            # Assign interactions to their source files. Same anti-mis-
            # attribution policy as endpoints above.
            unmatched_int: list[str] = []
            for interaction in discovered_interactions:
                key = _resolve_to_results_key(interaction.file, ctags_results, project_root)
                if key:
                    ctags_results[key].interactions.append(interaction)
                else:
                    unmatched_int.append(interaction.file)
            if unmatched_int:
                logger.warning(
                    f"Dropped {len(unmatched_int)} discovered interactions whose source "
                    f"file didn't match any analyzed file (first 5: {unmatched_int[:5]})"
                )

            # Re-write interactions to store
            snapshot = Path(snapshot_path) if snapshot_path else None
            if snapshot:
                store.write_interactions(snapshot, ctags_results)

            discovery_stats["agentic_interactions"] = len(discovered_interactions) - len(unmatched_int)
            logger.info(
                f"Agentic interaction discovery: {len(discovered_interactions)} discovered, "
                f"{discovery_stats['agentic_interactions']} attached"
            )

            # Feed into enrichment if LLM available
            try:
                from src.ast.interaction_enricher import enrich_interactions
                all_interactions = []
                for analysis in ctags_results.values():
                    all_interactions.extend(analysis.interactions)
                if all_interactions:
                    enrich_interactions(
                        all_interactions, llm_client,
                        project_root=project_root or ".",
                        snapshot_path=snapshot_path,
                    )
                    # Re-write enriched interactions
                    if snapshot:
                        store.write_interactions(snapshot, ctags_results)
            except Exception as e:
                logger.error("Interaction enrichment after discovery failed", exc_info=True)
                _record_failure(discovery_stats, "interaction_enrichment")

    except Exception as e:
        logger.error("Agentic interaction discovery failed", exc_info=True)
        _record_failure(discovery_stats, "agentic_interactions")

    # Write final extraction metadata
    try:
        snapshot = Path(snapshot_path) if snapshot_path else None
        if snapshot:
            store.write_extraction_meta(
                snapshot, ctags_results,
                discovery_method="agentic",
                classification_stats=discovery_stats,
            )
    except Exception as e:
        logger.error("Failed to write extraction meta", exc_info=True)
        _record_failure(discovery_stats, "extraction_meta")

    # Step 8a: Mechanical diagram generation (existing 8 builders)
    if store.auto_generate_diagrams and snapshot_path:
        try:
            from src.ast.diagram_generator import DiagramGenerator
            generator = DiagramGenerator()
            generator.generate_all(Path(snapshot_path))
        except Exception as e:
            logger.error("Mechanical diagram generation failed", exc_info=True)
            _record_failure(discovery_stats, "mechanical_diagrams")

    # Step 8b: Agentic diagram discovery (requires LLM)
    if llm_client and store.auto_generate_diagrams and snapshot_path:
        try:
            from src.ast.diagram_discoverer import discover_diagrams
            agentic_models = discover_diagrams(
                llm_client=llm_client,
                project_root=project_root or ".",
                snapshot_path=snapshot_path,
            )
            if agentic_models:
                from src.ast.diagram_generator import DiagramGenerator
                generator = DiagramGenerator()
                generator.serialise_models(agentic_models, Path(snapshot_path))
        except Exception as e:
            logger.error("Agentic diagram discovery failed", exc_info=True)
            _record_failure(discovery_stats, "agentic_diagrams")

    # Step 9: Dependency graph build
    _build_depgraph(snapshot_path)

    return ctags_results


def _build_depgraph(snapshot_path: Optional[str]) -> None:
    """Build the per-snapshot SQLite dep graph from whatever TSVs exist.
    See: haikai/specs/2026-04-25-deep-dependency-analysis/spec.md
    Opt out via AST_SKIP_DEPGRAPH=true.
    """
    if not snapshot_path:
        return
    if os.environ.get("AST_SKIP_DEPGRAPH", "false").lower() == "true":
        return
    try:
        from src.dep import DepGraph
        DepGraph.open_or_build(snapshot_path).close()
    except Exception as e:
        logger.error("Dependency-graph build failed", exc_info=True)
