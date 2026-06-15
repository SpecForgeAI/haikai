"""Parse routing config files: Rails routes.rb, Django urls.py, Symfony YAML.

Each parser returns RouteEntry records with path/verb/handler. Path-prefix
resolution (namespace/scope/include) is handled per-parser.
"""
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


@dataclass
class RouteEntry:
    file: str
    line: int
    path: str
    operation: str          # "GET", "POST", ..., or "ANY"
    handler: str = ""       # "controller#action" / "module.view" / "App\\X::y"
    framework: str = ""


# ---------------------------------------------------------------------------
# Rails: config/routes.rb (DSL)
# ---------------------------------------------------------------------------

_RAILS_VERB_RE = re.compile(
    r"^\s*(?P<verb>get|post|put|delete|patch|match)\s+(?P<args>.+)$"
)
_RAILS_RESOURCES_RE = re.compile(
    r"^\s*(?P<kind>resources?)\s+:(?P<name>\w+)"
)
_RAILS_NAMESPACE_RE = re.compile(
    r"^\s*(?P<kw>namespace|scope)\s+:?\"?(?P<name>[A-Za-z0-9_/-]+)\"?"
)
_RAILS_BLOCK_END_RE = re.compile(r"^\s*end\s*$")
_RAILS_ROOT_RE = re.compile(
    r"^\s*root\s+(to:\s*)?[\"'](?P<handler>[^\"']+)[\"']"
)

# Resource → standard 7 actions (Rails default)
_RESOURCES_ACTIONS = [
    ("GET",    "/{name}",              "index"),
    ("GET",    "/{name}/new",          "new"),
    ("POST",   "/{name}",              "create"),
    ("GET",    "/{name}/:id",          "show"),
    ("GET",    "/{name}/:id/edit",     "edit"),
    ("PUT",    "/{name}/:id",          "update"),
    ("PATCH",  "/{name}/:id",          "update"),
    ("DELETE", "/{name}/:id",          "destroy"),
]
_RESOURCE_ACTIONS_SINGULAR = [
    ("GET",    "/{name}/new",          "new"),
    ("POST",   "/{name}",              "create"),
    ("GET",    "/{name}",              "show"),
    ("GET",    "/{name}/edit",         "edit"),
    ("PUT",    "/{name}",              "update"),
    ("PATCH",  "/{name}",              "update"),
    ("DELETE", "/{name}",              "destroy"),
]


def parse_rails_routes(file_path: Path, source: str) -> list[RouteEntry]:
    """Parse a single Rails routes.rb file. Handles namespace/scope/resources."""
    out: list[RouteEntry] = []
    prefix_stack: list[str] = []

    for i, raw in enumerate(source.splitlines(), start=1):
        line = raw.split("#", 1)[0]  # strip ruby comments

        if _RAILS_BLOCK_END_RE.match(line):
            if prefix_stack:
                prefix_stack.pop()
            continue

        m = _RAILS_NAMESPACE_RE.match(line)
        if m and " do" in line:
            prefix_stack.append(m.group("name").strip("/"))
            continue

        m = _RAILS_VERB_RE.match(line)
        if m:
            verb = m.group("verb").upper()
            args = m.group("args")
            path_match = re.search(r"[\"'](?P<p>[^\"']+)[\"']", args)
            if not path_match:
                continue
            path = path_match.group("p")
            handler_match = re.search(r"to:\s*[\"'](?P<h>[^\"']+)[\"']", args)
            handler = handler_match.group("h") if handler_match else ""
            full_path = _join_with_prefix(prefix_stack, path)
            if verb == "MATCH":
                # match supports via:; default to ANY
                via = re.search(r"via:\s*\[?:?\"?(\w+)", args)
                verb = via.group(1).upper() if via else "ANY"
            out.append(RouteEntry(
                file=str(file_path), line=i,
                path=full_path, operation=verb, handler=handler,
                framework="rails",
            ))
            continue

        m = _RAILS_RESOURCES_RE.match(line)
        if m:
            name = m.group("name")
            singular = m.group("kind") == "resource"
            actions = _RESOURCE_ACTIONS_SINGULAR if singular else _RESOURCES_ACTIONS

            # Honor `only: [:index, :show]` / `except: [:destroy]` / `only: :show`
            only_m = re.search(r"only:\s*(?:\[([^\]]*)\]|:(\w+))", line)
            except_m = re.search(r"except:\s*(?:\[([^\]]*)\]|:(\w+))", line)
            only_set: set[str] | None = None
            except_set: set[str] = set()
            if only_m:
                raw = only_m.group(1) or only_m.group(2) or ""
                only_set = {s.strip().strip(":") for s in raw.split(",") if s.strip()}
            if except_m:
                raw = except_m.group(1) or except_m.group(2) or ""
                except_set = {s.strip().strip(":") for s in raw.split(",") if s.strip()}

            for verb, tpl, action in actions:
                if only_set is not None and action not in only_set:
                    continue
                if action in except_set:
                    continue
                p = tpl.format(name=name)
                full_path = _join_with_prefix(prefix_stack, p)
                out.append(RouteEntry(
                    file=str(file_path), line=i,
                    path=full_path, operation=verb,
                    handler=f"{name}#{action}",
                    framework="rails",
                ))
            continue

        m = _RAILS_ROOT_RE.match(line)
        if m:
            full_path = _join_with_prefix(prefix_stack, "/")
            out.append(RouteEntry(
                file=str(file_path), line=i,
                path=full_path, operation="GET",
                handler=m.group("handler"),
                framework="rails",
            ))

    return out


# ---------------------------------------------------------------------------
# Django: urls.py (path / re_path / url calls)
# ---------------------------------------------------------------------------

_DJANGO_PATH_RE = re.compile(
    r"\b(?P<fn>path|re_path|url)\s*\(\s*[r]?[\"'](?P<route>[^\"']*)[\"']\s*,\s*(?P<rest>[^)]*)\)"
)
_DJANGO_INCLUDE_RE = re.compile(r"include\s*\(\s*[\"'](?P<mod>[^\"']+)[\"']")


def parse_django_urls(file_path: Path, source: str,
                      project_root: Path | None = None,
                      _seen: set[str] | None = None,
                      _prefix: str = "",
                      _depth: int = 0) -> list[RouteEntry]:
    """Parse a Django urls.py for path() / re_path() / url() calls.

    Recursively follows include('mod.urls') calls when project_root is given.
    """
    if _seen is None:
        _seen = set()
    file_key = str(file_path).replace("\\", "/")
    if file_key in _seen or _depth > 6:
        return []
    _seen.add(file_key)

    out: list[RouteEntry] = []
    for i, raw in enumerate(source.splitlines(), start=1):
        line = raw.split("#", 1)[0]
        for m in _DJANGO_PATH_RE.finditer(line):
            route = m.group("route")
            rest = m.group("rest")
            inc = _DJANGO_INCLUDE_RE.search(rest)
            if inc:
                # Recurse into the included module's urls.py
                if project_root is not None:
                    mod = inc.group("mod")
                    # Reject malformed module paths that would escape project_root
                    # after the . → / replacement. Specifically: leading/trailing
                    # dots and consecutive dots both produce empty segments which
                    # Path treats as absolute or as `..` traversal on POSIX.
                    if (not mod
                            or mod.startswith(".")
                            or mod.endswith(".")
                            or ".." in mod
                            or "/" in mod
                            or "\\" in mod):
                        continue
                    rel = mod.replace(".", "/") + ".py"
                    candidates = [project_root / rel]
                    if not rel.endswith("urls.py"):
                        candidates.append(project_root / mod.replace(".", "/") / "urls.py")
                    # Defense in depth: drop any candidate that resolves outside
                    # project_root (handles edge cases the string check missed).
                    try:
                        proj_resolved = Path(project_root).resolve()
                    except OSError:
                        proj_resolved = None
                    for cand in candidates:
                        if proj_resolved is not None:
                            try:
                                cand.resolve().relative_to(proj_resolved)
                            except (ValueError, OSError):
                                continue
                        if cand.exists():
                            try:
                                sub_source = cand.read_text(encoding="utf-8", errors="replace")
                            except OSError:
                                continue
                            child_prefix = (_prefix + "/" + route.strip("/")).replace("//", "/")
                            out.extend(parse_django_urls(
                                cand, sub_source,
                                project_root=project_root,
                                _seen=_seen,
                                _prefix=child_prefix.rstrip("/"),
                                _depth=_depth + 1,
                            ))
                            break
                continue
            handler = ""
            handler_match = re.search(r"^\s*([A-Za-z_][\w.]*)", rest)
            if handler_match:
                handler = handler_match.group(1)
            full = (_prefix.rstrip("/") + "/" + route.lstrip("/")).replace("//", "/")
            if not full.startswith("/"):
                full = "/" + full
            out.append(RouteEntry(
                file=str(file_path), line=i,
                path=full,
                operation="ANY",
                handler=handler,
                framework="django",
            ))
    return out


# ---------------------------------------------------------------------------
# Symfony: routes/*.yaml (route_name: { path: ..., methods: [...] })
# ---------------------------------------------------------------------------

def parse_symfony_yaml(file_path: Path, source: str) -> list[RouteEntry]:
    """Parse Symfony YAML routes. Each top-level key with a `path:` is a route."""
    try:
        import yaml
    except ImportError:
        return []
    try:
        data = yaml.safe_load(source) or {}
    except yaml.YAMLError:
        return []
    if not isinstance(data, dict):
        return []
    out: list[RouteEntry] = []
    for name, body in data.items():
        if not isinstance(body, dict):
            continue
        path = body.get("path", "") or body.get("pattern", "")
        if not path:
            continue
        controller = (body.get("controller", "")
                      or body.get("defaults", {}).get("_controller", "")
                      if isinstance(body.get("defaults"), dict) else
                      body.get("controller", ""))
        methods = body.get("methods") or ["ANY"]
        if isinstance(methods, str):
            methods = [methods]
        for verb in methods:
            out.append(RouteEntry(
                file=str(file_path), line=1,
                path=path, operation=str(verb).upper(),
                handler=str(controller),
                framework="symfony",
            ))
    return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _join_with_prefix(prefix_stack: list[str], path: str) -> str:
    parts = [p.strip("/") for p in prefix_stack if p]
    suffix = path.strip()
    if suffix == "/":
        return "/" + "/".join(parts) if parts else "/"
    suffix = suffix.lstrip("/")
    full = "/".join(parts + [suffix]) if parts else suffix
    return "/" + full


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_drupal_routing_yml(file_path: Path, source: str) -> list[RouteEntry]:
    """Drupal 8+ routing.yml: each top-level key with a `path:` is a route."""
    try:
        import yaml
    except ImportError:
        return []
    try:
        data = yaml.safe_load(source) or {}
    except yaml.YAMLError:
        return []
    if not isinstance(data, dict):
        return []
    out: list[RouteEntry] = []
    for name, body in data.items():
        if not isinstance(body, dict):
            continue
        path = body.get("path", "")
        if not path:
            continue
        defaults = body.get("defaults", {}) if isinstance(body.get("defaults"), dict) else {}
        controller = (defaults.get("_controller", "")
                      or defaults.get("_form", "")
                      or defaults.get("_entity_form", "")
                      or "")
        methods = (body.get("methods")
                   or body.get("requirements", {}).get("_method", "")
                   if isinstance(body.get("requirements"), dict) else None) or ["ANY"]
        if isinstance(methods, str):
            methods = [m.strip() for m in methods.split("|")]
        for verb in methods:
            out.append(RouteEntry(
                file=str(file_path), line=1,
                path=path, operation=str(verb).upper(),
                handler=str(controller),
                framework="drupal",
            ))
    return out


def parse_web_xml(file_path: Path, source: str) -> list[RouteEntry]:
    """Java web.xml: <servlet-mapping><servlet-name>...</servlet-name>
       <url-pattern>...</url-pattern></servlet-mapping>."""
    import xml.etree.ElementTree as ET
    try:
        # Strip XML namespaces AND attributes that depend on them (xsi:* etc.)
        cleaned = re.sub(r'\sxmlns(:\w+)?="[^"]+"', '', source)
        cleaned = re.sub(r'\s\w+:\w+="[^"]*"', '', cleaned)  # strip any ns-prefixed attrs
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return []

    # Map servlet-name → servlet-class
    servlet_classes: dict[str, str] = {}
    for s in root.iter("servlet"):
        name_el = s.find("servlet-name")
        cls_el = s.find("servlet-class")
        if name_el is not None and cls_el is not None and name_el.text and cls_el.text:
            servlet_classes[name_el.text.strip()] = cls_el.text.strip()

    out: list[RouteEntry] = []
    for sm in root.iter("servlet-mapping"):
        name_el = sm.find("servlet-name")
        pat_el = sm.find("url-pattern")
        if name_el is None or pat_el is None or not pat_el.text:
            continue
        pattern = pat_el.text.strip()
        name = name_el.text.strip() if name_el.text else ""
        out.append(RouteEntry(
            file=str(file_path), line=1,
            path=pattern, operation="ANY",
            handler=servlet_classes.get(name, name),
            framework="jee-servlet",
        ))

    # Spring <mvc:*/> or <bean class="...Controller"> — we only handle servlet-mapping here.
    return out


def parse_spring_xml(file_path: Path, source: str) -> list[RouteEntry]:
    """Legacy Spring XML: <bean class="...Controller"> + <prop key="/path">beanName</prop>
    style URL mappings (SimpleUrlHandlerMapping)."""
    import xml.etree.ElementTree as ET
    try:
        cleaned = re.sub(r'\sxmlns(:\w+)?="[^"]+"', '', source)
        root = ET.fromstring(cleaned)
    except ET.ParseError:
        return []
    out: list[RouteEntry] = []
    # Properties-style: <prop key="/path">bean</prop>
    for prop in root.iter("prop"):
        key = prop.attrib.get("key", "")
        if key.startswith("/"):
            handler = prop.text.strip() if prop.text else ""
            out.append(RouteEntry(
                file=str(file_path), line=1,
                path=key, operation="ANY",
                handler=handler,
                framework="spring-xml",
            ))
    return out


def parse_strapi_routes_json(file_path: Path, source: str) -> list[RouteEntry]:
    """Strapi v4 routes/*.json: { 'routes': [{method, path, handler, ...}, ...] }."""
    import json as _json
    try:
        data = _json.loads(source)
    except _json.JSONDecodeError:
        return []
    routes = data.get("routes") if isinstance(data, dict) else None
    if not isinstance(routes, list):
        return []
    out: list[RouteEntry] = []
    for r in routes:
        if not isinstance(r, dict):
            continue
        path = r.get("path", "")
        method = r.get("method", "ANY")
        handler = r.get("handler", "")
        if path:
            out.append(RouteEntry(
                file=str(file_path), line=1,
                path=str(path), operation=str(method).upper(),
                handler=str(handler),
                framework="strapi",
            ))
    return out


def parse_openapi_spec(file_path: Path, source: str) -> list[RouteEntry]:
    """OpenAPI 3.x or Swagger 2.0 spec file — emit one route per (verb, path).

    Delegates content-sniff + parsing to src.dep.openapi so the same logic
    backs both this configs parser and the openapi tool/skill.
    """
    from src.dep.openapi import is_openapi_spec, load_spec, extract_endpoints_from_spec
    if not is_openapi_spec(file_path):
        return []
    spec = load_spec(file_path)
    if not spec:
        return []
    out: list[RouteEntry] = []
    for ep in extract_endpoints_from_spec(spec):
        out.append(RouteEntry(
            file=str(file_path),
            line=1,
            path=ep["path"],
            operation=ep["operation"],
            handler=ep["handler"],
            framework="openapi",
        ))
    return out


PARSERS = {
    "rails_dsl":         parse_rails_routes,
    "django_urls":       parse_django_urls,
    "symfony_yaml":      parse_symfony_yaml,
    "drupal_routing_yml": parse_drupal_routing_yml,
    "strapi_routes_json": parse_strapi_routes_json,
    "web_xml":           parse_web_xml,
    "spring_xml":        parse_spring_xml,
    "openapi_spec":      parse_openapi_spec,
}


class ConfigsQuery:
    """Parse routing config files using a named parser."""

    def __init__(self, project_root: str | Path):
        self._root = Path(project_root)

    def in_files(self, files: Iterable[str], parser: str) -> list[RouteEntry]:
        fn = PARSERS.get(parser)
        if fn is None:
            return []
        out: list[RouteEntry] = []
        _seen: set[str] = set()  # dedupe recursion across multiple entry urls.py files
        for rel in files:
            abs_path = self._root / rel
            if not abs_path.exists():
                continue
            try:
                source = abs_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            try:
                if parser == "django_urls":
                    out.extend(fn(abs_path, source,
                                  project_root=self._root, _seen=_seen))
                else:
                    out.extend(fn(abs_path, source))
            except Exception:
                continue
        return out
