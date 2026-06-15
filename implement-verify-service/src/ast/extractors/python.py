"""Python-specific tree-sitter extractor.

Extracts calls, imports, assignments, and annotations from Python ASTs.
Moved from the monolithic CallExtractor in treesitter_provider.py.
"""
from typing import Optional, Any

import tree_sitter_python as tspython
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

PY_LANGUAGE = Language(tspython.language())


class PythonExtractor(LanguageExtractor):
    """Extract call sites, imports, assignments, and annotations from Python source."""

    def __init__(self):
        self._parser = Parser(PY_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".py", ".pyi"]

    @property
    def grammar(self) -> Any:
        return PY_LANGUAGE

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        """Parse source and extract all call expressions."""
        tree = self._parser.parse(source)
        calls = []
        self._walk(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract import statements from source.

        Returns list of (module, [names], is_relative) tuples.
        """
        tree = self._parser.parse(source)
        imports = []
        for node in tree.root_node.children:
            if node.type == "import_statement":
                names = [c.text.decode("utf-8") for c in node.children
                         if c.type == "dotted_name"]
                for name in names:
                    imports.append((name, [name], False))

            elif node.type == "import_from_statement":
                module = None
                is_relative = False
                names = []
                found_import = False
                for c in node.children:
                    if c.type == "dotted_name" and not found_import:
                        module = c.text.decode("utf-8")
                    elif c.type == "relative_import":
                        module = c.text.decode("utf-8")
                        is_relative = True
                    elif c.text == b"import":
                        found_import = True
                    elif c.type == "dotted_name" and found_import:
                        names.append(c.text.decode("utf-8"))

                if module and names:
                    imports.append((module, names, is_relative))

        return imports

    def extract_assignments(self, source: bytes) -> dict[str, str]:
        """Extract self.x = ClassName() assignments from class bodies."""
        tree = self._parser.parse(source)
        assignments = {}
        self._walk_assignments(tree.root_node, None, assignments)
        return assignments

    def extract_annotations(self, source: bytes) -> dict[str, str]:
        """Extract type annotations from class bodies and function params."""
        tree = self._parser.parse(source)
        annotations = {}
        self._walk_annotations(tree.root_node, None, annotations)
        return annotations

    # --- Private methods ---

    def _walk(self, node: Node, file_path: str, calls: list[RawCallSite]):
        """Recursively walk AST to find call expressions."""
        if node.type == "call":
            call_site = self._extract_call(node, file_path)
            if call_site:
                calls.append(call_site)

        for child in node.children:
            self._walk(child, file_path, calls)

    def _extract_call(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        """Extract a RawCallSite from a call node."""
        func = node.child_by_field_name("function")
        if not func:
            return None

        caller_name = self._find_enclosing_function(node)
        line = node.start_point[0] + 1  # 1-indexed

        if func.type == "attribute":
            obj = func.child_by_field_name("object")
            attr = func.child_by_field_name("attribute")
            if obj and attr:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller_name,
                    receiver=obj.text.decode("utf-8"),
                    method=attr.text.decode("utf-8"),
                    line=line,
                )
        elif func.type == "identifier":
            name = func.text.decode("utf-8")
            return RawCallSite(
                file_path=file_path,
                caller_name=caller_name,
                receiver=None,
                method=name,
                line=line,
            )

        return None

    def _find_enclosing_function(self, node: Node) -> str:
        """Walk up AST to find enclosing function/method name."""
        current = node.parent
        func_name = None
        class_name = None

        while current:
            if current.type == "function_definition" and func_name is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    func_name = name_node.text.decode("utf-8")

            if current.type == "class_definition" and class_name is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    class_name = name_node.text.decode("utf-8")

            current = current.parent

        if class_name and func_name:
            return f"{class_name}.{func_name}"
        elif func_name:
            return func_name
        return "<module>"

    def _walk_assignments(self, node: Node, class_name: Optional[str], result: dict):
        """Find self.x = ClassName() patterns."""
        if node.type == "class_definition":
            name_node = node.child_by_field_name("name")
            cn = name_node.text.decode("utf-8") if name_node else None
            for child in node.children:
                self._walk_assignments(child, cn, result)
            return

        if node.type == "assignment" and class_name:
            left = node.children[0] if node.children else None
            right = node.children[-1] if len(node.children) >= 3 else None

            if left and right and left.type == "attribute":
                obj = left.child_by_field_name("object")
                attr = left.child_by_field_name("attribute")
                if obj and attr and obj.text == b"self":
                    attr_name = attr.text.decode("utf-8")
                    resolved = self._resolve_rhs_class(right)
                    if resolved:
                        result[f"{class_name}.{attr_name}"] = resolved

        for child in node.children:
            self._walk_assignments(child, class_name, result)

    def _resolve_rhs_class(self, node: Node) -> Optional[str]:
        """If node is ClassName(), return ClassName."""
        if node.type == "call":
            func = node.child_by_field_name("function")
            if func and func.type == "identifier":
                name = func.text.decode("utf-8")
                if name[0].isupper():
                    return name
        return None

    def _walk_annotations(self, node: Node, class_name: Optional[str], result: dict):
        """Find type annotations on class attrs and function params."""
        if node.type == "class_definition":
            name_node = node.child_by_field_name("name")
            cn = name_node.text.decode("utf-8") if name_node else None
            for child in node.children:
                self._walk_annotations(child, cn, result)
            return

        if node.type == "expression_statement" and class_name:
            pass

        if node.type == "function_definition" and class_name:
            params = node.child_by_field_name("parameters")
            if params:
                for param in params.named_children:
                    if param.type == "typed_parameter":
                        name_node = param.children[0] if param.children else None
                        type_node = param.child_by_field_name("type")
                        if name_node and type_node:
                            param_name = name_node.text.decode("utf-8")
                            type_name = type_node.text.decode("utf-8")
                            if param_name != "self" and type_name[0].isupper():
                                result[f"{class_name}.{param_name}"] = type_name

        if node.type == "assignment" and class_name:
            left = node.children[0] if node.children else None
            if left and left.type == "type":
                pass

        for child in node.children:
            self._walk_annotations(child, class_name, result)
