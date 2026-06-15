"""Java tree-sitter extractor.

Extracts calls, imports, assignments, and type annotations from Java ASTs.
Handles: method_invocation, object_creation_expression, import_declaration,
local_variable_declaration, field_declaration, class_declaration.
"""
from typing import Optional, Any

import tree_sitter_java as ts_java
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

JAVA_LANGUAGE = Language(ts_java.language())


class JavaExtractor(LanguageExtractor):
    """Extract call sites, imports, assignments, and annotations from Java source."""

    def __init__(self):
        self._parser = Parser(JAVA_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".java"]

    @property
    def grammar(self) -> Any:
        return JAVA_LANGUAGE

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        tree = self._parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        tree = self._parser.parse(source)
        imports: list[tuple[str, list[str], bool]] = []

        for node in tree.root_node.children:
            if node.type != "import_declaration":
                continue
            # import java.util.List; or import java.util.*;
            text = node.text.decode("utf-8").strip().rstrip(";")
            # Remove "import " and optional "static "
            path = text.replace("import ", "").replace("static ", "").strip()
            if path.endswith(".*"):
                module = path[:-2]
                imports.append((module, ["*"], False))
            else:
                parts = path.rsplit(".", 1)
                module = parts[0] if len(parts) > 1 else path
                name = parts[1] if len(parts) > 1 else path
                imports.append((module, [name], False))

        return imports

    def extract_assignments(self, source: bytes) -> dict[str, str]:
        tree = self._parser.parse(source)
        assignments: dict[str, str] = {}
        self._walk_assignments(tree.root_node, None, assignments)
        return assignments

    def extract_annotations(self, source: bytes) -> dict[str, str]:
        tree = self._parser.parse(source)
        annotations: dict[str, str] = {}
        self._walk_annotations(tree.root_node, None, annotations)
        return annotations

    # --- Call extraction ---

    def _walk_calls(self, node: Node, file_path: str, calls: list[RawCallSite]):
        if node.type == "method_invocation":
            call = self._extract_method_invocation(node, file_path)
            if call:
                calls.append(call)

        elif node.type == "object_creation_expression":
            call = self._extract_object_creation(node, file_path)
            if call:
                calls.append(call)

        for child in node.children:
            self._walk_calls(child, file_path, calls)

    def _extract_method_invocation(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        name_node = node.child_by_field_name("name")
        obj_node = node.child_by_field_name("object")
        if not name_node:
            return None

        caller = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1
        method = name_node.text.decode("utf-8")
        receiver = obj_node.text.decode("utf-8") if obj_node else None

        return RawCallSite(
            file_path=file_path,
            caller_name=caller,
            receiver=receiver,
            method=method,
            line=line,
        )

    def _extract_object_creation(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        type_node = node.child_by_field_name("type")
        if not type_node:
            return None

        caller = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1
        # Extract base type (strip generics)
        type_name = self._extract_base_type(type_node)

        return RawCallSite(
            file_path=file_path,
            caller_name=caller,
            receiver=None,
            method=f"new {type_name}",
            line=line,
        )

    def _find_enclosing_scope(self, node: Node) -> str:
        current = node.parent
        method_name = None
        class_name = None

        while current:
            if current.type == "method_declaration" and method_name is None:
                name = current.child_by_field_name("name")
                if name:
                    method_name = name.text.decode("utf-8")

            elif current.type == "constructor_declaration" and method_name is None:
                name = current.child_by_field_name("name")
                if name:
                    method_name = f"<init:{name.text.decode('utf-8')}>"

            elif current.type in ("class_declaration", "interface_declaration",
                                   "enum_declaration") and class_name is None:
                name = current.child_by_field_name("name")
                if name:
                    class_name = name.text.decode("utf-8")

            current = current.parent

        if class_name and method_name:
            return f"{class_name}.{method_name}"
        elif class_name:
            return class_name
        elif method_name:
            return method_name
        return "<module>"

    # --- Assignments ---

    def _walk_assignments(self, node: Node, scope: Optional[str], result: dict):
        if node.type in ("class_declaration", "interface_declaration", "enum_declaration"):
            name = node.child_by_field_name("name")
            cls = name.text.decode("utf-8") if name else scope
            for child in node.children:
                self._walk_assignments(child, cls, result)
            return

        if node.type == "method_declaration":
            name = node.child_by_field_name("name")
            fn = name.text.decode("utf-8") if name else None
            method_scope = f"{scope}.{fn}" if scope and fn else fn
            for child in node.children:
                self._walk_assignments(child, method_scope, result)
            return

        # List<String> items = new ArrayList<>(); or Database db = new Database();
        if node.type == "local_variable_declaration":
            type_name = self._extract_decl_type(node)
            declarator = node.child_by_field_name("declarator")
            if declarator and type_name:
                var_name = declarator.child_by_field_name("name")
                value = declarator.child_by_field_name("value")
                if var_name:
                    prefix = f"{scope}." if scope else ""
                    # Prefer RHS type for new expressions
                    rhs_type = self._resolve_rhs(value) if value else None
                    result[f"{prefix}{var_name.text.decode('utf-8')}"] = rhs_type or type_name

        if node.type == "field_declaration":
            type_name = self._extract_decl_type(node)
            declarator = node.child_by_field_name("declarator")
            if declarator and type_name:
                var_name = declarator.child_by_field_name("name")
                if var_name:
                    prefix = f"{scope}." if scope else ""
                    result[f"{prefix}{var_name.text.decode('utf-8')}"] = type_name

        for child in node.children:
            self._walk_assignments(child, scope, result)

    def _extract_decl_type(self, node: Node) -> Optional[str]:
        type_node = node.child_by_field_name("type")
        if type_node:
            return self._extract_base_type(type_node)
        return None

    def _resolve_rhs(self, node: Node) -> Optional[str]:
        if not node:
            return None
        if node.type == "object_creation_expression":
            type_node = node.child_by_field_name("type")
            if type_node:
                return self._extract_base_type(type_node)
        return None

    # --- Annotations (type info) ---

    def _walk_annotations(self, node: Node, scope: Optional[str], result: dict):
        if node.type in ("class_declaration", "interface_declaration", "enum_declaration"):
            name = node.child_by_field_name("name")
            cls = name.text.decode("utf-8") if name else scope
            for child in node.children:
                self._walk_annotations(child, cls, result)
            return

        if node.type == "method_declaration":
            name = node.child_by_field_name("name")
            fn = name.text.decode("utf-8") if name else None
            method_scope = f"{scope}.{fn}" if scope and fn else fn
            # Extract parameter types
            params = node.child_by_field_name("parameters")
            if params:
                for param in params.named_children:
                    if param.type == "formal_parameter":
                        ptype = param.child_by_field_name("type")
                        pname = param.child_by_field_name("name")
                        if ptype and pname:
                            prefix = f"{method_scope}." if method_scope else ""
                            result[f"{prefix}{pname.text.decode('utf-8')}"] = \
                                self._extract_base_type(ptype)
            for child in node.children:
                self._walk_annotations(child, method_scope, result)
            return

        for child in node.children:
            self._walk_annotations(child, scope, result)

    # --- Helpers ---

    def _extract_base_type(self, type_node: Node) -> str:
        """Extract base type name, stripping generics. List<String> → List."""
        if type_node.type == "generic_type":
            for child in type_node.children:
                if child.type == "type_identifier":
                    return child.text.decode("utf-8")
        if type_node.type == "type_identifier":
            return type_node.text.decode("utf-8")
        if type_node.type == "scoped_type_identifier":
            return type_node.text.decode("utf-8").replace(".", "_")
        return type_node.text.decode("utf-8").split("<")[0].split("[")[0]
