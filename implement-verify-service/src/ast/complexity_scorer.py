"""Per-file structural complexity scoring for triage decisions.

Scores each file 0.0-1.0 based on structural features.
Used by AstAnalysisStrategy to decide which files need LLM interpretation
vs which can be handled by deterministic structural analysis alone.
"""
from src.ast.models import StructuralAnalysis, SymbolKind


def score_complexity(analysis: StructuralAnalysis) -> float:
    """Score structural complexity of a file from 0.0 (trivial) to 1.0 (complex).

    Factors and weights:
      - Symbol count: more symbols = more complex
      - Inheritance depth: deeper = more complex
      - Call count: more calls = more interconnected
      - Async methods: concurrency adds complexity
      - Decorator count: metaprogramming
      - Import count: more dependencies = wider surface
    """
    if not analysis.symbols:
        return 0.0

    symbol_count = len(analysis.symbols)
    call_count = len(analysis.calls) if analysis.calls else 0
    import_count = len(analysis.imports) if analysis.imports else 0
    inheritance_count = len(analysis.inheritance) if analysis.inheritance else 0

    # Count classes, methods, async methods, decorators
    class_count = sum(1 for s in analysis.symbols if s.kind == SymbolKind.CLASS)
    method_count = sum(1 for s in analysis.symbols if s.kind == SymbolKind.METHOD)
    async_count = sum(1 for s in analysis.symbols if getattr(s, 'is_async', False))
    decorator_count = sum(
        len(s.decorators) for s in analysis.symbols
        if hasattr(s, 'decorators') and s.decorators
    )

    # Max inheritance depth
    max_depth = 0
    for inh in (analysis.inheritance or []):
        depth = len(inh.bases) if inh.bases else 0
        max_depth = max(max_depth, depth)

    # Weighted scoring (each factor contributes 0.0 to ~0.2)
    scores = [
        min(1.0, symbol_count / 20) * 0.15,       # 20+ symbols = max
        min(1.0, call_count / 15) * 0.25,          # 15+ calls = max (heaviest weight)
        min(1.0, import_count / 10) * 0.10,        # 10+ imports = max
        min(1.0, inheritance_count / 3) * 0.15,    # 3+ inheritance = max
        min(1.0, max_depth / 3) * 0.10,            # depth 3+ = max
        min(1.0, async_count / 3) * 0.10,          # 3+ async = max
        min(1.0, class_count / 3) * 0.10,          # 3+ classes = max
        min(1.0, decorator_count / 5) * 0.05,      # 5+ decorators = max
    ]

    return round(sum(scores), 2)


def triage(
    structural_results: dict[str, StructuralAnalysis],
    threshold: float = 0.3,
) -> tuple[list[str], list[str]]:
    """Triage files into SKIP and ANALYZE lists based on complexity.

    Args:
        structural_results: file_path → StructuralAnalysis
        threshold: complexity score below which files are skipped

    Returns:
        (skip_files, analyze_files) — two lists of file paths
    """
    skip_files: list[str] = []
    analyze_files: list[str] = []

    for file_path, analysis in structural_results.items():
        score = score_complexity(analysis)

        # Force-skip rules (regardless of score)
        if _is_trivial(analysis, file_path):
            skip_files.append(file_path)
            continue

        if score >= threshold:
            analyze_files.append(file_path)
        else:
            skip_files.append(file_path)

    return skip_files, analyze_files


def _is_trivial(analysis: StructuralAnalysis, file_path: str) -> bool:
    """Check if a file is trivially simple and should always be skipped."""
    symbols = analysis.symbols or []

    # __init__.py with only imports
    if file_path.endswith("__init__.py") and len(symbols) <= 1:
        return True

    # ≤2 symbols with no inheritance and no calls
    if (len(symbols) <= 2
            and not analysis.inheritance
            and not analysis.calls):
        return True

    # All symbols are variables/constants (config file, constants file)
    if symbols and all(
        s.kind in (SymbolKind.VARIABLE, SymbolKind.CONSTANT)
        for s in symbols
    ):
        return True

    return False
