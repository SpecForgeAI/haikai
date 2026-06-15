# OpenAPI canonicalization

**Concept introduced by:** [[../../../haikai/specs/2026-04-25-openapi-discovery]]
**Status:** shipped (commit b19c048, 2026-05-01)

## The principle

> When a project ships an OpenAPI / Swagger spec, **use it**. Don't re-derive what the project has already declared.

The OpenAPI spec is, by construction, what the project says its endpoints are. Re-deriving from source via call-site grepping (`router.get(...)`) is reverse-engineering an answer the project has already published. When the two disagree, the spec wins by default.

## Why this matters empirically

V2's call_args extraction on Kibana produced **2,597** endpoints. Kibana's own `oas_docs/output/kibana.yaml` says **611**. The 4× over-count came from:
- Internal Hapi `router.get()` calls that don't map to public HTTP endpoints
- Test routes registered via `router.post()` in test fixtures
- Generated boilerplate routes that the spec deliberately omits

The spec is not a *subset* of source-derivable routes — it's the *intended* surface. Reverse-engineering inevitably lifts things the project chose to keep internal.

## How it's implemented

- **`src/dep/openapi.py`** — content-sniff detector (regex on the first 2KB), YAML/JSON loader, multi-spec disambiguation (`_pick_canonical`: manifest hint → size → mtime), Swagger 2.0 + OpenAPI 3.x walker.
- **`parse_openapi_spec`** in `src/ast/v2/queries/configs.py` — registered in `PARSERS` dict, pluggable into any playbook's `configs` step via `parser: openapi_spec`.
- **Per-framework playbook integration** — Kibana playbook now declares an `openapi_spec` extract step pointing at `oas_docs/output/kibana.yaml`.
- **`find-openapi-spec` skill** — for repos whose spec lives at non-standard paths; LLM-driven discovery as a fallback.

## Known limitation (deferred)

When both `openapi_spec` AND `call_args` produce endpoints (e.g. Kibana ships a spec AND has `router.get(...)` calls), the merger currently dedupes but does **not** enforce per-step priority. V2 returns 3,207 unique on Kibana (611 from openapi_spec + ~2,596 from call_args fallback). Per-step priority is the next iteration — explicitly deferred in the spec rather than blocked.

## Why "canonicalization" is the right framing

This concept is the inverse of the more common "extract everything, dedupe later" pattern. The spec is treated as **authoritative truth** rather than as one signal among many. Other framework playbooks should follow the same pattern when the framework has a canonical metadata source (e.g. Spring's `springdoc` output, FastAPI's runtime `app.openapi()`, drf-spectacular).

## Relationship to other concepts

- Contrasts with [[../findings/gitnexus-no-routes]] — GitNexus has no route abstraction at all, let alone canonicalization.
- Demonstrates the [[../../../CLAUDE.md#architecture-principle]]: the parser is mechanical (no LLM), but the *decision* to trust it over call-site grepping is a framework-interpretation choice expressible in playbook YAML.

## Sources

- [[../../raw/2026-05-01_commit-batch]]
- [[../../../haikai/specs/2026-04-25-openapi-discovery/spec]]
