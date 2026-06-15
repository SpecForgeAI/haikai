"""Generic tree-sitter extractor for any language.

Handles common AST patterns shared across most languages:
- call_expression / method_call / function_call → calls
- require / import / use / include → imports
- assignment_expression → assignments

Not as thorough as dedicated extractors, but works for ANY language
that tree-sitter can parse. Better than ctags-only.
"""
from typing import Optional, Any

from tree_sitter import Language, Parser, Node

from src.ast.treesitter_models import RawCallSite
from src.ast.extractors.base import LanguageExtractor


# Common node types for call expressions across languages
CALL_TYPES = {
    "call_expression", "call", "method_call", "method_call_expression",
    "function_call", "send",  # Ruby uses "send" for method calls
    "invocation_expression",  # Kotlin/C#
}

# Common node types for import/require statements
IMPORT_TYPES = {
    "import_statement", "import_declaration",
    "call",  # Ruby require("foo") is a call node
}

# Identifiers that mean "import" when used as function calls
IMPORT_FUNCTIONS = {"require", "require_relative", "include", "import", "load"}


class GenericExtractor(LanguageExtractor):
    """Language-agnostic tree-sitter extractor.

    Created dynamically for languages without a dedicated extractor.
    Pass the language grammar and extensions at init time.
    """

    def __init__(self, language: Language, extensions: list[str]):
        self._language = language
        self._extensions = extensions
        self._parser = Parser(language)

    @property
    def file_extensions(self) -> list[str]:
        return self._extensions

    @property
    def grammar(self) -> Any:
        return self._language

    def extract_calls(self, source: bytes, file_path: str) -> list[RawCallSite]:
        tree = self._parser.parse(source)
        calls: list[RawCallSite] = []
        self._walk_calls(tree.root_node, file_path, calls)
        return calls

    def extract_imports(self, source: bytes) -> list[tuple[str, list[str], bool]]:
        tree = self._parser.parse(source)
        imports: list[tuple[str, list[str], bool]] = []
        self._walk_imports(tree.root_node, imports)
        return imports

    def extract_assignments(self, source: bytes) -> dict[str, str]:
        # Generic: skip — ctags handles variable detection
        return {}

    def extract_annotations(self, source: bytes) -> dict[str, str]:
        # Generic: skip — ctags handles type info
        return {}

    # --- Call extraction ---

    def _walk_calls(self, node: Node, file_path: str, calls: list[RawCallSite]):
        if node.type in CALL_TYPES:
            call = self._extract_call(node, file_path)
            if call:
                calls.append(call)

        for child in node.children:
            self._walk_calls(child, file_path, calls)

    def _extract_call(self, node: Node, file_path: str) -> Optional[RawCallSite]:
        line = node.start_point[0] + 1
        caller = self._find_enclosing_scope(node)

        # Try field-based extraction (most languages)
        func = node.child_by_field_name("function") or node.child_by_field_name("method")
        if func:
            # obj.method()
            if func.type in ("member_expression", "field_expression", "attribute"):
                obj = func.child_by_field_name("object") or func.child_by_field_name("value")
                prop = func.child_by_field_name("property") or func.child_by_field_name("field")
                if obj and prop:
                    return RawCallSite(
                        file_path=file_path,
                        caller_name=caller,
                        receiver=obj.text.decode("utf-8", errors="replace"),
                        method=prop.text.decode("utf-8", errors="replace"),
                        line=line,
                    )

            # simple_func()
            if func.type == "identifier":
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=None,
                    method=func.text.decode("utf-8", errors="replace"),
                    line=line,
                )

            # scoped: Module::method() or Module.method()
            text = func.text.decode("utf-8", errors="replace")
            if "::" in text or "." in text:
                parts = text.replace("::", ".").rsplit(".", 1)
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=parts[0] if len(parts) > 1 else None,
                    method=parts[-1],
                    line=line,
                )

        # Ruby "send" nodes: object.method(args)
        if node.type == "send" or node.type == "call":
            receiver_node = node.child_by_field_name("receiver")
            method_node = node.child_by_field_name("method") or node.child_by_field_name("name")
            if method_node:
                receiver_text = receiver_node.text.decode("utf-8", errors="replace") if receiver_node else None
                method_text = method_node.text.decode("utf-8", errors="replace")
                return RawCallSite(
                    file_path=file_path,
                    caller_name=caller,
                    receiver=receiver_text,
                    method=method_text,
                    line=line,
                )

        # Fallback: use the whole node text
        text = node.text.decode("utf-8", errors="replace").split("(")[0].strip()
        if text and len(text) < 100:
            parts = text.replace("::", ".").rsplit(".", 1)
            return RawCallSite(
                file_path=file_path,
                caller_name=caller,
                receiver=parts[0] if len(parts) > 1 else None,
                method=parts[-1],
                line=line,
            )

        return None

    def _find_enclosing_scope(self, node: Node) -> str:
        current = node.parent
        while current:
            if current.type in (
                "function_definition", "method_definition", "function_item",
                "function_declaration", "method_declaration", "method",
                "function", "def",
            ):
                name = current.child_by_field_name("name")
                if name:
                    return name.text.decode("utf-8", errors="replace")
            if current.type in (
                "class_definition", "class_declaration", "class",
                "module", "impl_item",
            ):
                name = current.child_by_field_name("name")
                if name:
                    return name.text.decode("utf-8", errors="replace")
            current = current.parent
        return "<module>"

    # --- Import extraction ---

    def _walk_imports(self, node: Node, imports: list):
        # Standard import/require statements
        if node.type in IMPORT_TYPES:
            self._extract_import(node, imports)

        # Ruby: require "foo" is a method call
        if node.type in ("call", "send"):
            method = node.child_by_field_name("method") or node.child_by_field_name("name")
            if method and method.text.decode("utf-8", errors="replace") in IMPORT_FUNCTIONS:
                args = node.child_by_field_name("arguments")
                if args:
                    for arg in args.named_children:
                        text = arg.text.decode("utf-8", errors="replace").strip("'\"")
                        imports.append((text, [text.rsplit("/", 1)[-1]], False))
                return

        for child in node.children:
            self._walk_imports(child, imports)

    def _extract_import(self, node: Node, imports: list):
        """Extract module name from import/require nodes."""
        # Try common field names
        for field in ("source", "module_name", "path", "name"):
            source = node.child_by_field_name(field)
            if source:
                text = source.text.decode("utf-8", errors="replace").strip("'\"")
                name = text.rsplit("/", 1)[-1].rsplit(".", 1)[0]
                imports.append((text, [name], False))
                return

        # Fallback: look for string literals in children
        for child in node.named_children:
            if child.type in ("string", "string_literal", "string_content"):
                text = child.text.decode("utf-8", errors="replace").strip("'\"")
                if text and "/" in text or "." not in text:
                    name = text.rsplit("/", 1)[-1]
                    imports.append((text, [name], False))
                    return
