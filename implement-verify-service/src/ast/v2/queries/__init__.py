"""Lazy structural queries against the snapshot store.

Each query reads existing snapshot files (_index.txt, _imports.txt,
_inheritance.txt) and surfaces structured records the playbook executor
can iterate over.

Tree-sitter-backed queries (annotations.py, call_args.py) are added
in Phase 2/3.
"""
from .imports import ImportsQuery
from .index import IndexQuery
from .inheritance import InheritanceQuery
from .files import FilesQuery
from .cache import QueryCache

__all__ = [
    "ImportsQuery", "IndexQuery", "InheritanceQuery", "FilesQuery",
    "QueryCache",
]
