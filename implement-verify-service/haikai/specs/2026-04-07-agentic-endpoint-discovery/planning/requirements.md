# Requirements: Agentic Endpoint & Interaction Discovery

## Context

The structural analysis pipeline (`src/ast/pipeline.py`) currently has two contradictory approaches to endpoint/interaction detection:

1. **Hard-coded AST detection** — 5 language extractors with `extract_endpoints()` and `extract_interactions()` methods that pattern-match for specific frameworks (FastAPI, Spring, Express, Go net/http, ASP.NET, etc.). ~1784 lines of framework-specific code.

2. **Agentic enrichment** — LLM with structural store tools that resolves `target` and `data_hint` for interactions via a hypothesis→probe→assess reasoning loop. Already working.

The hard-coded approach is brittle (each new framework = new code), incomplete (missed Django, NestJS), and limited to 5 languages. The agentic approach works for any language and framework. This spec replaces #1 with #2.

### Already Built (not wired)

- `src/ast/endpoint_discoverer.py` (209 lines) — agentic endpoint discovery module
- `src/ast/interaction_discoverer.py` — agentic interaction discovery module  
- `haikai-profiles/default/commands/discover-endpoints/` — LLM skill file
- `haikai-profiles/default/commands/discover-interactions/` — LLM skill file

### Already Working

- `src/ast/interaction_classifier.py` — YAML fast path + LLM classification
- `src/ast/interaction_enricher.py` — agentic target/data_hint resolution
- `src/ast/enrichment_tools.py` — shared structural store tools (read_calls, read_index, read_imports, read_inheritance, read_source)

---

## Goal

Wire the agentic endpoint and interaction discoverers into the pipeline, remove all framework-specific AST code, and validate that agentic discovery matches or exceeds the old approach — for any language and framework.

---

## Functional Requirements

### FR-1: Wire Agentic Endpoint Discovery into Pipeline

**FR-1.1** Call `endpoint_discoverer.discover_endpoints()` in `pipeline.py` after structural extraction (Step 2) completes and the structural store is written.

**FR-1.2** Pass the LLM client (when available), snapshot path, and project root.

**FR-1.3** Store discovered endpoints in `StructuralAnalysis.endpoints` — same field as before.

**FR-1.4** Write results to `_endpoints.txt` via existing `FileStore.write_endpoints()`.

**FR-1.5** When no LLM client is available, skip agentic discovery (endpoints list stays empty — same as current behavior without API keys).

### FR-2: Wire Agentic Interaction Discovery into Pipeline

**FR-2.1** Expand the interaction classification step to use the agentic interaction discoverer for finding interactions, not just classifying pre-extracted ones.

**FR-2.2** The LLM reads the structural store to find ALL external interactions (HTTP, DB, MQ, cache, file I/O, gRPC) — not just classify calls already extracted by AST.

**FR-2.3** Results feed into the existing enrichment step for target/data_hint resolution.

### FR-3: Remove Framework-Specific AST Code

**FR-3.1** Remove `extract_endpoints()` overrides from all language extractors (Python, Java, TypeScript, Go, C#). The base class no-op default stays.

**FR-3.2** Remove `extract_interactions()` overrides from all language extractors.

**FR-3.3** Delete `src/ast/extractors/endpoint_config.py` (YAML config loader — no longer needed for AST).

**FR-3.4** Remove endpoint/interaction extraction calls from `treesitter_provider.py` (already commented out on feature branch).

**FR-3.5** Keep `config/endpoint_patterns.yaml` and `config/data_movement_patterns.yaml` as reference data — the skill files can reference them, and the LLM can optionally read them.

### FR-4: Skill File Refinement

**FR-4.1** Review and refine `discover-endpoints.md` skill file based on real-repo testing. Iterate on the strategy prompt to maximize endpoint detection.

**FR-4.2** Review and refine `discover-interactions.md` skill file similarly.

**FR-4.3** Ensure skill files make no assumptions about specific languages — they should guide the LLM to use its own framework knowledge.

---

## Non-Functional Requirements

### NFR-1: Performance

- Agentic discovery adds LLM latency (~10-30s per repo). This is acceptable for a code analysis tool.
- Batch requests where possible to minimize LLM round trips.
- Run endpoint and interaction discovery in sequence (not parallel) to avoid rate limits.

### NFR-2: Accuracy

- Agentic discovery must find ≥95% of endpoints that AST detection found on the 7 benchmark repos.
- Agentic discovery must find endpoints AST missed (Django urlpatterns, NestJS decorators).
- Test with at least 1 repo in a language outside the original 5 (Ruby, PHP, or Rust).

### NFR-3: Backwards Compatibility

- `EndpointInfo` and `InteractionInfo` models unchanged.
- `_endpoints.txt` and `_interactions.txt` file formats unchanged.
- `FileStore.write_endpoints()` and `FileStore.write_interactions()` unchanged.
- Metamodel population, diagram generation, and standards extraction unchanged.
- API responses from `/api/v1/structural/analyze` unchanged in shape.

### NFR-4: Testability

- Unit tests with mocked LLM (same pattern as `test_interaction_enricher.py`).
- Integration tests from API endpoint: `POST /api/v1/structural/analyze` → verify `_endpoints.txt`.
- Integration tests from CLI: `extract --repo` → verify snapshot files.
- Add structural analysis integration tests to existing `test-harness.ps1`.

### NFR-5: Observability

- Log endpoint/interaction counts at INFO level after agentic discovery.
- Log LLM tool calls at DEBUG level for troubleshooting.
- `_extraction_meta.yaml` should record that endpoints were discovered agentically (not AST).

---

## Out of Scope

- Changing the interaction classification flow (already agentic, working fine).
- Changing the interaction enrichment flow (already agentic, working fine).
- Adding new structural store tools beyond the existing 6.
- Metamodel population or diagram generation changes.
- UI/frontend changes.
