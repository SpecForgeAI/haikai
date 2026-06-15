"""Load and run tree-sitter queries from the .scm files in tree_sitter_queries/.

Centralises the boilerplate so annotations.py / call_args.py just ask for
`run_query(lang_name, query_name, source)` and get back the matches.

Notes on the tree-sitter 0.22+ API:
  - `Query(language, scm_text)` parses the query (throws on bad syntax)
  - `QueryCursor(query).matches(node)` yields `(pattern_index, captures_dict)`
  - Each `captures_dict` is `{capture_name: list[Node]}`
"""
from functools import lru_cache
from pathlib import Path
from typing import Any

# Resolve tree_sitter_queries relative to this file
_QUERY_DIR = Path(__file__).parent / "tree_sitter_queries"


def _language_module(lang_name: str):
    """Return the tree-sitter language function for a name like 'java', 'python'."""
    mapping = {
        "java":       ("tree_sitter_java",       "language"),
        "python":     ("tree_sitter_python",     "language"),
        "typescript": ("tree_sitter_typescript", "language_typescript"),
        "tsx":        ("tree_sitter_typescript", "language_tsx"),
        "csharp":     ("tree_sitter_c_sharp",    "language"),
        "php":        ("tree_sitter_php",        "language_php"),
        "ruby":       ("tree_sitter_ruby",       "language"),
        "go":         ("tree_sitter_go",         "language"),
    }
    mod_name, fn_name = mapping[lang_name]
    import importlib
    mod = importlib.import_module(mod_name)
    return getattr(mod, fn_name)()


@lru_cache(maxsize=32)
def _load_language(lang_name: str):
    from tree_sitter import Language
    return Language(_language_module(lang_name))


@lru_cache(maxsize=32)
def _load_query(lang_name: str, query_name: str):
    """Load and compile a .scm file. Cached so we parse each query exactly once."""
    from tree_sitter import Query
    scm_path = _QUERY_DIR / lang_name / f"{query_name}.scm"
    if not scm_path.exists():
        raise FileNotFoundError(f"Query not found: {scm_path}")
    lang = _load_language(lang_name)
    scm_text = scm_path.read_text(encoding="utf-8")
    return Query(lang, scm_text)


def parse(lang_name: str, source: bytes):
    """Parse source into a tree for the given language."""
    from tree_sitter import Parser
    lang = _load_language(lang_name)
    parser = Parser(lang)
    return parser.parse(source)


def run_query(lang_name: str, query_name: str, source: bytes) -> list[tuple[int, dict[str, list]]]:
    """Run a named query over source and return the matches.

    Each match is (pattern_index, captures_dict) where captures_dict maps
    capture name (e.g. 'ann.name') to a list of nodes.
    """
    from tree_sitter import QueryCursor
    tree = parse(lang_name, source)
    q = _load_query(lang_name, query_name)
    cursor = QueryCursor(q)
    return list(cursor.matches(tree.root_node))


def node_text(node, source: bytes) -> str:
    return source[node.start_byte:node.end_byte].decode("utf-8", "replace")


def first_capture(captures: dict[str, list], name: str, source: bytes) -> str:
    """Convenience: decode the first node for a capture name, or empty string."""
    nodes = captures.get(name) or []
    if not nodes:
        return ""
    return node_text(nodes[0], source)
