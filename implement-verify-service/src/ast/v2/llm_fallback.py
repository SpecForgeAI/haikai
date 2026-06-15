"""Lightweight LLM endpoint discovery for Phase 10.

V2's deterministic playbooks may produce zero results when:
  - no playbook matches the framework
  - playbook detection misfires
  - the framework is genuinely unknown

This module runs a much smaller LLM prompt than V1's cli-delegated path so
it fits the proxy's smaller-model context budget. It asks the model to:
  1. Look at top-level dirs + manifests + a few suspect files
  2. Identify the routing pattern
  3. Return a JSON list of {operation, path, file, line} endpoints

Output is mapped into EndpointInfo with framework="llm-fallback".
"""
import json
import re
from pathlib import Path

from src.ast.models import EndpointInfo


DEFAULT_ROUTING_GLOBS = [
    "**/routes.py", "**/urls.py", "**/routes.rb", "**/routes.php",
    "**/api*.go", "**/router*.go", "**/web.php", "**/api.php",
    "**/*.routing.yml", "**/routes/*.json", "**/config/routes/*.yaml",
    "**/routes/web.php", "**/routes/api.php",          # Laravel
    "**/controllers/**/*.php", "**/Controller/**/*.php",
    "**/RouteServiceProvider.php",
    "**/web.xml",
]

EXTRA_ROUTING_GLOBS_FOR_RETRY = [
    "**/*controller*.go", "**/handlers/**/*.go",
    "**/views/**/*.py", "**/api/**/*.py",
    "**/api/**/*.rb", "**/app/controllers/**/*.rb",
    "**/src/**/*Controller.java", "**/src/**/*Resource.java",
    "**/src/**/Controller.ts", "**/src/**/*.controller.ts",
    "**/Resources/config/routing*.yaml",
]


def _evidence_pack(project_root: Path, max_chars: int = 40000,
                    extra_globs: list[str] | None = None,
                    skip_n: int = 0) -> str:
    """Compact evidence about the repo. Optional extra_globs from a playbook
    that detected but produced 0; skip_n lets the caller cycle to a different
    sample of files for retry-on-empty.

    Manifest-content + directory-listing now sourced from the shared
    enrichment_tools so V1 and V2 use the same primitives.
    """
    from src.ast.enrichment_tools import read_manifest_contents, list_directory_names

    lines: list[str] = [f"# Repo: {project_root.name}"]
    lines.append("\n## Top-level dirs:\n" + list_directory_names(str(project_root), depth=1, limit=20))
    manifests = read_manifest_contents(str(project_root), max_chars=600)
    if manifests and not manifests.startswith("(no manifest"):
        lines.append("\n" + manifests)

    routing_globs = list(extra_globs or []) + DEFAULT_ROUTING_GLOBS
    samples: list[str] = []
    for g in routing_globs:
        for p in project_root.glob(g):
            try:
                rel = p.relative_to(project_root).as_posix()
            except ValueError:
                continue
            samples.append(rel)
            if len(samples) >= 15:
                break
        if len(samples) >= 15:
            break
    # Cycle the sample window when retry asks for a different slice
    if skip_n and len(samples) > skip_n:
        samples = samples[skip_n:] + samples[:skip_n]

    if samples:
        lines.append("\n## Routing-suspect files:\n  " + "\n  ".join(samples))

    # Include the contents of the most likely routing files. Strip the leading
    # import block so the budget is spent on real route definitions, not headers.
    per_file_budget = 8000
    file_budget_remaining = max_chars - sum(len(l) for l in lines) - 500
    for rel in samples[:6]:
        if file_budget_remaining < 1500:
            break
        try:
            full = (project_root / rel).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # Skip past the import block (anything before the first non-import statement)
        # Heuristic: find first occurrence of "func ", "class ", "Route::", "router.",
        # "@Controller", "resources ", "path(" etc. and start from a few lines before.
        import re as _re
        m = _re.search(r"(?m)^(func |class |Route::|router\.|app\.|@Controller|resources |path\(|@app\.)", full)
        start = max(0, m.start() - 200) if m else 0
        content = full[start:start + per_file_budget]
        lines.append(f"\n## File: {rel}\n```\n{content}\n```")
        file_budget_remaining -= len(content) + len(rel) + 30

    body = "\n".join(lines)
    if len(body) > max_chars:
        body = body[:max_chars] + "\n... [truncated]"
    return body


SYSTEM_PROMPT = (
    "You are an endpoint extractor. You will receive evidence about ONE codebase: "
    "manifests + the contents of routing files. Extract HTTP endpoints DEFINED IN THE "
    "FILES SHOWN below. Use ONLY paths and verbs you can literally find in those files "
    "(do not guess based on the framework's typical API). "
    "Output ONLY a single JSON array prefixed with FINAL_ANSWER on its own line. "
    'Each element shape: {"operation":"GET","path":"/users","file":"src/x.go","line":12}. '
    "If the evidence doesn't contain enough to enumerate endpoints, output FINAL_ANSWER then []."
)


def _parse_response(response: str) -> list[dict]:
    """Pull the JSON array following FINAL_ANSWER. Returns [] if none."""
    if "FINAL_ANSWER" in response:
        tail = response.split("FINAL_ANSWER", 1)[1]
    else:
        tail = response
    m = re.search(r"\[[\s\S]*\]", tail)
    if not m:
        return []
    try:
        items = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    return items if isinstance(items, list) else []


def discover_endpoints_via_llm(project_root: str, llm_client,
                                evidence_globs: list[str] | None = None,
                                max_attempts: int = 2) -> list[EndpointInfo]:
    """Phase 10 fallback with retry-on-empty.

    Tries up to `max_attempts` LLM calls with a different slice of evidence
    files each time. `evidence_globs` come from a playbook that detected but
    produced 0, so it can hint where to look for routes.
    """
    root = Path(project_root)
    if not root.exists():
        return []

    items: list[dict] = []
    for attempt in range(max_attempts):
        if attempt == 0:
            evidence = _evidence_pack(root, extra_globs=evidence_globs)
        else:
            # Retry: cycle the file window AND broaden globs
            evidence = _evidence_pack(
                root,
                extra_globs=(evidence_globs or []) + EXTRA_ROUTING_GLOBS_FOR_RETRY,
                skip_n=attempt * 6,
            )
        try:
            response = llm_client.generate(
                messages=[{"role": "system", "content": SYSTEM_PROMPT},
                          {"role": "user",   "content": evidence}],
                max_tokens=4000,
            )
        except Exception:
            continue
        items = _parse_response(response)
        if items:
            break

    out: list[EndpointInfo] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        op = str(it.get("operation") or it.get("verb") or it.get("method") or "ANY").upper()
        path = str(it.get("path", "")).strip()
        if not path:
            continue
        out.append(EndpointInfo(
            type="REST",
            path=path,
            operation=op,
            handler_class=str(it.get("handler_class", "")),
            handler_method=str(it.get("handler", it.get("handler_method", ""))),
            file=str(it.get("file", "")),
            line=int(it.get("line", 0) or 0),
            direction="INBOUND",
            protocol="HTTP",
            framework="llm-fallback",
            confidence=0.6,
        ))
    return out
