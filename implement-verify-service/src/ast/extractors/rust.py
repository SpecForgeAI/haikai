"""Rust tree-sitter extractor.

Extracts calls, imports, assignments, and type info from Rust ASTs.
Handles: call_expression, method_call_expression, macro_invocation,
use_declaration (nested trees), let_declaration, impl_item, trait_item.
"""
from typing import Optional, Any

import tree_sitter_rust as ts_rust
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

RUST_LANGUAGE = Language(ts_rust.language())


class RustExtractor(LanguageExtractor):
    """Extract call sites, imports, assignments, and annotations from Rust source."""

    def __init__(self):
        self._parser = Parser(RUST_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".rs"]

    @property
    def grammar(self) -> Any:
        return RUST_LANGUAGE

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        tree = self._parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract use declarations, including nested trees.

        use std::collections::HashMap;
        use std::{io, fs::{self, File}};
        """
        tree = self._parser.parse(source)
        imports: list[tuple[str, list[str], bool]] = []

        for node in tree.root_node.children:
            if node.type == "use_declaration":
                self._extract_use(node, [], imports)

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
        if node.type == "call_expression":
            call = self._extract_call(node, file_path)
            if call:
                calls.append(call)

        elif node.type == "macro_invocation":
            call = self._extract_macro(node, file_path)
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

        # method call: obj.method() — handled by tree-sitter as field_expression
        if func.type == "field_expression":
            value = func.child_by_field_name("value")
            field = func.child_by_field_name("field")
            if value and field:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=value.text.decode("utf-8"),
                    method=field.text.decode("utf-8"),
                    line=line,
                )

        # Scoped call: Type::method() or module::func()
        if func.type == "scoped_identifier":
            path = func.child_by_field_name("path")
            name = func.child_by_field_name("name")
            if path and name:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=path.text.decode("utf-8"),
                    method=name.text.decode("utf-8"),
                    line=line,
                )

        # Simple call: func()
        if func.type == "identifier":
            return RawCallSite(
                file_path=file_path,
                caller_name=caller,
                receiver=None,
                method=func.text.decode("utf-8"),
                line=line,
            )

        return None

    def _extract_macro(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        macro = node.child_by_field_name("macro")
        if not macro:
            return None

        caller = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1
        name = macro.text.decode("utf-8")

        return RawCallSite(
            file_path=file_path,
            caller_name=caller,
            receiver=None,
            method=f"{name}!",
            line=line,
        )

    def _find_enclosing_scope(self, node: Node) -> str:
        current = node.parent
        func_name = None
        impl_type = None

        while current:
            if current.type == "function_item" and func_name is None:
                name = current.child_by_field_name("name")
                if name:
                    func_name = name.text.decode("utf-8")

            elif current.type == "impl_item" and impl_type is None:
                type_node = current.child_by_field_name("type")
                if type_node:
                    impl_type = self._extract_type_name(type_node)

            elif current.type == "closure_expression" and func_name is None:
                func_name = "<closure>"

            current = current.parent

        if impl_type and func_name:
            return f"{impl_type}::{func_name}"
        elif func_name:
            return func_name
        return "<module>"

    # --- Import extraction ---

    def _extract_use(self, node: Node, prefix: list[str], imports: list):
        """Recursively extract use declarations, handling nested trees."""
        for child in node.children:
            if child.type == "use_as_clause":
                # use foo::bar as baz;
                path_node = child.child_by_field_name("path")
                if path_node:
                    full_path = "::".join(prefix + [path_node.text.decode("utf-8")])
                    name = full_path.rsplit("::", 1)[-1]
                    imports.append((full_path, [name], False))
                return

            if child.type == "scoped_identifier":
                path = child.text.decode("utf-8")
                full_path = "::".join(prefix + [path]) if prefix else path
                name = full_path.rsplit("::", 1)[-1]
                imports.append((full_path, [name], False))
                return

            if child.type == "identifier":
                full_path = "::".join(prefix + [child.text.decode("utf-8")])
                name = child.text.decode("utf-8")
                imports.append((full_path, [name], False))
                return

            if child.type == "scoped_use_list":
                # use std::{io, fs};
                path_node = child.child_by_field_name("path")
                new_prefix = prefix[:]
                if path_node:
                    new_prefix.append(path_node.text.decode("utf-8"))
                list_node = child.child_by_field_name("list")
                if list_node:
                    for item in list_node.named_children:
                        if item.type == "identifier":
                            full = "::".join(new_prefix + [item.text.decode("utf-8")])
                            imports.append((full, [item.text.decode("utf-8")], False))
                        elif item.type == "self":
                            full = "::".join(new_prefix)
                            imports.append((full, [new_prefix[-1] if new_prefix else "self"], False))
                        elif item.type == "scoped_use_list":
                            # Nested: use std::{io, fs::{self, File}};
                            self._extract_use(item, new_prefix, imports)
                        elif item.type == "scoped_identifier":
                            full = "::".join(new_prefix + [item.text.decode("utf-8")])
                            name = item.text.decode("utf-8").rsplit("::", 1)[-1]
                            imports.append((full, [name], False))
                        elif item.type == "use_as_clause":
                            path_n = item.child_by_field_name("path")
                            if path_n:
                                full = "::".join(new_prefix + [path_n.text.decode("utf-8")])
                                name = full.rsplit("::", 1)[-1]
                                imports.append((full, [name], False))
                return

            if child.type == "use_list":
                # use {foo, bar};
                for item in child.named_children:
                    if item.type == "identifier":
                        full = "::".join(prefix + [item.text.decode("utf-8")])
                        imports.append((full, [item.text.decode("utf-8")], False))
                    elif item.type == "scoped_identifier":
                        full = "::".join(prefix + [item.text.decode("utf-8")])
                        name = item.text.decode("utf-8").rsplit("::", 1)[-1]
                        imports.append((full, [name], False))
                return

    # --- Assignments ---

    def _walk_assignments(self, node: Node, scope: Optional[str], result: dict):
        if node.type == "function_item":
            name = node.child_by_field_name("name")
            fn = name.text.decode("utf-8") if name else None
            for child in node.children:
                self._walk_assignments(child, fn, result)
            return

        if node.type == "impl_item":
            type_node = node.child_by_field_name("type")
            impl_name = self._extract_type_name(type_node) if type_node else None
            for child in node.children:
                if child.type == "function_item":
                    fn_name = child.child_by_field_name("name")
                    fn = fn_name.text.decode("utf-8") if fn_name else None
                    fn_scope = f"{impl_name}::{fn}" if impl_name and fn else fn
                    for c in child.children:
                        self._walk_assignments(c, fn_scope, result)
                else:
                    self._walk_assignments(child, impl_name, result)
            return

        if node.type == "let_declaration":
            pattern = node.child_by_field_name("pattern")
            value = node.child_by_field_name("value")
            type_ann = node.child_by_field_name("type")

            if pattern and pattern.type == "identifier":
                var_name = pattern.text.decode("utf-8")
                prefix = f"{scope}." if scope else ""

                # Explicit type annotation: let db: Database = ...
                if type_ann:
                    result[f"{prefix}{var_name}"] = self._extract_type_name(type_ann)
                # Infer from RHS: let db = Database::new()
                elif value:
                    rhs_type = self._resolve_rhs(value)
                    if rhs_type:
                        result[f"{prefix}{var_name}"] = rhs_type

        for child in node.children:
            self._walk_assignments(child, scope, result)

    def _resolve_rhs(self, node: Node) -> Optional[str]:
        # Type::new() → Type
        if node.type == "call_expression":
            func = node.child_by_field_name("function")
            if func and func.type == "scoped_identifier":
                path = func.child_by_field_name("path")
                name = func.child_by_field_name("name")
                if path and name and name.text.decode("utf-8") == "new":
                    return path.text.decode("utf-8")
        return None

    # --- Annotations ---

    def _walk_annotations(self, node: Node, scope: Optional[str], result: dict):
        if node.type == "function_item":
            name = node.child_by_field_name("name")
            fn = name.text.decode("utf-8") if name else None
            params = node.child_by_field_name("parameters")
            if params:
                for param in params.named_children:
                    if param.type == "parameter":
                        ptype = param.child_by_field_name("type")
                        pname = param.child_by_field_name("pattern")
                        if ptype and pname:
                            prefix = f"{fn}." if fn else ""
                            result[f"{prefix}{pname.text.decode('utf-8')}"] = \
                                self._extract_type_name(ptype)
                    elif param.type == "self_parameter":
                        pass  # Skip self
            # Return type
            ret = node.child_by_field_name("return_type")
            if ret and fn:
                result[f"{fn}.__return__"] = self._extract_type_name(ret)

            for child in node.children:
                self._walk_annotations(child, fn, result)
            return

        if node.type == "impl_item":
            type_node = node.child_by_field_name("type")
            impl_name = self._extract_type_name(type_node) if type_node else None
            for child in node.children:
                if child.type == "function_item":
                    fn_name = child.child_by_field_name("name")
                    fn = fn_name.text.decode("utf-8") if fn_name else None
                    fn_scope = f"{impl_name}::{fn}" if impl_name and fn else fn
                    self._walk_annotations(child, fn_scope, result)
                else:
                    self._walk_annotations(child, impl_name, result)
            return

        for child in node.children:
            self._walk_annotations(child, scope, result)

    # --- Helpers ---

    def _extract_type_name(self, type_node: Node) -> str:
        if type_node.type == "type_identifier":
            return type_node.text.decode("utf-8")
        if type_node.type == "scoped_type_identifier":
            name = type_node.child_by_field_name("name")
            if name:
                return name.text.decode("utf-8")
        if type_node.type == "reference_type":
            for child in type_node.named_children:
                if child.type != "mutable_specifier":
                    return self._extract_type_name(child)
        if type_node.type == "generic_type":
            type_id = type_node.child_by_field_name("type")
            if type_id:
                return self._extract_type_name(type_id)
        return type_node.text.decode("utf-8").split("<")[0].strip("&*")
