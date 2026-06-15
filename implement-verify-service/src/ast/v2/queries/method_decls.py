"""Find method declarations whose name matches a pattern.

Used by frameworks where the route is the method NAME (Yii2 actionXxx,
Stapler doXxx, WordPress hooks, etc.) — no annotations or DSL.

Output: MethodDecl records (file, line, method name, class).
"""
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass
class MethodDecl:
    file: str
    line: int
    method: str
    cls: str = ""


# Per-language method-declaration regexes that capture the method name.
LANG_PATTERNS: dict[str, re.Pattern] = {
    "php":  re.compile(r"\b(?:public|protected|private)?\s*function\s+(?P<name>\w+)\s*\("),
    "java": re.compile(r"\b(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>\[\],\s]+?)\s+(?P<name>[A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{"),
    "py":   re.compile(r"^\s*def\s+(?P<name>\w+)\s*\("),
    "rb":   re.compile(r"^\s*def\s+(?P<name>\w+)"),
    "ts":   re.compile(r"^\s*(?:public|private|protected|async)?\s*(?P<name>\w+)\s*\([^)]*\)\s*[:{]"),
    "js":   re.compile(r"^\s*(?:async\s+)?(?P<name>\w+)\s*\([^)]*\)\s*\{"),
}

CLASS_PATTERNS: dict[str, re.Pattern] = {
    "php":  re.compile(r"\bclass\s+(?P<name>\w+)"),
    "java": re.compile(r"\bclass\s+(?P<name>\w+)"),
    "py":   re.compile(r"^\s*class\s+(?P<name>\w+)"),
    "rb":   re.compile(r"^\s*class\s+(?P<name>\w+)"),
    "ts":   re.compile(r"\bclass\s+(?P<name>\w+)"),
    "js":   re.compile(r"\bclass\s+(?P<name>\w+)"),
}


class MethodDeclsQuery:
    """Find method declarations matching a name pattern."""

    def __init__(self, project_root: str | Path):
        self._root = Path(project_root)

    def in_files(self, files: Iterable[str], name_pattern: str) -> list[MethodDecl]:
        """Walk files. Return method decls whose name matches `name_pattern` (regex)."""
        name_re = re.compile(name_pattern)
        out: list[MethodDecl] = []
        for rel in files:
            ext = Path(rel).suffix.lstrip(".").lower()
            method_re = LANG_PATTERNS.get(ext)
            class_re = CLASS_PATTERNS.get(ext)
            if method_re is None:
                continue
            abs_path = self._root / rel
            if not abs_path.exists():
                continue
            try:
                source = abs_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            current_class = ""
            for i, line in enumerate(source.splitlines(), start=1):
                if class_re:
                    cm = class_re.search(line)
                    if cm:
                        current_class = cm.group("name")
                m = method_re.search(line)
                if m:
                    name = m.group("name")
                    if name_re.match(name):
                        out.append(MethodDecl(
                            file=rel, line=i,
                            method=name, cls=current_class,
                        ))
        return out
