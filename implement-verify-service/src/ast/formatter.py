"""Format StructuralAnalysis into compact text for LLM prompts.

This replaces raw source code in the LLM prompt. The output should be
information-dense and significantly smaller than the original code.

Sections emitted (when data exists):
  Imports      — module dependencies (ctags + tree-sitter)
  Symbols      — classes, functions, methods, variables (ctags)
  Inheritance  — class hierarchy (ctags)
  Calls        — who calls whom, grouped by caller (tree-sitter)
"""
from src.ast.models import StructuralAnalysis, SymbolInfo


def format_structural_output(analysis: StructuralAnalysis) -> str:
    """Format structural analysis as compact text for LLM consumption.

    Returns empty string if no structural data available.
    """
    if not analysis.symbols:
        return ""

    sections = []

    # Imports
    if analysis.imports:
        import_lines = [
            f"  {imp.module}" + (f" ({', '.join(imp.names)})" if imp.names else "")
            for imp in analysis.imports
        ]
        sections.append("Imports:\n" + "\n".join(import_lines))

    # Group symbols by scope
    top_level = [s for s in analysis.symbols if s.scope is None]
    by_scope: dict[str, list[SymbolInfo]] = {}
    for s in analysis.symbols:
        if s.scope:
            by_scope.setdefault(s.scope, []).append(s)

    # Format top-level symbols with scoped children
    symbol_lines = []
    for sym in sorted(top_level, key=lambda s: s.line_start):
        symbol_lines.append(_format_symbol(sym, indent=0))
        if sym.name in by_scope:
            for child in sorted(by_scope[sym.name], key=lambda s: s.line_start):
                symbol_lines.append(_format_symbol(child, indent=1))

    if symbol_lines:
        sections.append("Symbols:\n" + "\n".join(symbol_lines))

    # Inheritance
    if analysis.inheritance:
        inh_lines = [f"  {i.class_name} -> {', '.join(i.bases)}" for i in analysis.inheritance]
        sections.append("Inheritance:\n" + "\n".join(inh_lines))

    # Calls — grouped by caller for readability
    if analysis.calls:
        sections.append("Calls:\n" + _format_calls(analysis))

    return "\n\n".join(sections)


def _format_calls(analysis: StructuralAnalysis) -> str:
    """Format call edges grouped by caller function.

    Output example:
      OrderService.process:
        -> Database.execute (line 45)
        -> Logger.info (line 48)
        -> validate (line 42, external)
    """
    # Group by caller
    by_caller: dict[str, list] = {}
    for call in analysis.calls:
        by_caller.setdefault(call.caller_name, []).append(call)

    lines = []
    for caller, calls in sorted(by_caller.items()):
        lines.append(f"  {caller}:")
        for c in sorted(calls, key=lambda x: x.line):
            target = c.callee_name
            extras = []
            if c.line:
                extras.append(f"line {c.line}")
            if c.callee_file == "-":
                extras.append("external")
            suffix = f" ({', '.join(extras)})" if extras else ""
            lines.append(f"    -> {target}{suffix}")

    return "\n".join(lines)


def _format_symbol(sym: SymbolInfo, indent: int = 0) -> str:
    prefix = "  " * (indent + 1)
    parts = [f"{prefix}{sym.kind}: {sym.name}"]
    if sym.signature:
        parts[0] += sym.signature
    if sym.inherits:
        parts[0] += f" extends {sym.inherits}"
    extras = []
    if sym.is_async:
        extras.append("async")
    if sym.is_abstract:
        extras.append("abstract")
    if extras:
        parts[0] += f" [{', '.join(extras)}]"
    return parts[0]
