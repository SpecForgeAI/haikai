"""C# tree-sitter extractor.

Extracts calls, imports, assignments, and type annotations from C# ASTs.
Handles: invocation_expression, object_creation_expression, using_directive,
variable_declaration, class_declaration, namespace_declaration.
"""
from typing import Optional, Any

import tree_sitter_c_sharp as ts_csharp
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

CSHARP_LANGUAGE = Language(ts_csharp.language())


class CSharpExtractor(LanguageExtractor):
    """Extract call sites, imports, assignments, and annotations from C# source."""

    def __init__(self):
        self._parser = Parser(CSHARP_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".cs"]

    @property
    def grammar(self) -> Any:
        return CSHARP_LANGUAGE

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        tree = self._parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        tree = self._parser.parse(source)
        imports: list[tuple[str, list[str], bool]] = []

        for node in tree.root_node.children:
            if node.type != "using_directive":
                continue
            # using System.Collections.Generic;
            # using static System.Math;
            text = node.text.decode("utf-8").strip().rstrip(";")
            is_static = "static" in text
            # Remove "using " and "static "
            ns = text.replace("using ", "").replace("static ", "").strip()
            parts = ns.rsplit(".", 1)
            module = parts[0] if len(parts) > 1 else ns
            name = parts[-1]
            imports.append((module if len(parts) > 1 else ns, [name], False))

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
        if node.type == "invocation_expression":
            call = self._extract_invocation(node, file_path)
            if call:
                calls.append(call)

        elif node.type == "object_creation_expression":
            call = self._extract_object_creation(node, file_path)
            if call:
                calls.append(call)

        for child in node.children:
            self._walk_calls(child, file_path, calls)

    def _extract_invocation(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        func = node.child_by_field_name("function")
        if not func:
            return None

        caller = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1

        if func.type == "member_access_expression":
            expr = func.child_by_field_name("expression")
            name = func.child_by_field_name("name")
            if expr and name:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=expr.text.decode("utf-8"),
                    method=name.text.decode("utf-8"),
                    line=line,
                )

        elif func.type == "identifier":
            return RawCallSite(
                file_path=file_path,
                caller_name=caller,
                receiver=None,
                method=func.text.decode("utf-8"),
                line=line,
            )

        elif func.type == "generic_name":
            name = func.child_by_field_name("name") or func
            return RawCallSite(
                file_path=file_path,
                caller_name=caller,
                receiver=None,
                method=name.text.decode("utf-8").split("<")[0],
                line=line,
            )

        return None

    def _extract_object_creation(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        type_node = node.child_by_field_name("type")
        if not type_node:
            return None

        caller = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1
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
        namespace = None

        while current:
            if current.type == "method_declaration" and method_name is None:
                name = current.child_by_field_name("name")
                if name:
                    method_name = name.text.decode("utf-8")

            elif current.type == "constructor_declaration" and method_name is None:
                name = current.child_by_field_name("name")
                if name:
                    method_name = f"<init:{name.text.decode('utf-8')}>"

            elif current.type in ("class_declaration", "struct_declaration",
                                   "interface_declaration") and class_name is None:
                name = current.child_by_field_name("name")
                if name:
                    class_name = name.text.decode("utf-8")

            elif current.type == "namespace_declaration" and namespace is None:
                name = current.child_by_field_name("name")
                if name:
                    namespace = name.text.decode("utf-8")

            current = current.parent

        parts = [p for p in [class_name, method_name] if p]
        return ".".join(parts) if parts else "<module>"

    # --- Assignments ---

    def _walk_assignments(self, node: Node, scope: Optional[str], result: dict):
        if node.type in ("class_declaration", "struct_declaration", "interface_declaration"):
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

        if node.type == "local_declaration_statement":
            for child in node.children:
                if child.type == "variable_declaration":
                    self._extract_var_declaration(child, scope, result)

        if node.type == "field_declaration":
            for child in node.children:
                if child.type == "variable_declaration":
                    self._extract_var_declaration(child, scope, result)

        for child in node.children:
            self._walk_assignments(child, scope, result)

    def _extract_var_declaration(self, node: Node, scope: Optional[str], result: dict):
        type_node = node.child_by_field_name("type")
        if not type_node:
            return
        is_implicit = type_node.type == "implicit_type" or type_node.text.decode("utf-8").strip() == "var"
        type_name = "var" if is_implicit else self._extract_base_type(type_node)
        if is_implicit:
            # Try to resolve from RHS (new expression)
            for child in node.named_children:
                if child.type == "variable_declarator":
                    # Walk children to find object_creation_expression
                    for vc in child.children:
                        if vc.type == "object_creation_expression":
                            # Type might be in 'type' field or as direct identifier child
                            t = vc.child_by_field_name("type")
                            if t:
                                type_name = self._extract_base_type(t)
                            else:
                                for gc in vc.children:
                                    if gc.type in ("identifier", "type_identifier", "generic_name"):
                                        type_name = self._extract_base_type(gc)
                                        break

        for child in node.named_children:
            if child.type == "variable_declarator":
                name = child.child_by_field_name("name")
                if name:
                    prefix = f"{scope}." if scope else ""
                    result[f"{prefix}{name.text.decode('utf-8')}"] = type_name

    # --- Annotations ---

    def _walk_annotations(self, node: Node, scope: Optional[str], result: dict):
        if node.type in ("class_declaration", "struct_declaration", "interface_declaration"):
            name = node.child_by_field_name("name")
            cls = name.text.decode("utf-8") if name else scope
            for child in node.children:
                self._walk_annotations(child, cls, result)
            return

        if node.type == "method_declaration":
            name = node.child_by_field_name("name")
            fn = name.text.decode("utf-8") if name else None
            method_scope = f"{scope}.{fn}" if scope and fn else fn
            params = node.child_by_field_name("parameters")
            if params:
                for param in params.named_children:
                    if param.type == "parameter":
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
        if type_node.type == "generic_name":
            name = type_node.child_by_field_name("name")
            if name:
                return name.text.decode("utf-8")
        if type_node.type == "nullable_type":
            for child in type_node.children:
                if child.type != "?":
                    return self._extract_base_type(child)
        if type_node.type == "predefined_type":
            return type_node.text.decode("utf-8")
        if type_node.type == "identifier":
            return type_node.text.decode("utf-8")
        # Fallback: strip generics and nullable
        text = type_node.text.decode("utf-8")
        return text.split("<")[0].rstrip("?").split("[")[0]
