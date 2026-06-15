"""OpenAPI / Swagger spec discovery + parsing.

Generic — agnostic of which framework produced the spec. Used by:
  - V2 playbook configs parser (parse_openapi_spec)
  - The openapi-driven stack
  - Optional V1 LLM tool (get_openapi_spec / get_openapi_endpoints)

Detection is content-based: a top-level `openapi:` (3.x) or `swagger:` (2.0)
key is the only reliable signal. Filename and path are secondary hints used
for ranking when multiple specs exist in a repo.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# ─── Detection ─────────────────────────────────────────────────────────────

# Top-level version-key sniff — matches both YAML and JSON forms.
# The version digit at the end ([34] or [2]) keeps us from matching
# spec FRAGMENTS that mention `openapi: true` as a config flag.
_OAS_SNIFF = re.compile(
    rb'(^|\n)\s*("openapi"\s*:\s*"[34]'
    rb'|"swagger"\s*:\s*"2'
    rb'|openapi:\s*[\'"]?[34]'
    rb'|swagger:\s*[\'"]?2)'
)

_EXCLUDE_PATH_FRAGMENTS = (
    "/examples/", "/example/", "/fixtures/", "/fixture/",
    "/tests/", "/test/", "/__tests__/", "/__mocks__/",
    "/node_modules/", "/vendor/",
    "/dist/", "/build/", "/target/",
    "/.git/", "/.idea/", "/.vscode/",
)

_SPEC_EXTS = (".yaml", ".yml", ".json")


def is_openapi_spec(path: Path) -> bool:
    """True if `path` is (with high confidence) an OpenAPI/Swagger spec.

    Cheap: extension + path-fragment exclusion + 2 KB content sniff.
    """
    p = str(path).lower().replace("\\", "/")
    if any(x in p for x in _EXCLUDE_PATH_FRAGMENTS):
        return False
    if path.suffix.lower() not in _SPEC_EXTS:
        return False
    try:
        head = path.read_bytes()[:2048]
    except OSError:
        return False
    return bool(_OAS_SNIFF.search(head))


def find_openapi_specs(project_root: str | Path) -> list[Path]:
    """Walk `project_root` and return every spec file we find.

    Order is undefined here — caller picks canonical via `_pick_canonical`.
    """
    root = Path(project_root)
    if not root.exists():
        return []
    out: list[Path] = []
    for p in root.rglob("*"):
        if p.is_file() and is_openapi_spec(p):
            out.append(p)
    return out


def _pick_canonical(specs: list[Path], project_root: Path) -> Path | None:
    """Pick the most-likely canonical spec when multiple exist.

    Priority:
      1. Manifest-referenced — the project's package.json / composer.json /
         pom.xml mentions this filename.
      2. Largest file — bundled specs are bigger than per-resource fragments.
      3. Most recently modified.
    """
    if not specs:
        return None
    if len(specs) == 1:
        return specs[0]

    manifest_text = ""
    for n in ("package.json", "composer.json", "pom.xml",
              "Gemfile", "go.mod", "pyproject.toml"):
        p = project_root / n
        if p.exists():
            try:
                manifest_text += p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass

    def score(p: Path) -> tuple[int, int, float]:
        """Higher tuple wins."""
        manifest_hit = 1 if p.name in manifest_text else 0
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        try:
            mtime = p.stat().st_mtime
        except OSError:
            mtime = 0
        return (manifest_hit, size, mtime)

    return max(specs, key=score)


# ─── Loading ───────────────────────────────────────────────────────────────

def load_spec(path: Path) -> dict[str, Any] | None:
    """Parse a YAML or JSON spec file. Returns the dict or None on error."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    try:
        if path.suffix.lower() == ".json":
            return json.loads(text)
        import yaml
        return yaml.safe_load(text)
    except Exception:
        return None


def get_openapi_spec(project_root: str | Path) -> dict[str, Any] | None:
    """Find the canonical OpenAPI spec for a repo and return its parsed dict.

    Returns None when no spec is found.
    """
    root = Path(project_root)
    specs = find_openapi_specs(root)
    chosen = _pick_canonical(specs, root)
    if chosen is None:
        return None
    return load_spec(chosen)


# ─── Endpoint extraction ─────────────────────────────────────────────────

OAS_VERBS = ("get", "post", "put", "delete", "patch", "head", "options", "trace")


def extract_endpoints_from_spec(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Walk a parsed OpenAPI/Swagger dict and return one entry per (verb, path).

    Each entry: {operation, path, handler, tags, framework}.
    Carries through `operationId` as `handler` when present.
    Applies basePath (Swagger 2.0) or first server URL (OpenAPI 3.x) prefix.
    """
    if not isinstance(spec, dict):
        return []
    base = _spec_base_path(spec)
    paths = spec.get("paths") or {}
    if not isinstance(paths, dict):
        return []

    out: list[dict[str, Any]] = []
    for raw_path, item in paths.items():
        if not isinstance(item, dict):
            continue
        full_path = _join(base, str(raw_path))
        for verb in OAS_VERBS:
            op = item.get(verb)
            if not isinstance(op, dict):
                continue
            out.append({
                "operation": verb.upper(),
                "path": full_path,
                "handler": op.get("operationId", "") or "",
                "tags": list(op.get("tags") or []),
                "framework": "openapi",
            })
    return out


def get_openapi_endpoints(project_root: str | Path) -> list[dict[str, Any]]:
    """Convenience: get_openapi_spec → extract_endpoints_from_spec."""
    spec = get_openapi_spec(project_root)
    if spec is None:
        return []
    return extract_endpoints_from_spec(spec)


# ─── helpers ───────────────────────────────────────────────────────────────

def _spec_base_path(spec: dict) -> str:
    """Swagger 2.0 has top-level `basePath`; OpenAPI 3.x has `servers[0].url`
    which may include a path component."""
    bp = spec.get("basePath")
    if isinstance(bp, str) and bp:
        return bp.rstrip("/")
    servers = spec.get("servers")
    if isinstance(servers, list) and servers:
        first = servers[0]
        if isinstance(first, dict):
            url = first.get("url", "")
            if isinstance(url, str) and url:
                # Pull off the path portion (strip scheme + host)
                m = re.match(r"^(?:https?://[^/]+)?(/.+)?$", url)
                if m and m.group(1):
                    return m.group(1).rstrip("/")
    return ""


def _join(prefix: str, path: str) -> str:
    if not prefix:
        return path if path.startswith("/") else "/" + path
    if not path.startswith("/"):
        path = "/" + path
    return prefix + path
