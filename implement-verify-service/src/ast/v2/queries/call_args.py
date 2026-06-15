"""Extract route-registration calls with their string-literal arguments.

For frameworks that register routes programmatically (Express, Gin, Slim, Oatpp...).
Tree-sitter for Go/TypeScript/Python; regex fallback for PHP/Ruby.

Output: Call records with callee, args[], file, line, target_method (if resolvable).
"""
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


@dataclass
class Call:
    file: str
    line: int
    callee: str            # e.g. "router.GET", "app.get", "$g_app->get"
    string_args: list[str] = field(default_factory=list)  # all string-literal args, in order
    handler_ref: str = ""  # second arg name if it's an identifier (handler reference)


# ---------------------------------------------------------------------------
# Tree-sitter walks
# ---------------------------------------------------------------------------

def _scm_extract(source: bytes, file_path: str,
                 lang_name: str, query_name: str,
                 callee_pattern: re.Pattern) -> list[Call]:
    """Drive call_args extraction from a .scm query file.

    Each match exposes captures that name the receiver, method, and arguments.
    We assemble a `callee_text` (e.g. 'router.GET' or 'Route::get') and filter
    by the regex the playbook supplied.
    """
    from src.ast.v2.tree_sitter_runner import run_query, node_text
    out: list[Call] = []
    for _pat, caps in run_query(lang_name, query_name, source):
        method_node = (caps.get("call.method") or [None])[0]
        recv_node   = (caps.get("call.receiver") or [None])[0]
        args_node   = (caps.get("call.args") or [None])[0]
        call_node   = (caps.get("call") or [None])[0]
        if args_node is None or call_node is None:
            continue

        method_text = node_text(method_node, source) if method_node else ""
        recv_text   = node_text(recv_node, source)   if recv_node else ""

        # Build a callee string the playbook regex can match against.
        if recv_text and method_text:
            # Prefer the joiner that appears literally in source between them.
            sep = "."
            if lang_name == "php":
                # Detect -> vs :: by inspecting the call_node text
                full = node_text(call_node, source)
                if "::" in full:
                    sep = "::"
                else:
                    sep = "->"
            callee_text = f"{recv_text}{sep}{method_text}"
        else:
            callee_text = method_text or recv_text

        if not callee_pattern.search(callee_text):
            continue

        string_args, handler_ref = _collect_args(args_node, source)
        if not string_args:
            continue
        out.append(Call(
            file=file_path,
            line=call_node.start_point[0] + 1,
            callee=callee_text,
            string_args=string_args,
            handler_ref=handler_ref,
        ))
    return out


_PATH_KEYS = ("path", "url", "route", "uri")


def _collect_args(args_node, source: bytes) -> tuple[list[str], str]:
    """Walk an arguments node. Returns (string_literal_values, first_identifier_arg).

    String values come from:
      - direct string-literal arguments (`router.get('/x', h)`)
      - object-literal arguments where a key in _PATH_KEYS holds a string
        (`router.get({ path: '/x', method: 'GET' }, h)` →  '/x')
        This generic capability handles Hapi (`server.route({path:..., method:...})`),
        Kibana (`router.versioned.get({path:...})`), Fastify (`fastify.route({url:...})`),
        and any other framework that passes route config as an object literal.
    """
    strings: list[str] = []
    first_ident = ""
    for child in args_node.children:
        if child.type in ("string", "string_literal", "raw_string_literal",
                          "interpreted_string_literal", "template_string"):
            txt = source[child.start_byte:child.end_byte].decode("utf-8", "replace")
            stripped = txt.strip('"').strip("'").strip("`")
            strings.append(stripped)
        elif child.type in ("object", "object_literal", "object_expression",
                            "composite_literal", "array_creation_expression",
                            "dictionary"):
            # Walk object's pairs/properties for path-bearing keys
            extracted = _extract_path_from_object_arg(child, source)
            if extracted:
                strings.append(extracted)
        elif child.type in ("identifier", "selector_expression",
                            "member_expression", "field_access",
                            "function_declarator"):
            if not first_ident:
                first_ident = source[child.start_byte:child.end_byte].decode("utf-8", "replace")
    return strings, first_ident


def _extract_path_from_object_arg(obj_node, source: bytes) -> str:
    """Find a string value under one of _PATH_KEYS inside an object literal.

    Tree-sitter node types for object pairs vary by language:
      TypeScript / JavaScript: `pair` with `key: property_identifier|string` and `value`
      Go: `keyed_element` (composite_literal child)
      PHP: `array_element_initializer`
      Ruby: handled via scoped patterns elsewhere.

    Returns the first matching path string, or "" if none found.
    """
    for child in obj_node.children:
        # TS/JS pair: key, ':', value
        if child.type in ("pair", "property_assignment", "object_property"):
            key_text = ""
            value_node = None
            for c in child.children:
                if c.type in ("property_identifier", "identifier", "string", "string_literal"):
                    if not key_text:
                        key_text = source[c.start_byte:c.end_byte].decode("utf-8", "replace")
                        key_text = key_text.strip('"').strip("'").strip("`")
                elif c.type in ("string", "string_literal", "interpreted_string_literal",
                                 "template_string", "raw_string_literal"):
                    value_node = c
            # If we didn't find a value via type, the child after ":" is the value
            if value_node is None:
                for i, c in enumerate(child.children):
                    if c.type == ":" and i + 1 < len(child.children):
                        value_node = child.children[i + 1]
                        break
            if key_text in _PATH_KEYS and value_node is not None:
                txt = source[value_node.start_byte:value_node.end_byte].decode("utf-8", "replace")
                stripped = txt.strip('"').strip("'").strip("`")
                if stripped:
                    return stripped

        # Go composite_literal: keyed_element with field_identifier + literal_value
        if child.type == "keyed_element":
            key_text = ""
            value_node = None
            for c in child.children:
                if c.type in ("field_identifier", "identifier"):
                    key_text = source[c.start_byte:c.end_byte].decode("utf-8", "replace").lower()
                elif c.type in ("interpreted_string_literal", "raw_string_literal"):
                    value_node = c
            if key_text in _PATH_KEYS and value_node is not None:
                txt = source[value_node.start_byte:value_node.end_byte].decode("utf-8", "replace")
                return txt.strip('"').strip("'").strip("`")

        # PHP array_element_initializer: key '=>' value
        if child.type == "array_element_initializer":
            key_text = ""
            value_node = None
            saw_arrow = False
            for c in child.children:
                if c.type in ("string", "encapsed_string"):
                    if not saw_arrow:
                        key_text = source[c.start_byte:c.end_byte].decode("utf-8", "replace")
                        key_text = key_text.strip('"').strip("'")
                    else:
                        value_node = c
                elif c.type == "=>":
                    saw_arrow = True
            if key_text in _PATH_KEYS and value_node is not None:
                txt = source[value_node.start_byte:value_node.end_byte].decode("utf-8", "replace")
                return txt.strip('"').strip("'")

    # Recurse into nested objects (e.g. router.get({ options: { path: '/x' } }, h))
    for child in obj_node.children:
        if child.type in ("object", "object_literal", "object_expression",
                          "composite_literal", "array_creation_expression"):
            inner = _extract_path_from_object_arg(child, source)
            if inner:
                return inner
    return ""


def _go_extract(source: bytes, file_path: str, callee_pattern: re.Pattern) -> list[Call]:
    return _scm_extract(source, file_path, "go", "call_args", callee_pattern)


def _python_extract(source: bytes, file_path: str, callee_pattern: re.Pattern) -> list[Call]:
    return _scm_extract(source, file_path, "python", "call_args", callee_pattern)


def _typescript_extract(source: bytes, file_path: str, callee_pattern: re.Pattern) -> list[Call]:
    return _scm_extract(source, file_path, "typescript", "call_args", callee_pattern)


# ---------------------------------------------------------------------------
# Regex fallback (PHP, Ruby)
# ---------------------------------------------------------------------------

def _regex_extract(source: bytes, file_path: str, callee_pattern: re.Pattern,
                    line_pattern: re.Pattern) -> list[Call]:
    out: list[Call] = []
    text = source.decode("utf-8", "replace")
    for i, line in enumerate(text.splitlines(), start=1):
        m = line_pattern.search(line)
        if not m:
            continue
        callee = m.group("callee")
        args = m.group("args") or ""
        # Pull string literals
        strings = re.findall(r'"([^"]*)"|\'([^\']*)\'', args)
        flat = [a or b for (a, b) in strings]
        if not flat:
            continue
        out.append(Call(
            file=file_path,
            line=i,
            callee=callee,
            string_args=flat,
            handler_ref="",
        ))
    return out


_PHP_CALL_LINE = re.compile(
    r'(?P<callee>\$\w+(?:->|::)\w+|\w+::\w+|->\s*\w+)\s*\((?P<args>[^)]*)\)'
)
_RUBY_CALL_LINE = re.compile(
    r'^\s*(?P<callee>get|post|put|delete|patch|match|resources?|root|namespace|scope)\s+(?P<args>.+)$'
)


def _php_extract(source: bytes, file_path: str, callee_pattern: re.Pattern) -> list[Call]:
    """PHP via php/call_args.scm — three call shapes ($v->m, Cls::m, fn(...))."""
    return _scm_extract(source, file_path, "php", "call_args", callee_pattern)


def _ruby_extract(source: bytes, file_path: str, callee_pattern: re.Pattern) -> list[Call]:
    out: list[Call] = []
    text = source.decode("utf-8", "replace")
    for i, line in enumerate(text.splitlines(), start=1):
        m = _RUBY_CALL_LINE.match(line)
        if not m:
            continue
        callee = m.group("callee")
        if not callee_pattern.search(callee):
            continue
        args = m.group("args") or ""
        # Ruby uses single or double quotes; also bare symbols like `:users`
        strings = re.findall(r'"([^"]*)"|\'([^\']*)\'', args)
        flat = [a or b for (a, b) in strings]
        # If no string but symbol arg (e.g. resources :users), capture symbol
        if not flat:
            sym = re.search(r':(\w+)', args)
            if sym:
                flat = [sym.group(1)]
        if not flat:
            continue
        out.append(Call(
            file=file_path,
            line=i,
            callee=callee,
            string_args=flat,
            handler_ref="",
        ))
    return out


EXTRACTORS = {
    "go":  _go_extract,
    "py":  _python_extract,
    "ts":  _typescript_extract,
    "tsx": _typescript_extract,
    "js":  _typescript_extract,  # TypeScript grammar handles JS
    "jsx": _typescript_extract,
    "php": _php_extract,
    "rb":  _ruby_extract,
}


class CallArgsQuery:
    """Find route-registration calls with string-literal args."""

    def __init__(self, project_root: str | Path):
        self._root = Path(project_root)

    def in_files(self, files: Iterable[str], callee_pattern: str) -> list[Call]:
        """Walk files, return Call records for callees matching `callee_pattern` (regex)."""
        pat = re.compile(callee_pattern)
        out: list[Call] = []
        for rel in files:
            ext = Path(rel).suffix.lstrip(".").lower()
            extractor = EXTRACTORS.get(ext)
            if extractor is None:
                continue
            abs_path = self._root / rel
            if not abs_path.exists():
                continue
            try:
                source = abs_path.read_bytes()
            except OSError:
                continue
            try:
                out.extend(extractor(source, rel, pat))
            except Exception:
                continue
        return out
