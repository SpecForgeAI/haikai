"""Annotation/decorator extraction via tree-sitter (Phase 2 — proper).

Replaces the regex pilot. Walks the AST per language and extracts every
annotation with:
  - target_kind (class | method)
  - target_class (enclosing class name)
  - target_method (method name, None for class-level)
  - annotation name
  - args dict (parsed key/value or single positional value)

Supported languages: java, python, typescript, csharp.
PHP/Ruby/Go covered by Phase 3 (call_args).
"""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

# Lazy imports per language so missing optional grammars don't break things.

@dataclass
class Annotation:
    file: str
    line: int
    target_kind: str              # "class" or "method"
    target_class: str
    target_method: str | None
    annotation: str
    args: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def _parse_args_text(text: str) -> dict:
    """Parse the argument list inside (...) for an annotation.

    Handles:
      ("/x")                       -> {"value": "/x"}
      (value="/x")                 -> {"value": "/x"}
      (value="/x", method=POST)    -> {"value":"/x", "method":"POST"}
      ({"/x", "/y"})               -> {"value": ["/x","/y"]}
      ()                            -> {}
    """
    if not text:
        return {}
    s = text.strip()
    if s.startswith("(") and s.endswith(")"):
        s = s[1:-1].strip()
    if not s:
        return {}

    # Split on top-level commas
    parts: list[str] = []
    depth = 0
    in_str = False
    escape = False
    buf: list[str] = []
    for ch in s:
        if escape:
            buf.append(ch)
            escape = False
            continue
        if ch == "\\" and in_str:
            buf.append(ch); escape = True
            continue
        if ch == '"':
            in_str = not in_str
            buf.append(ch)
            continue
        if not in_str:
            if ch in "{[(":
                depth += 1
            elif ch in "}])":
                depth -= 1
            if ch == "," and depth == 0:
                parts.append("".join(buf).strip())
                buf = []
                continue
        buf.append(ch)
    if buf:
        parts.append("".join(buf).strip())

    out: dict = {}
    for part in parts:
        if "=" in part and not part.startswith('"'):
            k, v = part.split("=", 1)
            k = k.strip()
            v = _parse_value(v.strip())
            out[k] = v
        else:
            v = _parse_value(part.strip())
            # First positional → "value"
            if "value" not in out:
                out["value"] = v
    return out


def _parse_value(text: str):
    """Parse a single annotation argument value."""
    text = text.strip()
    if not text:
        return ""
    # String literal — handle "..." and '...' and `...`
    for q in ('"', "'", "`"):
        if len(text) >= 2 and text.startswith(q) and text.endswith(q):
            return text[1:-1]
    # Brace array {"a","b"} or [a,b]
    if (text.startswith("{") and text.endswith("}")) or \
       (text.startswith("[") and text.endswith("]")):
        inner = text[1:-1]
        items = []
        depth = 0
        in_str = False
        buf: list[str] = []
        for ch in inner:
            if ch == '"':
                in_str = not in_str
            if not in_str:
                if ch in "{[(":
                    depth += 1
                elif ch in "}])":
                    depth -= 1
                if ch == "," and depth == 0:
                    items.append(_parse_value("".join(buf).strip()))
                    buf = []
                    continue
            buf.append(ch)
        if buf:
            items.append(_parse_value("".join(buf).strip()))
        # If single-item array, hoist
        if len(items) == 1:
            return items[0]
        return items
    # Otherwise raw token (identifier, enum, etc.)
    return text


# ---------------------------------------------------------------------------
# Java
# ---------------------------------------------------------------------------

def extract_java_annotations(source: bytes, file_path: str,
                              allowed_names: list[str] | None = None) -> list[Annotation]:
    from src.ast.v2.tree_sitter_runner import run_query, first_capture
    out: list[Annotation] = []
    for _pat, caps in run_query("java", "annotations", source):
        ann_name = first_capture(caps, "ann.name", source)
        if not ann_name:
            continue
        if allowed_names and ann_name not in allowed_names:
            continue
        ann_node = (caps.get("ann") or [None])[0]
        args_text = first_capture(caps, "ann.args", source)

        # Determine target kind (method vs class)
        if caps.get("method"):
            target_kind = "method"
            target_method = first_capture(caps, "method.name", source)
            target_class = first_capture(caps, "class.name", source) or _find_enclosing_class(ann_node, source)
        else:
            target_kind = "class"
            target_method = None
            target_class = first_capture(caps, "class.name", source)

        line = ann_node.start_point[0] + 1 if ann_node is not None else 1
        out.append(Annotation(
            file=file_path, line=line,
            target_kind=target_kind,
            target_class=target_class or "?",
            target_method=target_method,
            annotation=ann_name,
            args=_parse_args_text(args_text),
        ))
    return out


def _find_enclosing_class(node, source: bytes) -> str:
    """Walk up the AST looking for class_declaration/interface_declaration ancestor."""
    n = node.parent if node is not None else None
    while n is not None:
        if n.type in ("class_declaration", "interface_declaration"):
            for c in n.children:
                if c.type == "identifier":
                    return source[c.start_byte:c.end_byte].decode("utf-8", "replace")
            name_node = n.child_by_field_name("name")
            if name_node:
                return source[name_node.start_byte:name_node.end_byte].decode("utf-8", "replace")
            return "?"
        n = n.parent
    return ""


def _emit_java_annotation(ann_node, source: bytes, file_path: str,
                target_kind: str, target_class: str, target_method: str | None,
                allowed_names: list[str] | None, out: list[Annotation]):
    """Emit annotation if its node type is annotation/marker_annotation and name allowed."""
    if ann_node.type not in ("annotation", "marker_annotation"):
        return
    name_node = ann_node.child_by_field_name("name")
    if not name_node:
        return
    ann_name = source[name_node.start_byte:name_node.end_byte].decode()
    if allowed_names and ann_name not in allowed_names:
        return
    args_node = ann_node.child_by_field_name("arguments")
    args_text = source[args_node.start_byte:args_node.end_byte].decode() if args_node else ""
    out.append(Annotation(
        file=file_path,
        line=ann_node.start_point[0] + 1,
        target_kind=target_kind,
        target_class=target_class,
        target_method=target_method,
        annotation=ann_name,
        args=_parse_args_text(args_text),
    ))


# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------

def _find_enclosing(node, source: bytes, target_types: tuple[str, ...]) -> tuple[str, str]:
    """Return (class_name, kind) of nearest enclosing class/function ancestor."""
    n = node.parent if node is not None else None
    while n is not None:
        if n.type in target_types:
            for c in n.children:
                if c.type in ("identifier", "type_identifier", "property_identifier", "name"):
                    return source[c.start_byte:c.end_byte].decode("utf-8", "replace"), n.type
            name_node = n.child_by_field_name("name")
            if name_node:
                return source[name_node.start_byte:name_node.end_byte].decode("utf-8", "replace"), n.type
            return "?", n.type
        n = n.parent
    return "", ""


def extract_python_decorators(source: bytes, file_path: str,
                               allowed_names: list[str] | None = None) -> list[Annotation]:
    from src.ast.v2.tree_sitter_runner import run_query, first_capture
    out: list[Annotation] = []
    for _pat, caps in run_query("python", "decorators", source):
        dec_name = first_capture(caps, "dec.name", source)
        if not dec_name:
            continue
        short = dec_name.rsplit(".", 1)[-1]
        if allowed_names and not any(n in (dec_name, short) for n in allowed_names):
            continue
        dec_node = (caps.get("dec") or [None])[0]
        args_text = first_capture(caps, "dec.args", source)

        is_class = bool(caps.get("class"))
        target_kind = "class" if is_class else "method"
        target_class = first_capture(caps, "class.name", source)
        target_method = None if is_class else first_capture(caps, "method.name", source)

        if target_kind == "method" and not target_class and dec_node is not None:
            cls, _ = _find_enclosing(dec_node, source, ("class_definition",))
            target_class = cls

        line = dec_node.start_point[0] + 1 if dec_node is not None else 1
        out.append(Annotation(
            file=file_path, line=line,
            target_kind=target_kind,
            target_class=target_class or "",
            target_method=target_method,
            annotation=dec_name,
            args=_parse_args_text(args_text),
        ))
    return out


def _emit_python_decorator(decorator_node, source: bytes, file_path: str,
                            target_kind: str, target_class: str, target_method: str | None,
                            allowed_names: list[str] | None, out: list[Annotation]):
    # Decorator child[0] is "@", child[1] is the expression
    expr = None
    for c in decorator_node.children:
        if c.type not in ("@", "comment"):
            expr = c
            break
    if expr is None:
        return
    # call: name(args)  OR plain identifier  OR attribute access (e.g. app.route)
    name_text = ""
    args_text = ""
    if expr.type == "call":
        fn = expr.child_by_field_name("function")
        args = expr.child_by_field_name("arguments")
        if fn:
            name_text = source[fn.start_byte:fn.end_byte].decode()
        if args:
            args_text = source[args.start_byte:args.end_byte].decode()
    else:
        name_text = source[expr.start_byte:expr.end_byte].decode()

    # Match by full name OR last segment (e.g. app.route → "route")
    short = name_text.rsplit(".", 1)[-1]
    if allowed_names and not any(n in (name_text, short) for n in allowed_names):
        return

    out.append(Annotation(
        file=file_path,
        line=decorator_node.start_point[0] + 1,
        target_kind=target_kind,
        target_class=target_class,
        target_method=target_method,
        annotation=name_text,
        args=_parse_args_text(args_text),
    ))


# ---------------------------------------------------------------------------
# TypeScript / JavaScript decorators
# ---------------------------------------------------------------------------

def extract_typescript_decorators(source: bytes, file_path: str,
                                   allowed_names: list[str] | None = None) -> list[Annotation]:
    from src.ast.v2.tree_sitter_runner import run_query, first_capture, node_text
    out: list[Annotation] = []
    for _pat, caps in run_query("typescript", "decorators", source):
        dec_node = (caps.get("dec") or [None])[0]
        if dec_node is None:
            continue
        # Name + args live inside the decorator node; extract here.
        dec_name = ""
        args_text = ""
        for child in dec_node.children:
            if child.type == "call_expression":
                fn = child.child_by_field_name("function")
                args = child.child_by_field_name("arguments")
                if fn:
                    dec_name = node_text(fn, source)
                if args:
                    args_text = node_text(args, source)
                break
            elif child.type == "identifier":
                dec_name = node_text(child, source)
                break
            elif child.type == "member_expression":
                dec_name = node_text(child, source)
                break
        if not dec_name:
            continue
        short = dec_name.rsplit(".", 1)[-1]
        if allowed_names and not any(n in (dec_name, short) for n in allowed_names):
            continue

        is_class = bool(caps.get("class"))
        target_kind = "class" if is_class else "method"
        target_class = first_capture(caps, "class.name", source)
        target_method = None if is_class else first_capture(caps, "method.name", source)

        if target_kind == "method" and not target_class and dec_node is not None:
            cls, _ = _find_enclosing(dec_node, source, ("class_declaration", "class"))
            target_class = cls

        line = dec_node.start_point[0] + 1 if dec_node is not None else 1
        out.append(Annotation(
            file=file_path, line=line,
            target_kind=target_kind,
            target_class=target_class or "",
            target_method=target_method,
            annotation=short,
            args=_parse_args_text(args_text),
        ))
    return out


def _emit_ts_decorator(decorator_node, source: bytes, file_path: str,
                       target_kind: str, target_class: str, target_method: str | None,
                       allowed_names: list[str] | None, out: list[Annotation]):
    expr = None
    for c in decorator_node.children:
        if c.type != "@":
            expr = c
            break
    if expr is None:
        return
    name_text = ""
    args_text = ""
    if expr.type == "call_expression":
        fn = expr.child_by_field_name("function")
        args = expr.child_by_field_name("arguments")
        if fn:
            name_text = source[fn.start_byte:fn.end_byte].decode()
        if args:
            args_text = source[args.start_byte:args.end_byte].decode()
    else:
        name_text = source[expr.start_byte:expr.end_byte].decode()

    short = name_text.rsplit(".", 1)[-1]
    if allowed_names and not any(n in (name_text, short) for n in allowed_names):
        return

    out.append(Annotation(
        file=file_path,
        line=decorator_node.start_point[0] + 1,
        target_kind=target_kind,
        target_class=target_class,
        target_method=target_method,
        annotation=name_text,
        args=_parse_args_text(args_text),
    ))


# ---------------------------------------------------------------------------
# C# attributes
# ---------------------------------------------------------------------------

def extract_csharp_attributes(source: bytes, file_path: str,
                               allowed_names: list[str] | None = None) -> list[Annotation]:
    from src.ast.v2.tree_sitter_runner import run_query, first_capture, node_text
    out: list[Annotation] = []
    for _pat, caps in run_query("csharp", "attributes", source):
        name_text = first_capture(caps, "attr.name", source)
        if not name_text:
            continue
        short = name_text.rsplit(".", 1)[-1]
        if allowed_names and not any(n in (name_text, short, short + "Attribute") for n in allowed_names):
            continue
        attr_node = (caps.get("attr") or [None])[0]
        args_text = first_capture(caps, "attr.args", source)

        is_class = bool(caps.get("class"))
        target_kind = "class" if is_class else "method"
        target_class = first_capture(caps, "class.name", source)
        target_method = None if is_class else first_capture(caps, "method.name", source)

        if target_kind == "method" and not target_class and attr_node is not None:
            cls, _ = _find_enclosing(attr_node, source, ("class_declaration",))
            target_class = cls

        line = attr_node.start_point[0] + 1 if attr_node is not None else 1
        out.append(Annotation(
            file=file_path, line=line,
            target_kind=target_kind,
            target_class=target_class or "?",
            target_method=target_method,
            annotation=name_text,
            args=_parse_args_text(args_text),
        ))
    return out


def _emit_csharp_attr(attr_node, source: bytes, file_path: str,
                      target_kind: str, target_class: str, target_method: str | None,
                      allowed_names: list[str] | None, out: list[Annotation]):
    name_node = attr_node.child_by_field_name("name")
    if not name_node:
        return
    name_text = source[name_node.start_byte:name_node.end_byte].decode()
    short = name_text.rsplit(".", 1)[-1]
    if allowed_names and not any(n in (name_text, short, short + "Attribute") for n in allowed_names):
        return
    args_node = None
    for c in attr_node.children:
        if c.type == "attribute_argument_list":
            args_node = c
            break
    args_text = source[args_node.start_byte:args_node.end_byte].decode() if args_node else ""
    out.append(Annotation(
        file=file_path,
        line=attr_node.start_point[0] + 1,
        target_kind=target_kind,
        target_class=target_class,
        target_method=target_method,
        annotation=name_text,
        args=_parse_args_text(args_text),
    ))


# ---------------------------------------------------------------------------
# Public query class
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# PHP (attributes #[Route] + Doctrine @Route doc-comments)
# ---------------------------------------------------------------------------

def extract_php_annotations(source: bytes, file_path: str,
                             allowed_names: list[str] | None = None) -> list[Annotation]:
    """PHP 8 attributes #[Route(...)] (via php/attributes.scm) + legacy Doctrine
    @Route doc-comments (regex pass)."""
    from src.ast.v2.tree_sitter_runner import run_query, node_text
    out: list[Annotation] = []

    # PHP 8 attributes
    for _pat, caps in run_query("php", "attributes", source):
        attr_node = (caps.get("attr") or [None])[0]
        if attr_node is None:
            continue
        # Extract name + args inside the attribute node
        name_text = ""
        args_text = ""
        for c in attr_node.children:
            if c.type in ("name", "qualified_name"):
                name_text = node_text(c, source)
            elif c.type == "arguments":
                args_text = node_text(c, source)
        short = name_text.rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
        if allowed_names and not any(n in (name_text, short) for n in allowed_names):
            continue

        is_class = bool(caps.get("class"))
        target_kind = "class" if is_class else "method"
        target_class = (caps.get("class.name") and node_text(caps["class.name"][0], source)) or ""
        target_method = None if is_class else (
            (caps.get("method.name") and node_text(caps["method.name"][0], source)) or "?")

        if target_kind == "method" and not target_class:
            cls, _ = _find_enclosing(attr_node, source,
                                      ("class_declaration", "trait_declaration", "interface_declaration"))
            target_class = cls

        out.append(Annotation(
            file=file_path,
            line=attr_node.start_point[0] + 1,
            target_kind=target_kind,
            target_class=target_class or "?",
            target_method=target_method,
            annotation=short or name_text,
            args=_parse_php_attr_args(args_text),
        ))

    # Doc-comment annotations via php/annotations.scm — surfaces every (method,
    # comment) pair so we can pull @Route from the docblock that immediately
    # precedes the method.
    out.extend(_extract_php_doc_annotations(source, file_path, allowed_names))
    return out


def _extract_php_doc_annotations(source: bytes, file_path: str,
                                  allowed_names: list[str] | None) -> list[Annotation]:
    """Parse @Route / @Method doc-comment annotations using php/annotations.scm.

    The .scm exposes (method node, name) and (comment node) captures separately;
    we correlate each method with its immediately-preceding doc-comment in source
    order and pull @-annotations out of that comment.
    """
    import re as _re
    from src.ast.v2.tree_sitter_runner import run_query, node_text

    out: list[Annotation] = []
    methods: list[tuple[int, dict]] = []   # (start_byte, info)
    comments: list[tuple[int, str, int]] = []  # (start_byte, comment_text, line)

    for _pat, caps in run_query("php", "annotations", source):
        method_nodes = caps.get("method") or []
        method_name_nodes = caps.get("method.name") or []
        comment_nodes = caps.get("doc.comment") or []
        for m in method_nodes:
            name = node_text(method_name_nodes[0], source) if method_name_nodes else "?"
            methods.append((m.start_byte, {"node": m, "name": name}))
        for c in comment_nodes:
            txt = node_text(c, source)
            if txt.startswith("/**"):
                comments.append((c.start_byte, txt, c.start_point[0] + 1))

    methods.sort(key=lambda x: x[0])
    comments.sort(key=lambda x: x[0])

    # For each method, pick the latest comment that ends before the method starts.
    for m_start, info in methods:
        chosen: tuple[int, str, int] | None = None
        for c_start, c_text, c_line in comments:
            if c_start < m_start:
                chosen = (c_start, c_text, c_line)
            else:
                break
        if chosen is None:
            continue
        _, comment_text, line_base = chosen
        for ann_m in _re.finditer(r"@(?P<n>Route|Method|ParamConverter)\s*(\([^)]*\))?", comment_text):
            ann_name = ann_m.group("n")
            if allowed_names and ann_name not in allowed_names:
                continue
            args_text = ann_m.group(2) or ""
            line = line_base + comment_text[:ann_m.start()].count("\n")
            out.append(Annotation(
                file=file_path, line=line,
                target_kind="method",
                target_class="?",
                target_method=info["name"],
                annotation=ann_name,
                args=_parse_args_text(args_text),
            ))
    return out


def _emit_from_preceding_doc(*args, **kwargs):
    """Deprecated — replaced by _extract_php_doc_annotations using php/annotations.scm.
    Kept as a no-op to avoid breaking old call sites."""
    return None


def _emit_from_preceding_doc(decl_node, source: bytes, file_path: str,
                              target_kind: str, target_class: str,
                              target_method: str | None,
                              allowed_names: list[str] | None,
                              out: list[Annotation]):
    """If decl_node has a preceding sibling that's a `comment` doc-comment,
    extract @Route/@Method annotations from it."""
    import re as _re
    from src.ast.v2.tree_sitter_runner import node_text
    prev = decl_node.prev_sibling
    while prev is not None and prev.type in ("attribute_list", "modifier"):
        prev = prev.prev_sibling
    if prev is None or prev.type != "comment":
        return
    comment_text = node_text(prev, source)
    if not comment_text.startswith("/**"):
        return
    line_base = prev.start_point[0] + 1
    for ann_m in _re.finditer(r"@(?P<n>Route|Method|ParamConverter)\s*(\([^)]*\))?", comment_text):
        ann_name = ann_m.group("n")
        if allowed_names and ann_name not in allowed_names:
            continue
        args_text = ann_m.group(2) or ""
        line = line_base + comment_text[:ann_m.start()].count("\n")
        out.append(Annotation(
            file=file_path, line=line,
            target_kind=target_kind,
            target_class=target_class,
            target_method=target_method,
            annotation=ann_name,
            args=_parse_args_text(args_text),
        ))


def _emit_php_attr(attr_node, source: bytes, file_path: str,
                   target_kind: str, target_class: str, target_method: str | None,
                   allowed_names: list[str] | None, out: list[Annotation]):
    # PHP attribute: #[Route("/foo", methods: ["GET"])] — the name is in the first child
    name_text = ""
    args_text = ""
    for c in attr_node.children:
        if c.type == "name" or c.type == "qualified_name":
            name_text = source[c.start_byte:c.end_byte].decode("utf-8", "replace")
        elif c.type == "arguments":
            args_text = source[c.start_byte:c.end_byte].decode("utf-8", "replace")
    short = name_text.rsplit("\\", 1)[-1].rsplit("/", 1)[-1]
    if allowed_names and not any(n in (name_text, short) for n in allowed_names):
        return

    args = _parse_php_attr_args(args_text)
    out.append(Annotation(
        file=file_path,
        line=attr_node.start_point[0] + 1,
        target_kind=target_kind,
        target_class=target_class,
        target_method=target_method,
        annotation=short or name_text,
        args=args,
    ))


def _parse_php_attr_args(args_text: str) -> dict:
    """Parse a PHP 8 attribute argument list.
    Handles positional + named args (name: value) + short arrays.
      ('/api/foo', methods: ['GET'])
      (path: '/api/foo', methods: ['GET', 'POST'])
      (defaults: [...])
    """
    import re as _re
    if not args_text:
        return {}
    s = args_text.strip()
    if s.startswith("(") and s.endswith(")"):
        s = s[1:-1].strip()
    if not s:
        return {}

    # Extract path: '<url>' or positional first-arg string literal
    args: dict = {}
    path_m = _re.search(r"""path\s*:\s*(['"])(?P<p>[^'"]+)\1""", s)
    if path_m:
        args["path"] = path_m.group("p")

    # methods: ['GET', 'POST']
    methods_m = _re.search(r"""methods\s*:\s*\[(?P<m>[^\]]*)\]""", s)
    if methods_m:
        methods = _re.findall(r"""['"](\w+)['"]""", methods_m.group("m"))
        args["methods"] = methods

    # First positional argument as path (fallback if no named `path:`)
    if "path" not in args:
        pos_m = _re.match(r"""\s*(['"])(?P<p>[^'"]+)\1""", s)
        if pos_m:
            args["path"] = pos_m.group("p")
            args["value"] = pos_m.group("p")
    return args


# ---------------------------------------------------------------------------
# Ruby (call-args as faux annotations — `get '/users'` treated as a "route" annotation)
# ---------------------------------------------------------------------------

def extract_ruby_annotations(source: bytes, file_path: str,
                              allowed_names: list[str] | None = None) -> list[Annotation]:
    """Ruby routing DSL calls via ruby/call_args.scm. Captures `get '/x'`,
    `post '/y'`, `resources :users`, `root to: 'pages#home'`."""
    from src.ast.v2.tree_sitter_runner import run_query, node_text
    out: list[Annotation] = []
    for _pat, caps in run_query("ruby", "call_args", source):
        name_node = (caps.get("call.name") or [None])[0]
        if name_node is None:
            continue
        fn_name = node_text(name_node, source)
        if allowed_names and fn_name not in allowed_names:
            continue
        call_node = (caps.get("call") or [None])[0]
        args_node = (caps.get("call.args") or [None])[0]
        args: dict = {}
        if args_node is not None:
            args_text = node_text(args_node, source)
            if args_text and not args_text.startswith("("):
                args_text = "(" + args_text + ")"
            args = _parse_args_text(args_text) if args_text else {}
        line = (call_node or name_node).start_point[0] + 1
        out.append(Annotation(
            file=file_path, line=line,
            target_kind="method",
            target_class="",
            target_method=fn_name,
            annotation=fn_name,
            args=args,
        ))
    return out


# ---------------------------------------------------------------------------
# Public query class
# ---------------------------------------------------------------------------

EXTENSION_HANDLERS: dict[str, Callable] = {
    "java": extract_java_annotations,
    "py":   extract_python_decorators,
    "ts":   extract_typescript_decorators,
    "tsx":  extract_typescript_decorators,
    "cs":   extract_csharp_attributes,
    "php":  extract_php_annotations,
    "rb":   extract_ruby_annotations,
}


class AnnotationsQuery:
    """Tree-sitter-backed annotation/decorator extraction."""

    def __init__(self, project_root: str | Path):
        self._root = Path(project_root)

    def in_files(self, files: Iterable[str], allowed_names: list[str] | None = None) -> list[Annotation]:
        out: list[Annotation] = []
        for rel in files:
            ext = Path(rel).suffix.lstrip(".").lower()
            handler = EXTENSION_HANDLERS.get(ext)
            if handler is None:
                continue
            abs_path = self._root / rel
            if not abs_path.exists():
                continue
            try:
                source = abs_path.read_bytes()
            except OSError:
                continue
            try:
                anns = handler(source, rel, allowed_names)
            except Exception as e:
                # Don't let one bad file kill the run
                continue
            out.extend(anns)
        return out
