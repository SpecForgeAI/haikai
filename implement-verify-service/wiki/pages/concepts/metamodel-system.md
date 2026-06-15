# Metamodel system

The third operational mode of the [[standards-pipeline]] — fetch an architectural metamodel from an external system rather than extracting it from code. Lives across `src/metamodel_gateway.py`, `src/metamodel_integration.py`, `src/metamodel_llm_analyzer.py`, `src/metamodel_llm_integration.py`, `src/metamodel_parser.py`.

Distinct from V2's metamodel *output* (the JSON serialiser in [[diagram-generation]]) — that produces a metamodel from extraction; this *consumes* one from upstream.

## What's a metamodel here

A structured architectural description of a system: components, relationships, layers, contracts. The project's own metamodel sits in `haikai-profiles/default/standards/global/`-style files. External metamodels come from systems like SpecForge.

The standards pipeline can use one as authoritative input — when a project ships an architectural metamodel, treat it as truth (analogous to [[openapi-canonicalization]] for routes). The decision page for *that* class of decision is implicit; if it grows in importance it deserves its own page.

## The 5 modules

| Module | Role |
|---|---|
| `metamodel_gateway.py` | `MetamodelGateway`: REST fetch from external endpoint; local-file load; persistence |
| `metamodel_parser.py` | Parse raw metamodel JSON into typed records |
| `metamodel_integration.py` | Glue between fetch and the strategies that consume it |
| `metamodel_llm_analyzer.py` | LLM-driven analysis of a metamodel (semantic queries against the structure) |
| `metamodel_llm_integration.py` | Wire the LLM analyzer into the standards pipeline |

## `MetamodelGateway` — the entry point

`metamodel_gateway.py:14-`:

```python
class MetamodelGateway:
    def __init__(self, output_dir: Path): ...
    def get_from_endpoint(self, metamodel_id: str) -> Dict: ...
    def load_from_file(self, file_path: Path) -> Dict: ...
    def persist(self, metamodel: Dict, metamodel_id: str) -> Path: ...
```

Two sources, one persistence target:
1. **REST endpoint** configured via env: `METAMODEL_ENDPOINT_URL`, plus auth via `METAMODEL_API_KEY` (X-API-Key header) or `METAMODEL_AUTH_TOKEN` (Bearer).
2. **Local file** for offline / pre-fetched usage.

Both feed `persist(...)` which writes to `<output_dir>/metamodel/<metamodel_id>.json` for downstream stages.

## CLI entry point

`standards-extractor get-metamodel --metamodel-id <id> --project-dir <dir>` runs `StandardsOrchestrator.fetch_metamodel_only()`, which uses `MetamodelGateway.get_from_endpoint(metamodel_id)` and persists the result. No code analysis runs — this mode is purely a bridge to the upstream metamodel system.

## REST entry point

`GET /api/v1/metamodels/{company}/{project}/{metamodel_id}` returns the persisted metamodel. If not yet persisted, the endpoint fetches and persists first.

## When this mode matters

Operators with an external architecture-management system (SpecForge or similar) want their existing architectural facts to flow into the standards pipeline rather than re-extracting them from code. The metamodel system is the bridge.

For projects without an external system, this mode is unused — V2's [[v2-extraction-pipeline]] + [[agentic-discovery]] generate the architectural facts from code instead.

## What's *not* in this system

- **Metamodel authoring UI.** The expected workflow is: author the metamodel in the upstream system; this codebase consumes it.
- **Two-way sync.** Read-only fetch. Pushing standards-extractor's findings back to the upstream system is a separate (unscoped) integration.
- **The metamodel that V2 *produces*.** That lives at `src/ast/metamodel_serialiser.py` (one of the four [[diagram-generation]] serialisers). Same word, different artifact.

## Cross-references

- [[standards-pipeline]] — the consumer of metamodels alongside extracted standards
- [[strategies]] — `metamodel_strategy.py` is the strategy that consumes metamodel facts
- [[diagram-generation]] — produces a *different* metamodel artifact (V2's JSON output)

## Sources

- `src/metamodel_gateway.py`, `src/metamodel_integration.py`, `src/metamodel_llm_analyzer.py`, `src/metamodel_llm_integration.py`, `src/metamodel_parser.py`
- `src/standards_orchestrator.py` § `fetch_metamodel_only()`
- `docs/ARCHITECTURE.md`
- [[../../raw/2026-05-04_codebase-walk]]
