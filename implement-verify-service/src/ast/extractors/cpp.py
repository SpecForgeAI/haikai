"""C++ tree-sitter extractor.

Extracts calls, includes, assignments, and type info from C++ ASTs.
Handles: call_expression, new_expression, preproc_include, declaration,
class_specifier, namespace_definition, using_declaration, templates.
"""
from typing import Optional, Any

import tree_sitter_cpp as ts_cpp
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

CPP_LANGUAGE = Language(ts_cpp.language())


class CppExtractor(LanguageExtractor):
    """Extract call sites, includes, assignments, and annotations from C++ source."""

    def __init__(self):
        self._parser = Parser(CPP_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".cpp", ".cc", ".cxx", ".hpp", ".hxx"]

    @property
    def grammar(self) -> Any:
        return CPP_LANGUAGE

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        tree = self._parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract #include directives (same as C). Handles includes inside #ifdef guards."""
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

        elif node.type == "new_expression":
            call = self._extract_new(node, file_path)
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

        # obj.method() or obj->method()
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

        # Namespace::Class::method() or Class::method()
        if func.type == "qualified_identifier":
            scope_node = func.child_by_field_name("scope")
            name_node = func.child_by_field_name("name")
            if scope_node and name_node:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=scope_node.text.decode("utf-8").rstrip(":"),
                    method=name_node.text.decode("utf-8"),
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

        # Template call: make_shared<Foo>()
        if func.type == "template_function":
            name = func.child_by_field_name("name")
            if name:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=None,
                    method=name.text.decode("utf-8"),
                    line=line,
                )

        # (*fptr)()
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

    def _extract_new(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        type_node = node.child_by_field_name("type")
        if not type_node:
            return None

        caller = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1
        type_name = self._extract_cpp_type(type_node)

        return RawCallSite(
            file_path=file_path,
            caller_name=caller,
            receiver=None,
            method=f"new {type_name}",
            line=line,
        )

    def _find_enclosing_scope(self, node: Node) -> str:
        current = node.parent
        func_name = None
        class_name = None
        namespace = None

        while current:
            if current.type == "function_definition" and func_name is None:
                declarator = current.child_by_field_name("declarator")
                if declarator:
                    name = self._extract_declarator_name(declarator)
                    if name:
                        # Check for qualified name (Foo::bar)
                        if "::" in name:
                            return name
                        func_name = name

            elif current.type in ("class_specifier", "struct_specifier") and class_name is None:
                name = current.child_by_field_name("name")
                if name:
                    class_name = name.text.decode("utf-8")

            elif current.type == "namespace_definition" and namespace is None:
                name = current.child_by_field_name("name")
                if name:
                    namespace = name.text.decode("utf-8")

            current = current.parent

        parts = [p for p in [class_name, func_name] if p]
        scope = "::".join(parts) if parts else func_name or "<module>"
        return scope

    def _extract_declarator_name(self, node: Node) -> Optional[str]:
        if node.type == "identifier":
            return node.text.decode("utf-8")
        if node.type == "qualified_identifier":
            return node.text.decode("utf-8")
        if node.type == "function_declarator":
            decl = node.child_by_field_name("declarator")
            if decl:
                return self._extract_declarator_name(decl)
        if node.type == "pointer_declarator":
            decl = node.child_by_field_name("declarator")
            if decl:
                return self._extract_declarator_name(decl)
        if node.type == "reference_declarator":
            for child in node.named_children:
                name = self._extract_declarator_name(child)
                if name:
                    return name
        if node.type == "destructor_name":
            return f"~{node.text.decode('utf-8').lstrip('~')}"
        return None

    # --- Assignments ---

    def _walk_assignments(self, node: Node, scope: Optional[str], result: dict):
        if node.type == "function_definition":
            declarator = node.child_by_field_name("declarator")
            fn = self._extract_declarator_name(declarator) if declarator else None
            for child in node.children:
                self._walk_assignments(child, fn, result)
            return

        if node.type in ("class_specifier", "struct_specifier"):
            name = node.child_by_field_name("name")
            cls = name.text.decode("utf-8") if name else scope
            for child in node.children:
                self._walk_assignments(child, cls, result)
            return

        if node.type == "namespace_definition":
            name = node.child_by_field_name("name")
            ns = name.text.decode("utf-8") if name else scope
            for child in node.children:
                self._walk_assignments(child, ns, result)
            return

        if node.type == "declaration":
            type_node = node.child_by_field_name("type")
            if type_node:
                type_name = self._extract_cpp_type(type_node)
                declarator = node.child_by_field_name("declarator")
                if declarator:
                    var_name = self._extract_declarator_name(declarator)
                    if var_name and type_name:
                        # auto → try to resolve from RHS
                        if type_name == "auto":
                            init = declarator.child_by_field_name("value") if hasattr(declarator, 'child_by_field_name') else None
                            if init:
                                rhs = self._resolve_rhs(init)
                                if rhs:
                                    type_name = rhs
                        prefix = f"{scope}." if scope else ""
                        result[f"{prefix}{var_name}"] = type_name

        for child in node.children:
            self._walk_assignments(child, scope, result)

    def _resolve_rhs(self, node: Node) -> Optional[str]:
        if node.type == "new_expression":
            type_node = node.child_by_field_name("type")
            if type_node:
                return self._extract_cpp_type(type_node)
        if node.type == "call_expression":
            func = node.child_by_field_name("function")
            if func and func.type == "template_function":
                # make_shared<Foo>() → Foo
                args = func.child_by_field_name("arguments")
                if args:
                    for child in args.named_children:
                        if child.type == "type_descriptor":
                            return self._extract_cpp_type(child)
        return None

    # --- Annotations ---

    def _walk_annotations(self, node: Node, scope: Optional[str], result: dict):
        if node.type == "function_definition":
            declarator = node.child_by_field_name("declarator")
            fn = self._extract_declarator_name(declarator) if declarator else None

            # Extract parameter types
            if declarator:
                params = None
                if declarator.type == "function_declarator":
                    params = declarator.child_by_field_name("parameters")
                elif declarator.type in ("pointer_declarator", "reference_declarator"):
                    for child in declarator.named_children:
                        if child.type == "function_declarator":
                            params = child.child_by_field_name("parameters")
                            break

                if params:
                    for param in params.named_children:
                        if param.type == "parameter_declaration":
                            ptype = param.child_by_field_name("type")
                            pdecl = param.child_by_field_name("declarator")
                            if ptype and pdecl:
                                pname = self._extract_declarator_name(pdecl)
                                if pname:
                                    prefix = f"{fn}." if fn else ""
                                    result[f"{prefix}{pname}"] = self._extract_cpp_type(ptype)

            for child in node.children:
                self._walk_annotations(child, fn, result)
            return

        if node.type in ("class_specifier", "struct_specifier"):
            name = node.child_by_field_name("name")
            cls = name.text.decode("utf-8") if name else scope
            for child in node.children:
                self._walk_annotations(child, cls, result)
            return

        if node.type == "namespace_definition":
            name = node.child_by_field_name("name")
            ns = name.text.decode("utf-8") if name else scope
            for child in node.children:
                self._walk_annotations(child, ns, result)
            return

        for child in node.children:
            self._walk_annotations(child, scope, result)

    # --- Helpers ---

    def _extract_cpp_type(self, type_node: Node) -> str:
        if type_node.type == "type_identifier":
            return type_node.text.decode("utf-8")
        if type_node.type == "primitive_type":
            return type_node.text.decode("utf-8")
        if type_node.type == "auto":
            return "auto"
        if type_node.type == "template_type":
            name = type_node.child_by_field_name("name")
            if name:
                return name.text.decode("utf-8")
        if type_node.type == "qualified_identifier":
            return type_node.text.decode("utf-8")
        if type_node.type == "struct_specifier":
            name = type_node.child_by_field_name("name")
            if name:
                return name.text.decode("utf-8")
        if type_node.type == "class_specifier":
            name = type_node.child_by_field_name("name")
            if name:
                return name.text.decode("utf-8")
        # Fallback: strip templates and qualifiers
        text = type_node.text.decode("utf-8")
        return text.split("<")[0].strip("&*").strip()
