"""Phase 11: ask an LLM to author a playbook proposal for a repo.

Given a project root, the writer:
1. Builds a brief evidence pack (manifest snippets, top-level dirs, sample
   routing-looking filenames) so the LLM can see *what kind* of repo it is
   without re-walking thousands of files.
2. Sends the schema-with-examples + the evidence pack to the LLM.
3. Parses the response, schema-validates, writes to playbooks/proposed/.
4. Returns the proposed playbook dict + the file path.

The proposed playbook is NEVER auto-promoted — a human reviews and moves
playbooks/proposed/<name>.yaml → playbooks/frameworks/<name>.yaml.
"""
import json
import re
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


# Anchor to the repo root (4 parents up from src/ast/v2/playbook_writer.py)
# instead of being CWD-relative — proposals would otherwise land in random
# directories depending on where the process was launched from.
PROPOSED_DIR = Path(__file__).resolve().parent.parent.parent.parent / "playbooks" / "proposed"


SCHEMA_DOC = textwrap.dedent("""
    A V2 playbook is a YAML file with these top-level keys:

    name:        # short framework slug, e.g. "laravel"
    version:     # integer, start at 1
    language:    # one of: java, ruby, python, php, go, javascript, typescript, csharp, cpp

    detection:                         # how to know the framework is in use
      imports_match: [list of strings] # any source file imports any of these substrings
      files_match:   [list of globs]   # any matching file exists in the repo
      manifest_contains:               # OR a manifest file contains a substring
        - {file: "composer.json", substring: "laravel/framework"}

    extract:                  # ordered list of extraction steps
      - id: <step-name>
        query: <one of: annotations | call_args | configs | method_decls>
        # Per-query options (see below).
        # Optional file scope: file_filter: routing_imports | all
        # Optional file extension override: file_extensions: [".js", ".ts"]

    emit:
      type: REST              # REST | GraphQL | gRPC | WEB | SOAP
      protocol: HTTP
      framework: <slug>

    conflict_rules: []        # advanced; leave empty for first proposal
    known_pitfalls: [strings] # short notes about edge cases your playbook DOES NOT handle

    -------------------------- query: annotations --------------------------
    Used for decorator/annotation-driven frameworks (Spring, JAX-RS, NestJS, Symfony PHP attributes).
    Fields:
      annotation_names: [list of strings]   # e.g. [GetMapping, PostMapping] or [Get, Post]
      target_kind: method | class           # what the annotation decorates
    The executor knows these mappings already (Spring/JAX-RS/NestJS verbs).

    -------------------------- query: call_args ---------------------------
    Used for facade/router-method-call frameworks (Express, Gin, Slim, Laravel Route::, WordPress register_rest_route).
    Fields:
      callee_pattern:  <regex>      # matches the callee (e.g. "\\.(get|post|put)$")
      path_arg_index:  <int>        # which string-literal arg is the route path (0-based)
      verb:            <string>     # explicit verb, OR
      verb_from:       callee_suffix # extract verb from end of callee
      path_must_match: <regex>      # only emit if the path matches (e.g. "^[/:]")

    -------------------------- query: configs ----------------------------
    Used for routing config files (Rails routes.rb, Django urls.py, Symfony YAML, Drupal *.routing.yml, Strapi routes/*.json).
    Fields:
      parser: <one of: rails_dsl | django_urls | symfony_yaml | drupal_routing_yml | strapi_routes_json>
      file_glob: <glob>     # files to feed into the parser, e.g. "**/config/routes.rb"

    -------------------------- query: method_decls -----------------------
    Used for "method-name-IS-the-route" frameworks (Yii2 actionXxx, Stapler doXxx, MediaWiki Api*::execute).
    Fields:
      name_pattern: <regex>           # match method names, e.g. "^action[A-Z]\\w*$"
      strip_prefix: <string>          # strip this prefix to get the URL path
      verb:         <string>          # default verb (often "ANY")
      path_from:    method_name_strip # current default

    --------------------------------- example -------------------------------
    name: laravel
    version: 1
    language: php
    detection:
      imports_match: [Illuminate\\Routing]
      files_match: [routes/web.php]
      manifest_contains:
        - {file: composer.json, substring: laravel/framework}
    extract:
      - id: route_facade_calls
        query: call_args
        file_filter: all
        callee_pattern: '(Route|::)\\s*::\\s*(get|post|put|delete|patch)$'
        path_arg_index: 0
        verb_from: callee_suffix
        path_must_match: '^[/:]'
    emit: {type: REST, protocol: HTTP, framework: laravel}
    conflict_rules: []
    known_pitfalls:
      - "Route::group prefixes not inlined"
""").strip()


@dataclass
class ProposalResult:
    proposed_yaml_path: str = ""
    playbook: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    error: str = ""


def _build_evidence_pack(project_root: Path) -> str:
    """Tiny snapshot of repo structure: manifest snippets + top-level dirs +
    sample 'routing-looking' filenames. Keeps the LLM prompt small."""
    lines: list[str] = []
    lines.append(f"# Repo evidence for {project_root.name}")
    lines.append("")

    # Top-level directories
    try:
        top = sorted(p.name for p in project_root.iterdir() if p.is_dir())[:25]
        lines.append(f"## Top-level dirs:\n  {', '.join(top)}")
    except OSError:
        pass

    # Manifests
    for manifest in ("composer.json", "package.json", "Gemfile", "go.mod",
                     "pom.xml", "build.gradle", "requirements.txt",
                     "pyproject.toml", "CMakeLists.txt", "manage.py", "artisan"):
        p = project_root / manifest
        if p.exists():
            try:
                snippet = p.read_text(encoding="utf-8", errors="replace")[:1500]
                lines.append(f"\n## Manifest: {manifest}\n```\n{snippet}\n```")
            except OSError:
                pass

    # Routing-looking files
    routing_globs = [
        "**/routes.py", "**/urls.py", "**/routes.rb", "**/routes.php",
        "**/routes/*.json", "**/*.routing.yml", "**/config/routes/**",
        "**/api*.go", "**/web.php", "**/api.php",
    ]
    found = []
    for g in routing_globs:
        for p in project_root.glob(g):
            try:
                rel = p.relative_to(project_root).as_posix()
            except ValueError:
                continue
            found.append(rel)
            if len(found) >= 30:
                break
        if len(found) >= 30:
            break
    if found:
        lines.append("\n## Routing-suspect files:\n  " + "\n  ".join(found))

    return "\n".join(lines)


def _extract_yaml(response: str) -> str:
    """Pull the YAML out of an LLM response. Accept fenced code or a FINAL_ANSWER prefix."""
    fence = re.search(r"```(?:ya?ml)?\n([\s\S]*?)```", response)
    if fence:
        return fence.group(1).strip()
    if "FINAL_ANSWER" in response:
        idx = response.index("FINAL_ANSWER")
        return response[idx:].split("\n", 1)[1].strip() if "\n" in response[idx:] else ""
    return response.strip()


def _validate(pb: dict[str, Any]) -> list[str]:
    """Minimal schema check. Returns list of problems (empty = OK)."""
    problems: list[str] = []
    for required in ("name", "language", "detection", "extract", "emit"):
        if required not in pb:
            problems.append(f"missing top-level key: {required}")
    if "extract" in pb:
        if not isinstance(pb["extract"], list) or not pb["extract"]:
            problems.append("extract: must be a non-empty list of steps")
        else:
            for i, step in enumerate(pb["extract"]):
                if not isinstance(step, dict):
                    problems.append(f"extract[{i}]: not a dict")
                    continue
                if "query" not in step:
                    problems.append(f"extract[{i}]: missing 'query'")
                elif step["query"] not in {"annotations", "call_args", "configs", "method_decls"}:
                    problems.append(f"extract[{i}]: unknown query '{step['query']}'")
    return problems


def propose(project_root: str, llm_client) -> ProposalResult:
    """Have the LLM author a playbook proposal for `project_root`.

    Returns a ProposalResult with either `playbook` populated (and saved to
    playbooks/proposed/<name>.yaml) or `error` set.
    """
    import yaml as _yaml

    out = ProposalResult()
    root = Path(project_root)
    if not root.exists():
        out.error = f"project_root does not exist: {project_root}"
        return out

    evidence = _build_evidence_pack(root)
    out.notes.append(f"evidence pack: {len(evidence)} chars")

    system = (
        "You are a playbook author for an endpoint discovery system. "
        "Given evidence about a codebase, output a YAML playbook in the schema described. "
        "Use ONLY the four query types: annotations | call_args | configs | method_decls. "
        "Do NOT invent new keys. Output ONLY the YAML inside a ```yaml fenced block."
    )
    user = f"{SCHEMA_DOC}\n\n--- evidence ---\n{evidence}\n\n--- task ---\nWrite the YAML playbook for this codebase."

    try:
        response = llm_client.generate(
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
            max_tokens=2000,
        )
    except Exception as e:
        out.error = f"llm_client.generate failed: {type(e).__name__}: {e}"
        return out

    yaml_text = _extract_yaml(response)
    out.notes.append(f"extracted yaml: {len(yaml_text)} chars")
    if not yaml_text:
        out.error = "no YAML in LLM response"
        return out

    try:
        pb = _yaml.safe_load(yaml_text)
    except _yaml.YAMLError as e:
        out.error = f"yaml parse failed: {e}"
        return out
    if not isinstance(pb, dict):
        out.error = f"yaml is not a mapping: {type(pb).__name__}"
        return out

    problems = _validate(pb)
    if problems:
        out.error = "schema validation: " + "; ".join(problems)
        out.playbook = pb  # keep so caller can inspect
        return out

    name = str(pb.get("name", "")).strip().lower().replace(" ", "-")
    if not name or not re.match(r"^[a-z0-9_\-]+$", name):
        out.error = f"invalid playbook name: {name!r}"
        return out

    PROPOSED_DIR.mkdir(parents=True, exist_ok=True)
    target = PROPOSED_DIR / f"{name}.yaml"
    target.write_text(yaml_text + "\n", encoding="utf-8")

    out.playbook = pb
    out.proposed_yaml_path = str(target)
    out.notes.append(f"wrote: {target}")
    return out
