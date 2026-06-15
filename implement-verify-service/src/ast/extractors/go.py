"""Go tree-sitter extractor.

Extracts calls, imports, assignments, and type info from Go ASTs.
Handles: call_expression, selector_expression, go_statement, defer_statement,
import_declaration, short_var_declaration, method_declaration with receivers.
"""
from typing import Optional, Any

import tree_sitter_go as ts_go
from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor

GO_LANGUAGE = Language(ts_go.language())


class GoExtractor(LanguageExtractor):
    """Extract call sites, imports, assignments, and type info from Go source."""

    def __init__(self):
        self._parser = Parser(GO_LANGUAGE)

    @property
    def file_extensions(self) -> list[str]:
        return [".go"]

    @property
    def grammar(self) -> Any:
        return GO_LANGUAGE

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        """Extract all call expressions including goroutines and defers."""
        tree = self._parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        """Extract import declarations.

        Handles:
        - import "fmt"
        - import ( "fmt" ; "os" )
        - import alias "package/path"
        """
        tree = self._parser.parse(source)
        imports: list[tuple[str, list[str], bool]] = []

        for node in tree.root_node.children:
            if node.type != "import_declaration":
                continue

            for child in node.children:
                if child.type == "import_spec":
                    self._parse_import_spec(child, imports)
                elif child.type == "import_spec_list":
                    for spec in child.children:
                        if spec.type == "import_spec":
                            self._parse_import_spec(spec, imports)

        return imports

    def extract_assignments(self, source: bytes) -> dict[str, str]:
        """Extract variable assignments for type resolution.

        Handles:
        - x := NewFoo()
        - var x Foo = NewFoo()
        - x := &Foo{}
        """
        tree = self._parser.parse(source)
        assignments: dict[str, str] = {}
        self._walk_assignments(tree.root_node, None, assignments)
        return assignments

    def extract_annotations(self, source: bytes) -> dict[str, str]:
        """Extract type info from var declarations.

        Go doesn't have annotations, but typed variable declarations
        serve the same resolution purpose: var db Database.
        """
        tree = self._parser.parse(source)
        annotations: dict[str, str] = {}
        self._walk_type_declarations(tree.root_node, None, annotations)
        return annotations

    # --- Private: call extraction ---

    def _walk_calls(self, node: Node, file_path: str, calls: list[RawCallSite]):
        """Walk AST to find call expressions, go statements, and defer statements."""
        if node.type == "call_expression":
            call = self._extract_call(node, file_path)
            if call:
                calls.append(call)

        elif node.type == "go_statement":
            # go handler() / go func() { ... }()
            for child in node.children:
                if child.type == "call_expression":
                    call = self._extract_call(child, file_path)
                    if call:
                        calls.append(call)

        elif node.type == "defer_statement":
            # defer conn.Close()
            for child in node.children:
                if child.type == "call_expression":
                    call = self._extract_call(child, file_path)
                    if call:
                        calls.append(call)

        for child in node.children:
            self._walk_calls(child, file_path, calls)

    def _extract_call(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        """Extract a call from call_expression."""
        func = node.child_by_field_name("function")
        if not func:
            return None

        caller_name = self._find_enclosing_scope(node)
        line = node.start_point[0] + 1

        if func.type == "selector_expression":
            # pkg.Func() or obj.Method()
            operand = func.child_by_field_name("operand")
            field = func.child_by_field_name("field")
            if operand and field:
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller_name,
                    receiver=operand.text.decode("utf-8"),
                    method=field.text.decode("utf-8"),
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

    def _find_enclosing_scope(self, node: Node) -> str:
        """Walk up AST to find enclosing function/method."""
        current = node.parent
        func_name = None
        receiver_type = None

        while current:
            if current.type == "function_declaration" and func_name is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    func_name = name_node.text.decode("utf-8")

            elif current.type == "method_declaration" and func_name is None:
                name_node = current.child_by_field_name("name")
                if name_node:
                    func_name = name_node.text.decode("utf-8")
                # Extract receiver type from the 'receiver' field
                receiver_node = current.child_by_field_name("receiver")
                if receiver_node:
                    receiver_type = self._extract_receiver_type(receiver_node)

            elif current.type == "func_literal" and func_name is None:
                func_name = "<anonymous>"

            current = current.parent

        if receiver_type and func_name:
            return f"{receiver_type}.{func_name}"
        elif func_name:
            return func_name
        return "<module>"

    # --- Private: imports ---

    def _parse_import_spec(self, node: Node, imports: list):
        """Parse a single import_spec node."""
        alias = None
        path = None

        for child in node.children:
            if child.type == "package_identifier":
                alias = child.text.decode("utf-8")
            elif child.type == "interpreted_string_literal":
                path = child.text.decode("utf-8").strip('"')
            elif child.type == "dot":
                alias = "."

        if path:
            # Package name is last component of path
            pkg_name = alias or path.split("/")[-1]
            imports.append((path, [pkg_name], False))

    # --- Private: assignments ---

    def _walk_assignments(self, node: Node, scope: Optional[str], result: dict):
        """Find x := NewFoo() and x := &Foo{} patterns."""
        if node.type == "function_declaration":
            name_node = node.child_by_field_name("name")
            fn = name_node.text.decode("utf-8") if name_node else None
            for child in node.children:
                self._walk_assignments(child, fn, result)
            return

        if node.type == "method_declaration":
            name_node = node.child_by_field_name("name")
            fn = name_node.text.decode("utf-8") if name_node else None
            receiver_node = node.child_by_field_name("receiver")
            recv_type = self._extract_receiver_type(receiver_node)
            scope_name = f"{recv_type}.{fn}" if recv_type and fn else fn
            for child in node.children:
                self._walk_assignments(child, scope_name, result)
            return

        # x := NewFoo() or x := &Foo{}
        if node.type == "short_var_declaration":
            left = node.child_by_field_name("left")
            right = node.child_by_field_name("right")
            if left and right:
                var_names = [c.text.decode("utf-8") for c in left.named_children
                             if c.type == "identifier"]
                resolved = self._resolve_rhs(right)
                if resolved and var_names:
                    prefix = f"{scope}." if scope else ""
                    result[f"{prefix}{var_names[0]}"] = resolved

        for child in node.children:
            self._walk_assignments(child, scope, result)

    def _resolve_rhs(self, node: Node) -> Optional[str]:
        """If node is NewFoo() or &Foo{}, return Foo."""
        # expression_list wraps the RHS
        target = node
        if node.type == "expression_list" and node.named_children:
            target = node.named_children[0]

        # NewFoo() pattern
        if target.type == "call_expression":
            func = target.child_by_field_name("function")
            if func and func.type == "identifier":
                name = func.text.decode("utf-8")
                # Convention: NewFoo -> Foo
                if name.startswith("New") and len(name) > 3:
                    return name[3:]

        # &Foo{} pattern
        if target.type == "unary_expression":
            operand = target.child_by_field_name("operand")
            if operand and operand.type == "composite_literal":
                type_node = operand.child_by_field_name("type")
                if type_node and type_node.type == "type_identifier":
                    return type_node.text.decode("utf-8")

        return None

    # --- Private: type declarations ---

    def _walk_type_declarations(self, node: Node, scope: Optional[str], result: dict):
        """Extract var declarations with explicit types: var db Database."""
        if node.type == "function_declaration":
            name_node = node.child_by_field_name("name")
            fn = name_node.text.decode("utf-8") if name_node else None
            for child in node.children:
                self._walk_type_declarations(child, fn, result)
            return

        if node.type == "method_declaration":
            name_node = node.child_by_field_name("name")
            fn = name_node.text.decode("utf-8") if name_node else None
            receiver_node = node.child_by_field_name("receiver")
            recv_type = self._extract_receiver_type(receiver_node)
            scope_name = f"{recv_type}.{fn}" if recv_type and fn else fn
            for child in node.children:
                self._walk_type_declarations(child, scope_name, result)
            return

        if node.type == "var_declaration":
            for child in node.children:
                if child.type == "var_spec":
                    names = []
                    type_name = None
                    for vc in child.children:
                        if vc.type == "identifier":
                            names.append(vc.text.decode("utf-8"))
                        elif vc.type == "type_identifier":
                            type_name = vc.text.decode("utf-8")
                        elif vc.type == "pointer_type":
                            for pt in vc.children:
                                if pt.type == "type_identifier":
                                    type_name = pt.text.decode("utf-8")
                    if type_name and names:
                        prefix = f"{scope}." if scope else ""
                        for n in names:
                            result[f"{prefix}{n}"] = type_name

        for child in node.children:
            self._walk_type_declarations(child, scope, result)

    def _extract_receiver_type(self, params: Optional[Node]) -> Optional[str]:
        """Extract receiver type from method_declaration parameters."""
        if not params:
            return None
        for param in params.named_children:
            if param.type == "parameter_declaration":
                for pc in param.children:
                    if pc.type == "pointer_type":
                        for pt in pc.children:
                            if pt.type == "type_identifier":
                                return pt.text.decode("utf-8")
                    elif pc.type == "type_identifier":
                        return pc.text.decode("utf-8")
        return None
