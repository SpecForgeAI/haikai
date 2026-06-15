"""C tree-sitter extractor.

Extracts calls, includes, assignments, and type info from C ASTs.
Handles: call_expression, preproc_include, declaration,
function_definition, struct_specifier.
"""
from typing import Optional, Any

import tree_sitter_c as ts_c
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

C_LANGUAGE = Language(ts_c.language())


class CExtractor(LanguageExtractor):
    """Extract call sites, includes, assignments, and type info from C source."""

    def __init__(self):
        self._parser = Parser(C_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".c", ".h"]

    @property
    def grammar(self) -> Any:
        return C_LANGUAGE

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        tree = self._parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract #include directives.

        #include <stdio.h>  → ("stdio.h", ["stdio"], is_relative=False)
        #include "mylib.h"  → ("mylib.h", ["mylib"], is_relative=True)
        """
        tree = self._parser.parse(source)
        imports: list[tuple[str, list[str], bool]] = []
        self._walk_includes(tree.root_node, imports)
        return imports

    def _walk_includes(self, node: Node, imports: list):
        """Recursively find preproc_include nodes (may be nested in #ifdef)."""
        if node.type == "preproc_include":
            path_node = node.child_by_field_name("path")
            if path_node:
                text = path_node.text.decode("utf-8")
                if text.startswith('"') and text.endswith('"'):
                    path = text.strip('"')
                    is_relative = True
                elif text.startswith("<") and text.endswith(">"):
                    path = text.strip("<>")
                    is_relative = False
                else:
                    return
                name = path.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                imports.append((path, [name], is_relative))
            return

        for child in node.children:
            self._walk_includes(child, imports)

    def extract_assignments(self, source: bytes) -> dict[str, str]:
        tree = self._parser.parse(source)
        assignments: dict[str, str] = {}
        self._walk_assignments(tree.root_node, None, assignments)
        return assignments

    def extract_annotations(self, source: bytes) -> dict[str, str]:
        """Extract type specifiers from function parameters and declarations."""
        tree = self._parser.parse(source)
        annotations: dict[str, str] = {}
        self._walk_annotations(tree.root_node, None, annotations)
        return annotations

    # --- Call extraction ---

    def _walk_calls(self, node: Node, file_path: str, calls: list[RawCallSite]):
        if node.type == "call_expression":
            call = self._extract_call(node, file_path)
            if call:
                calls.append(call)

        for child in node.children:
            self._walk_calls(child, file_path, calls)

    def _extract_call(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        func = node.child_by_field_name("function")
        if not func:
            return None

        caller = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1

        # Direct call: func()
        if func.type == "identifier":
            return RawCallSite(
                file_path=file_path,
                caller_name=caller,
                receiver=None,
                method=func.text.decode("utf-8"),
                line=line,
            )

        # ptr->method() or obj.method
        if func.type == "field_expression":
            arg = func.child_by_field_name("argument")
            field = func.child_by_field_name("field")
            if arg and field:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=arg.text.decode("utf-8"),
                    method=field.text.decode("utf-8"),
                    line=line,
                )

        # (*fptr)() — function pointer dereference
        if func.type == "parenthesized_expression":
            inner = func.named_children[0] if func.named_children else None
            if inner and inner.type == "pointer_expression":
                operand = inner.child_by_field_name("argument")
                if operand:
                    return RawCallSite(
                        file_path=file_path,
                        caller_name=caller,
                        receiver=None,
                        method=f"*{operand.text.decode('utf-8')}",
                        line=line,
                    )

        return None

    def _find_enclosing_scope(self, node: Node) -> str:
        current = node.parent
        while current:
            if current.type == "function_definition":
                declarator = current.child_by_field_name("declarator")
                if declarator:
                    name = self._extract_declarator_name(declarator)
                    if name:
                        return name
            current = current.parent
        return "<module>"

    def _extract_declarator_name(self, node: Node) -> Optional[str]:
        if node.type == "identifier":
            return node.text.decode("utf-8")
        if node.type == "function_declarator":
            decl = node.child_by_field_name("declarator")
            if decl:
                return self._extract_declarator_name(decl)
        if node.type == "pointer_declarator":
            decl = node.child_by_field_name("declarator")
            if decl:
                return self._extract_declarator_name(decl)
        return None

    # --- Assignments ---

    def _walk_assignments(self, node: Node, scope: Optional[str], result: dict):
        if node.type == "function_definition":
            declarator = node.child_by_field_name("declarator")
            fn = self._extract_declarator_name(declarator) if declarator else None
            for child in node.children:
                self._walk_assignments(child, fn, result)
            return

        if node.type == "declaration":
            type_node = node.child_by_field_name("type")
            if type_node:
                type_name = self._extract_c_type(type_node)
                declarator = node.child_by_field_name("declarator")
                if declarator:
                    # Handle init_declarator (has value) vs plain declarator
                    actual_decl = declarator
                    if declarator.type == "init_declarator":
                        actual_decl = declarator.child_by_field_name("declarator")
                    if actual_decl:
                        var_name = self._extract_declarator_name(actual_decl)
                        if var_name and type_name:
                            prefix = f"{scope}." if scope else ""
                            result[f"{prefix}{var_name}"] = type_name

        for child in node.children:
            self._walk_assignments(child, scope, result)

    # --- Annotations ---

    def _walk_annotations(self, node: Node, scope: Optional[str], result: dict):
        if node.type == "function_definition":
            declarator = node.child_by_field_name("declarator")
            fn = self._extract_declarator_name(declarator) if declarator else None

            # Extract parameter types
            if declarator and declarator.type == "function_declarator":
                params = declarator.child_by_field_name("parameters")
                if params:
                    for param in params.named_children:
                        if param.type == "parameter_declaration":
                            ptype = param.child_by_field_name("type")
                            pdecl = param.child_by_field_name("declarator")
                            if ptype and pdecl:
                                pname = self._extract_declarator_name(pdecl)
                                if pname:
                                    prefix = f"{fn}." if fn else ""
                                    result[f"{prefix}{pname}"] = self._extract_c_type(ptype)

            for child in node.children:
                self._walk_annotations(child, fn, result)
            return

        for child in node.children:
            self._walk_annotations(child, scope, result)

    # --- Helpers ---

    def _extract_c_type(self, type_node: Node) -> str:
        """Extract type name from type specifier."""
        if type_node.type == "struct_specifier":
            name = type_node.child_by_field_name("name")
            if name:
                return name.text.decode("utf-8")
        if type_node.type == "type_identifier":
            return type_node.text.decode("utf-8")
        if type_node.type == "primitive_type":
            return type_node.text.decode("utf-8")
        return type_node.text.decode("utf-8").split("{")[0].strip()
