"""Utility functions for tree-sitter pipeline.

Language-agnostic helpers for parsing index and import files.
"""
import logging

logger = logging.getLogger(__name__)


def parse_index(index_path: str) -> tuple[dict[str, list[tuple[str, str]]], dict[str, str]]:
    """Parse _index.txt into symbol_index and class_index.

    Returns:
        (symbol_index, class_index) where:
        - symbol_index: {method_name: [(class_name, file_path)]}
        - class_index: {class_name: file_path}
    """
    symbol_index: dict[str, list[tuple[str, str]]] = {}
    class_index: dict[str, str] = {}

    try:
        with open(index_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.strip().split("\t")
                if len(parts) < 4:
                    continue
                file_path, kind, name, scope = parts[0], parts[1], parts[2], parts[3]

                if kind == "class":
                    class_index[name] = file_path

                if kind in ("method", "function"):
                    class_name = scope if scope != "-" else ""
                    symbol_index.setdefault(name, []).append((class_name, file_path))
    except FileNotFoundError:
        pass

    return symbol_index, class_index


def parse_imports(imports_path: str) -> dict[str, tuple[str, str]]:
    """Parse _imports.txt into {name: (module_path, name)} dict.

    Returns:
        {imported_name: (module_file_path, original_name)}
    """
    imports: dict[str, tuple[str, str]] = {}

    try:
        with open(imports_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.strip().split("\t")
                if len(parts) < 3:
                    continue
                file_path, module, names = parts[0], parts[1], parts[2]
                for name in names.split(","):
                    name = name.strip()
                    if name:
                        imports[name] = (module.replace(".", "/") + ".py", name)
    except FileNotFoundError:
        pass

    return imports
