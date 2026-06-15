# Specification: OpenAPI Discovery (Parser-Only)

## Summary

Many projects ship a definitive route table — an OpenAPI / Swagger spec.
When a repo has one, it is the **gold-standard answer**: machine-generated,
framework-canonical, what the project itself agrees its endpoints are.

V2 today doesn't look for these. We extract from source code via
playbooks. On Kibana that produces 2,597 endpoints; the project's own
`oas_docs/output/kibana.yaml` says **596**.

This spec adds:

1. **Detection + parsing** in `src/dep/openapi.py` — content-sniff finds
   real specs anywhere; loader handles YAML/JSON + Swagger 2.0 + OpenAPI
   3.x; extractor emits one endpoint per (verb, path).
2. **`openapi_spec`** parser registered in `src/ast/v2/queries/configs.py`
   PARSERS — pluggable into any playbook's `query: configs` step.
3. **Generic `openapi.yaml` playbook** — fires on any repo that ships a
   spec at well-known paths, regardless of framework.
4. **Per-framework integration** — Kibana playbook adds an `openapi_spec`
   step pointing at `oas_docs/output/kibana.yaml`.

**No skill, no LLM.** OpenAPI is a structured format with a clear schema —
detection is a top-level-key sniff, validation is content-based,
extraction is a `paths:` walk. None benefits from LLM judgment.

## Core Principle

> When a project ships a canonical API spec, USE IT. Don't re-derive what
> the project has already declared.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  src/dep/openapi.py — generic, language-agnostic                 │
│                                                                  │
│  is_openapi_spec(path)         ← 2 KB content sniff:             │
│                                  matches ^openapi:/^swagger:/    │
│                                  "openapi"/"swagger" version key │
│  find_openapi_specs(root)      ← walk, filter excluded dirs      │
│  _pick_canonical(specs, root)  ← manifest-ref → size → mtime     │
│  load_spec(path)                ← yaml.safe_load OR json.loads   │
│  extract_endpoints_from_spec   ← walk paths × verbs              │
│  get_openapi_spec(root)        ← end-to-end: find→pick→load      │
│  get_openapi_endpoints(root)   ← end-to-end + extract            │
└──────────────────────────────────────────────────────────────────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
 V2 configs parser   Stack             V1 LLM tool
 (parse_openapi_     (openapi.yaml      (get_openapi_spec
   spec)              playbook)          via TOOLS dict)
```

## Components

### 1. `src/dep/openapi.py`

| Function | Returns | Purpose |
|---|---|---|
| `is_openapi_spec(path)` | bool | Cheap detector: extension + path-fragment exclusion + 2 KB sniff |
| `find_openapi_specs(root)` | `list[Path]` | Walk repo, filter |
| `_pick_canonical(specs, root)` | `Path \| None` | Disambiguate when multiple |
| `load_spec(path)` | `dict \| None` | Parse YAML or JSON |
| `extract_endpoints_from_spec(spec)` | `list[dict]` | Walk paths × verbs |
| `get_openapi_spec(root)` | `dict \| None` | end-to-end loader |
| `get_openapi_endpoints(root)` | `list[dict]` | end-to-end extractor |

Detection regex (the only "intelligence" in the system):
```
"openapi"\s*:\s*"[34]    ← OpenAPI 3.x JSON
"swagger"\s*:\s*"2       ← Swagger 2.0 JSON
openapi:\s*['"]?[34]     ← OpenAPI 3.x YAML
swagger:\s*['"]?2        ← Swagger 2.0 YAML
```

Excluded path fragments: `examples/`, `fixtures/`, `tests/`,
`__tests__/`, `node_modules/`, `vendor/`, `dist/`, `build/`, `target/`.

### 2. `parse_openapi_spec` in `src/ast/v2/queries/configs.py`

Generic configs parser. Wraps `src.dep.openapi`:
```python
def parse_openapi_spec(file_path: Path, source: str) -> list[RouteEntry]:
    if not is_openapi_spec(file_path): return []
    spec = load_spec(file_path)
    if not spec: return []
    return [RouteEntry(...) for ep in extract_endpoints_from_spec(spec)]
```

Registered in `PARSERS` dict. Allowed in playbook YAML via
`parser: openapi_spec`.

### 3. Generic `openapi.yaml` framework playbook

Fires when a repo has a spec at well-known paths regardless of framework:
- `oas_docs/output/*.yaml`
- `openapi/openapi.{yaml,json}`
- `openapi.{yaml,json}` (root)
- `swagger.{yaml,json}` (root)
- `docs/api/openapi.{yaml,json}`
- `api/openapi.{yaml,json}`

Multiple `extract` steps cover each location; each step calls
`parse_openapi_spec`. Detector internally validates so non-spec YAML
files at these paths are silently dropped.

### 4. Per-framework integration

Frameworks whose ecosystem typically ships OpenAPI add an explicit
`openapi_spec` step pointing at the framework-specific path:

```yaml
# kibana.yaml
extract:
  - id: openapi_spec
    query: configs
    parser: openapi_spec
    file_glob: 'oas_docs/output/kibana.yaml'
```

Tighter glob beats the generic playbook's broad ones.

## How they cooperate

```
discover()  →  detection: openapi playbook (this spec)
                          + framework playbooks (kibana, etc.)
            →  for each detected playbook, run extract steps
            →  parse_openapi_spec runs on matched files
            →  merger dedupes by (verb, path, handler)
```

When both `openapi_spec` AND `call_args` produce endpoints (e.g. Kibana
has both an OpenAPI spec AND `router.get(...)` calls), the merger
defaults to deduping. We can later add per-step priority so
openapi-sourced endpoints win on tie — deferred until proven necessary.

## Constraints

- **No engine knobs.** Parser is generic; detection rules are
  content-based; framework-specific globs live in playbook YAML.
- **No LLM.** OpenAPI is a structured format — every step is mechanical.
- **Detection must be content-based, not just path-based.** Path
  exclusions are filters, not detectors.
- **Parser tolerant of partial specs.** Missing `info:` block is fine;
  only `paths:` is required for endpoint extraction.

## Outputs

| Artifact | Lives in | Status |
|---|---|---|
| Detector + loader + extractor | `src/dep/openapi.py` | new |
| `parse_openapi_spec` | `src/ast/v2/queries/configs.py` | new |
| Schema entry for `parser: openapi_spec` | `src/ast/v2/playbook_schema.py` | implicit (parser field is `Optional[str]`) |
| Generic playbook | `playbooks/frameworks/openapi.yaml` | new |
| Kibana per-framework integration | `playbooks/frameworks/kibana.yaml` | edit |

## Out of scope

- Generating OpenAPI specs from source (springdoc, drf-spectacular,
  fastapi.openapi() at runtime). Runtime artifact, separate problem.
- WADL, RAML, gRPC reflection, GraphQL introspection. Future work.
- Skill / LLM-driven spec discovery. Removed from this iteration —
  detection is content-sniffable and doesn't need LLM judgment.

## Success criteria

1. **Kibana**: `openapi_spec` extracts all **611 endpoints** from
   `oas_docs/output/kibana.yaml` (100% recall against project-declared
   truth; spec evolved from 596 since this work began). When `call_args`
   also runs as fallback, the merger dedupes but does not yet enforce
   per-step priority — V2 currently returns 3,207 unique on Kibana
   (611 from openapi_spec + ~2,596 from `router.get(...)` style calls
   on Hapi). Per-step priority is the next iteration.
2. **No regression**: petclinic 17/17, redmine ~409, drupal ~845, jenkins ~315.
3. **Generic detection**: a repo with `openapi.yaml` at root and no
   playbook gets endpoints extracted via the generic openapi playbook.
4. **Multi-spec disambiguation**: `_pick_canonical` chooses
   `kibana.yaml` over `kibana.serverless.yaml` (manifest hint + size).
