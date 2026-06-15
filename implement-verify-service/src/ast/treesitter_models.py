"""Shared models for tree-sitter call graph extraction.

These are language-agnostic data structures used by all extractors
and the resolution pipeline.
"""
from dataclasses import dataclass, field


@dataclass
class RawCallSite:
    """A call expression extracted from the AST, before resolution."""
    file_path: str
    caller_name: str       # e.g. "UserService.get_user" or "<module>"
    receiver: str | None   # e.g. "self.db" or None for bare calls
    method: str            # e.g. "query" or "print"
    line: int
    arguments: list[str] = field(default_factory=list)


@dataclass
class ResolutionContext:
    """Pre-computed data for resolving call targets."""
    # class_name.attr → resolved type name (from assignments)
    assignments: dict[str, str] = field(default_factory=dict)
    # class_name.attr → annotated type name
    annotations: dict[str, str] = field(default_factory=dict)
    # imported name → (module_path, original_name)
    imports: dict[str, tuple[str, str]] = field(default_factory=dict)
    # method_name → [(class_name, file_path)] from ctags index
    symbol_index: dict[str, list[tuple[str, str]]] = field(default_factory=dict)
    # class_name → file_path from ctags index
    class_index: dict[str, str] = field(default_factory=dict)
