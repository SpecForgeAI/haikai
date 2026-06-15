"""Run a playbook against a snapshot. Produces EndpointInfo records."""
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from src.ast.models import EndpointInfo
from src.ast.v2.queries.annotations import AnnotationsQuery, Annotation
from src.ast.v2.queries.call_args import CallArgsQuery, Call
from src.ast.v2.queries.configs import ConfigsQuery
from src.ast.v2.queries.files import FilesQuery
from src.ast.v2.queries.imports import ImportsQuery
from src.ast.v2.queries.method_decls import MethodDeclsQuery


# Default extensions per language (used when file_filter: all)
LANGUAGE_EXTENSIONS = {
    "go":         {"go"},
    "javascript": {"js", "jsx", "mjs", "cjs"},
    "typescript": {"ts", "tsx", "js", "jsx"},
    "python":     {"py"},
    "java":       {"java"},
    "ruby":       {"rb"},
    "php":        {"php"},
    "csharp":     {"cs"},
    "cpp":        {"cpp", "hpp", "cc", "h"},
}


@dataclass
class ExecutionResult:
    endpoints: list[EndpointInfo] = field(default_factory=list)
    raw_annotations: list[Annotation] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# NOTE: verb_annotations / path_only_annotations / verb_via_methods_arg
# are now declared per-playbook in YAML (Leaks 1–3). Engine assembles the
# effective rules from the currently-executing playbook at run time.


def execute(playbook: dict[str, Any], snapshot_path: str, project_root: str) -> ExecutionResult:
    """Execute a playbook's extract steps and apply expansion rules."""
    result = ExecutionResult()

    imports_query = ImportsQuery(snapshot_path)
    annotations_query = AnnotationsQuery(project_root)
    call_args_query = CallArgsQuery(project_root)
    configs_query = ConfigsQuery(project_root)
    files_query = FilesQuery(project_root)
    method_decls_query = MethodDeclsQuery(project_root)

    routing_pkgs = playbook.get("detection", {}).get("imports_match", [])
    routing_files = imports_query.files_importing(routing_pkgs)
    result.notes.append(f"Identified {len(routing_files)} routing-framework files via imports")

    # Per-playbook annotation rules (Leaks 1–3 — formerly hardcoded in engine)
    verb_annotations: dict[str, str]    = playbook.get("verb_annotations", {}) or {}
    path_only_annotations: set[str]      = set(playbook.get("path_only_annotations", []) or [])
    verb_via_methods_arg: set[str]       = set(playbook.get("verb_via_methods_arg", []) or [])

    language = playbook.get("language", "")
    lang_exts = LANGUAGE_EXTENSIONS.get(language, set())
    _all_files_cache: list[str] | None = None
    def _files_for_step(step: dict) -> list[str]:
        nonlocal _all_files_cache
        f = step.get("file_filter", "routing_imports")
        if f == "routing_imports":
            return list(routing_files)
        if f == "all":
            if _all_files_cache is None:
                metas = files_query.walk()
                # Normalize: accept both ".ts" and "ts" forms in YAML
                raw_exts = step.get("file_extensions", lang_exts) or set()
                exts = {e.lstrip(".").lower() for e in raw_exts}
                _all_files_cache = [m.path for m in metas if (not exts or m.ext in exts)]
            return _all_files_cache
        return list(routing_files)

    # Collect every requested annotation, partitioned by class vs method
    extract_steps = playbook.get("extract", [])
    method_annotations: list[Annotation] = []
    class_annotations: list[Annotation] = []

    for step in extract_steps:
        if step.get("query") != "annotations":
            continue
        names = step.get("annotation_names", [])
        target_kind = step.get("target_kind")
        target_files = _files_for_step(step)
        anns = annotations_query.in_files(target_files, allowed_names=names)
        if target_kind:
            anns = [a for a in anns if a.target_kind == target_kind]
        if target_kind == "method":
            method_annotations.extend(anns)
        elif target_kind == "class":
            class_annotations.extend(anns)

    result.raw_annotations = method_annotations + class_annotations

    # Class prefix from the LAST path-bearing class annotation per (file, class)
    class_prefix: dict[tuple[str, str], str] = {}
    for c in class_annotations:
        if c.annotation in path_only_annotations:
            # @Controller('users') — first positional arg or value/path key
            prefix = (c.args.get("value", "")
                      or c.args.get("path", "")
                      or c.args.get("0", "") or "")
            if prefix:
                class_prefix[(c.file, c.target_class)] = prefix

    emit = playbook.get("emit", {})

    # Group method annotations by (file, class, method) so we can combine
    # verb + path annotations on the same method (JAX-RS pattern)
    grouped: dict[tuple[str, str, str | None], list[Annotation]] = {}
    for m in method_annotations:
        key = (m.file, m.target_class, m.target_method)
        grouped.setdefault(key, []).append(m)

    for (file, cls, method), anns in grouped.items():
        # Find HTTP verb(s) — either from a verb annotation, or from
        # the `method=`/`methods=` argument of an annotation listed in
        # verb_via_methods_arg.
        verbs: list[str] = []
        method_path: str = ""
        deferred_methods_arg_ann: Annotation | None = None

        for a in anns:
            if a.annotation in verb_annotations:
                verbs.append(verb_annotations[a.annotation])
                # Single-annotation form: path lives here too
                p = a.args.get("value", "") or a.args.get("path", "") or ""
                if p and not method_path:
                    method_path = p
            elif a.annotation in path_only_annotations:
                p = a.args.get("value", "") or a.args.get("path", "") or ""
                if p:
                    method_path = p
                if a.annotation in verb_via_methods_arg:
                    deferred_methods_arg_ann = a

        if deferred_methods_arg_ann is not None and not verbs:
            method_arg = (deferred_methods_arg_ann.args.get("method", "")
                          or deferred_methods_arg_ann.args.get("methods", ""))
            if method_arg:
                if isinstance(method_arg, list):
                    for v in method_arg:
                        verbs.append(_normalize_verb(v))
                else:
                    verbs.append(_normalize_verb(method_arg))
            if not method_path:
                method_path = (deferred_methods_arg_ann.args.get("value", "")
                               or deferred_methods_arg_ann.args.get("path", "")
                               or "")
            if not verbs:
                verbs.append("DYNAMIC")

        if not verbs:
            continue  # method has only a path-only annotation → sub-resource locator

        prefix = class_prefix.get((file, cls), "")
        method_paths = method_path if isinstance(method_path, list) else [method_path]
        full_paths = [_join_paths(str(prefix), str(mp)) for mp in method_paths]

        # Use the line of the first verb annotation for traceability
        line = next((a.line for a in anns if a.annotation in verb_annotations), anns[0].line)

        for verb in verbs:
            for full_path in full_paths:
                result.endpoints.append(EndpointInfo(
                    type=emit.get("type", "REST"),
                    path=full_path,
                    operation=str(verb),
                    handler_class=cls,
                    handler_method=method or "",
                    file=file,
                    line=line,
                    direction="INBOUND",
                    protocol=emit.get("protocol", "HTTP"),
                    framework=emit.get("framework", playbook.get("name", "")),
                    confidence=0.95,
                ))

    # ----- call_args extract steps (Express/Gin/Slim/Oatpp/...) -----
    for step in extract_steps:
        if step.get("query") != "call_args":
            continue
        callee_pattern = step.get("callee_pattern", "")
        if not callee_pattern:
            continue
        path_idx = step.get("path_arg_index", 0)
        verb_from = step.get("verb_from", "callee_suffix")
        explicit_verb = step.get("verb")
        try:
            verb_capture = re.compile(callee_pattern)
        except re.error as e:
            result.notes.append(f"call_args: invalid callee_pattern {callee_pattern!r}: {e}")
            continue

        target_files = _files_for_step(step)
        calls = call_args_query.in_files(target_files, callee_pattern)
        result.notes.append(f"call_args step matched {len(calls)} calls in {len(target_files)} files (pattern={callee_pattern})")

        path_must_match = step.get("path_must_match")
        try:
            path_re = re.compile(path_must_match) if path_must_match else None
        except re.error as e:
            result.notes.append(f"call_args: invalid path_must_match {path_must_match!r}: {e}")
            continue

        for c in calls:
            if path_idx >= len(c.string_args):
                continue
            path = c.string_args[path_idx]
            if path_re and not path_re.match(path):
                continue

            verb = explicit_verb
            if not verb and verb_from == "callee_suffix":
                m = verb_capture.search(c.callee)
                if m and m.groups():
                    verb = m.group(m.lastindex).upper()
                else:
                    tail = c.callee.rsplit(".", 1)[-1].rsplit("->", 1)[-1].rsplit("::", 1)[-1]
                    verb = tail.upper()

            if not verb:
                continue

            result.endpoints.append(EndpointInfo(
                type=emit.get("type", "REST"),
                path=path or "/",
                operation=verb,
                handler_class="",
                handler_method=c.handler_ref,
                file=c.file,
                line=c.line,
                direction="INBOUND",
                protocol=emit.get("protocol", "HTTP"),
                framework=emit.get("framework", playbook.get("name", "")),
                confidence=0.9,
            ))

    # ----- method_decls extract steps (Yii2 actionXxx, Stapler doXxx, etc.) -----
    for step in extract_steps:
        if step.get("query") != "method_decls":
            continue
        name_pattern = step.get("name_pattern", "")
        if not name_pattern:
            continue
        verb_default = step.get("verb", "ANY")
        path_from = step.get("path_from", "method_name_strip")
        strip_prefix = step.get("strip_prefix", "")
        class_pattern = step.get("class_pattern", "")
        target_files = _files_for_step(step)
        decls = method_decls_query.in_files(target_files, name_pattern)
        if class_pattern:
            try:
                class_re = re.compile(class_pattern)
            except re.error as e:
                result.notes.append(f"method_decls: invalid class_pattern {class_pattern!r}: {e}")
                continue
            decls = [d for d in decls if class_re.match(d.cls or "")]
        result.notes.append(
            f"method_decls matched {len(decls)} methods "
            f"(pattern={name_pattern}, class_pattern={class_pattern or 'any'})"
        )
        import re as _re
        def _camel_to_kebab(s: str) -> str:
            s = _re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()
            return s.replace("_", "-")
        for d in decls:
            if path_from == "class_name_strip":
                # Path from enclosing class (e.g. ApiQuery → /api/query)
                cls_name = d.cls or ""
                if strip_prefix and cls_name.startswith(strip_prefix):
                    cls_name = cls_name[len(strip_prefix):]
                # Drop trailing common suffixes
                for suf in ("Controller", "Action", "Resource"):
                    if cls_name.endswith(suf):
                        cls_name = cls_name[: -len(suf)]
                        break
                kebab = _camel_to_kebab(cls_name) if cls_name else ""
                path = "/" + kebab if kebab else "/"
            elif path_from == "method_name_strip":
                p = d.method
                if strip_prefix and p.startswith(strip_prefix):
                    p = p[len(strip_prefix):]
                p = _re.sub(r"(?<!^)(?=[A-Z])", "_", p).lower()
                path = "/" + p
            else:
                path = "/" + d.method
            result.endpoints.append(EndpointInfo(
                type=emit.get("type", "REST"),
                path=path,
                operation=verb_default,
                handler_class=d.cls,
                handler_method=d.method,
                file=d.file,
                line=d.line,
                direction="INBOUND",
                protocol=emit.get("protocol", "HTTP"),
                framework=emit.get("framework", playbook.get("name", "")),
                confidence=0.7,
            ))

    # ----- files extract steps (page-based PHP, "filesystem IS the routes") -----
    for step in extract_steps:
        if step.get("query") != "files":
            continue
        glob_pat = step.get("file_glob", "**/*")
        verb_default = step.get("verb", "ANY")
        strip_suffix = step.get("strip_suffix", "")
        root_strip = step.get("root_strip", "")
        exclude_globs = step.get("exclude_globs", []) or []

        import glob as _glob
        import fnmatch as _fnm
        root_path = Path(project_root)
        matches = _glob.glob(str(root_path / glob_pat), recursive=True)
        rels = [str(Path(p).relative_to(root_path)).replace("\\", "/")
                for p in matches if Path(p).is_file()]
        if exclude_globs:
            kept: list[str] = []
            for rel in rels:
                if not any(_fnm.fnmatch(rel, ex) for ex in exclude_globs):
                    kept.append(rel)
            rels = kept
        result.notes.append(f"files step matched {len(rels)} files (glob={glob_pat})")

        for rel in rels:
            url = "/" + rel
            if root_strip:
                # Drop the root_strip prefix from the URL ("htdocs/admin/x.php" → "/admin/x.php")
                marker = "/" + root_strip.strip("/") + "/"
                if marker in url:
                    url = url[url.index(marker) + len(marker) - 1:]
            if strip_suffix and url.endswith(strip_suffix):
                url = url[: -len(strip_suffix)]
            result.endpoints.append(EndpointInfo(
                type=emit.get("type", "REST"),
                path=url,
                operation=str(verb_default),
                handler_class="",
                handler_method=Path(rel).stem,
                file=rel,
                line=1,
                direction="INBOUND",
                protocol=emit.get("protocol", "HTTP"),
                framework=emit.get("framework", playbook.get("name", "")),
                confidence=0.6,
            ))

    # ----- configs extract steps (Rails routes.rb / Django urls.py / Symfony YAML) -----
    for step in extract_steps:
        if step.get("query") != "configs":
            continue
        parser = step.get("parser", "")
        if not parser:
            continue
        glob_pat = step.get("file_glob", "**/*")
        import glob as _glob
        root = Path(project_root)
        matches = _glob.glob(str(root / glob_pat), recursive=True)
        cfg_files = [str(Path(p).relative_to(root)).replace("\\", "/")
                     for p in matches if Path(p).is_file()]
        result.notes.append(f"configs[{parser}] scanning {len(cfg_files)} files (glob={glob_pat})")
        entries = configs_query.in_files(cfg_files, parser)
        result.notes.append(f"configs[{parser}] yielded {len(entries)} routes")

        for r in entries:
            handler_class, _, handler_method = r.handler.partition("#")
            if not handler_method:
                handler_class, _, handler_method = r.handler.rpartition(".")
                if not handler_class:
                    handler_class = ""
            result.endpoints.append(EndpointInfo(
                type=emit.get("type", "REST"),
                path=r.path or "/",
                operation=r.operation,
                handler_class=handler_class,
                handler_method=handler_method,
                file=r.file,
                line=r.line,
                direction="INBOUND",
                protocol=emit.get("protocol", "HTTP"),
                framework=emit.get("framework", r.framework or playbook.get("name", "")),
                confidence=0.9,
            ))

    return result


def _normalize_verb(v) -> str:
    """Normalize a verb token: 'RequestMethod.GET' -> 'GET'."""
    if isinstance(v, str):
        return v.rsplit(".", 1)[-1].upper()
    return "DYNAMIC"


def _join_paths(prefix: str, suffix: str) -> str:
    if not prefix:
        return suffix or "/"
    if not suffix:
        return prefix
    if not prefix.startswith("/"):
        prefix = "/" + prefix
    if suffix.startswith("/"):
        suffix = suffix[1:]
    if prefix.endswith("/"):
        return prefix + suffix
    return prefix + "/" + suffix
