"""TypeScript/JavaScript tree-sitter extractor.

Extracts calls, imports, assignments, and annotations from TypeScript/JavaScript ASTs.
Handles: call_expression, member_expression, new_expression, optional_chain_expression,
import_statement (named, default, namespace), variable_declaration, type_annotation.
"""
from typing import Optional, Any

import tree_sitter_typescript as ts_typescript
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

TS_LANGUAGE = Language(ts_typescript.language_typescript())
TSX_LANGUAGE = Language(ts_typescript.language_tsx())


class TypeScriptExtractor(LanguageExtractor):
    """Extract call sites, imports, assignments, and annotations from TypeScript/JS."""

    def __init__(self):
        self._ts_parser = Parser(TS_LANGUAGE)
        self._tsx_parser = Parser(TSX_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".ts", ".tsx", ".js", ".jsx"]

    @property
    def grammar(self) -> Any:
        return TS_LANGUAGE

    def _parser_for(self, file_path: str = "") -> Parser:
        if file_path.endswith((".tsx", ".jsx")):
            return self._tsx_parser
        return self._ts_parser

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        """Extract all call expressions including new expressions and optional chains."""
        parser = self._parser_for(file_path)
        tree = parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract import statements.

        Handles:
        - import { A, B } from 'module'
        - import A from 'module'
        - import * as A from 'module'
        - import 'module' (side-effect)
        """
        tree = self._ts_parser.parse(source)
        imports: list[tuple[str, list[str], bool]] = []

        for node in tree.root_node.children:
            if node.type != "import_statement":
                continue

            module = None
            names: list[str] = []
            is_relative = False

            for child in node.children:
                if child.type == "string":
                    # Extract module path from string
                    module = self._string_value(child)
                    is_relative = module.startswith(".")

                elif child.type == "import_clause":
                    for clause_child in child.children:
                        if clause_child.type == "identifier":
                            # Default import: import X from '...'
                            names.append(clause_child.text.decode("utf-8"))

                        elif clause_child.type == "named_imports":
                            # Named imports: import { A, B } from '...'
                            for spec in clause_child.children:
                                if spec.type == "import_specifier":
                                    # Could be `A` or `A as B`
                                    name_node = spec.children[0] if spec.children else None
                                    if name_node:
                                        names.append(name_node.text.decode("utf-8"))

                        elif clause_child.type == "namespace_import":
                            # import * as X from '...'
                            for ns_child in clause_child.children:
                                if ns_child.type == "identifier":
                                    names.append(ns_child.text.decode("utf-8"))

            if module:
                if not names:
                    names = [module.split("/")[-1]]  # Side-effect import
                imports.append((module, names, is_relative))

        return imports

    def extract_assignments(self, source: bytes) -> dict[str, str]:
        """Extract assignments: const x = new Foo(), this.x = new Foo()."""
        tree = self._ts_parser.parse(source)
        assignments: dict[str, str] = {}
        self._walk_assignments(tree.root_node, None, assignments)
        return assignments

    def extract_annotations(self, source: bytes) -> dict[str, str]:
        """Extract type annotations from class methods and constructors."""
        tree = self._ts_parser.parse(source)
        annotations: dict[str, str] = {}
        self._walk_annotations(tree.root_node, None, annotations)
        return annotations

    # --- Private: call extraction ---

    def _walk_calls(self, node: Node, file_path: str, calls: list[RawCallSite]):
        """Walk AST to find call_expression and new_expression nodes."""
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
        """Extract from call_expression: foo.bar(), func(), a?.b()."""
        func = node.child_by_field_name("function")
        if not func:
            return None

        caller_name = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1

        if func.type == "member_expression":
            obj = func.child_by_field_name("object")
            prop = func.child_by_field_name("property")
            if obj and prop:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller_name,
                    receiver=obj.text.decode("utf-8"),
                    method=prop.text.decode("utf-8"),
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

        # Optional chaining: a?.b()
        elif func.type == "optional_chain_expression":
            # Drill into the chain
            return self._extract_optional_chain(func, file_path, caller_name, line)

        return None

    def _extract_new(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        """Extract from new_expression: new Foo()."""
        constructor = node.child_by_field_name("constructor")
        if not constructor:
            return None

        caller_name = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1
        name = constructor.text.decode("utf-8")

        return RawCallSite(
            file_path=file_path,
            caller_name=caller_name,
            receiver=None,
            method=name,
            line=line,
        )

    def _extract_optional_chain(
        self, node: Node, file_path: str, caller_name: str, line: int
    ) -> Optional[RawCallSite]:
        """Extract from optional chain: service?.findById()."""
        # Walk into the chain to find the member access
        for child in node.children:
            if child.type == "member_expression":
                obj = child.child_by_field_name("object")
                prop = child.child_by_field_name("property")
                if obj and prop:
                    return RawCallSite(
                        file_path=file_path,
                        caller_name=caller_name,
                        receiver=obj.text.decode("utf-8"),
                        method=prop.text.decode("utf-8"),
                        line=line,
                    )
        return None

    def _find_enclosing_scope(self, node: Node) -> str:
        """Walk up AST to find enclosing class.method or function name."""
        current = node.parent
        method_name = None
        class_name = None

        while current:
            if current.type == "method_definition" and method_name is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    method_name = name_node.text.decode("utf-8")

            elif current.type == "function_declaration" and method_name is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    method_name = name_node.text.decode("utf-8")

            elif current.type == "arrow_function" and method_name is None:
                # Check if assigned to a variable
                parent = current.parent
                if parent and parent.type == "variable_declarator":
                    name_node = parent.child_by_field_name("name")
                    if name_node:
                        method_name = name_node.text.decode("utf-8")

            elif current.type == "class_declaration" and class_name is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    class_name = name_node.text.decode("utf-8")

            current = current.parent

        if class_name and method_name:
            return f"{class_name}.{method_name}"
        elif method_name:
            return method_name
        return "<module>"

    # --- Private: assignments ---

    def _walk_assignments(self, node: Node, class_name: Optional[str], result: dict):
        """Find this.x = new Foo() and const x = new Foo() patterns."""
        if node.type == "class_declaration":
            name_node = node.child_by_field_name("name")
            cn = name_node.text.decode("utf-8") if name_node else None
            for child in node.children:
                self._walk_assignments(child, cn, result)
            return

        # this.x = new Foo() in constructor/method
        if node.type == "assignment_expression" and class_name:
            left = node.child_by_field_name("left")
            right = node.child_by_field_name("right")
            if left and right and left.type == "member_expression":
                obj = left.child_by_field_name("object")
                prop = left.child_by_field_name("property")
                if obj and prop and obj.text == b"this":
                    attr_name = prop.text.decode("utf-8")
                    resolved = self._resolve_rhs(right)
                    if resolved:
                        result[f"{class_name}.{attr_name}"] = resolved

        # const x = new Foo() / let x = new Foo()
        if node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            value_node = node.child_by_field_name("value")
            if name_node and value_node:
                resolved = self._resolve_rhs(value_node)
                if resolved:
                    prefix = f"{class_name}." if class_name else ""
                    result[f"{prefix}{name_node.text.decode('utf-8')}"] = resolved

        for child in node.children:
            self._walk_assignments(child, class_name, result)

    def _resolve_rhs(self, node: Node) -> Optional[str]:
        """If node is new ClassName(), return ClassName."""
        if node.type == "new_expression":
            constructor = node.child_by_field_name("constructor")
            if constructor and constructor.type == "identifier":
                return constructor.text.decode("utf-8")
        return None

    # --- Private: annotations ---

    def _walk_annotations(self, node: Node, class_name: Optional[str], result: dict):
        """Extract type annotations from parameters."""
        if node.type == "class_declaration":
            name_node = node.child_by_field_name("name")
            cn = name_node.text.decode("utf-8") if name_node else None
            for child in node.children:
                self._walk_annotations(child, cn, result)
            return

        if node.type in ("method_definition", "function_declaration") and class_name:
            params = node.child_by_field_name("parameters")
            if params:
                for param in params.named_children:
                    if param.type == "required_parameter":
                        name_node = param.child_by_field_name("pattern")
                        type_node = param.child_by_field_name("type")
                        if name_node and type_node:
                            param_name = name_node.text.decode("utf-8")
                            type_text = type_node.text.decode("utf-8")
                            # Strip leading ': '
                            type_name = type_text.lstrip(": ").split("<")[0].strip()
                            if param_name != "this" and type_name[0:1].isupper():
                                result[f"{class_name}.{param_name}"] = type_name

        for child in node.children:
            self._walk_annotations(child, class_name, result)

    # --- Helpers ---

    @staticmethod
    def _string_value(node: Node) -> str:
        """Extract string content from a string node (strip quotes)."""
        text = node.text.decode("utf-8")
        if (text.startswith("'") and text.endswith("'")) or \
           (text.startswith('"') and text.endswith('"')):
            return text[1:-1]
        return text
