# Initialization

**Spec:** 2026-04-07-agentic-endpoint-discovery
**Date:** 2026-04-07
**Source:** Design review with Ozzie — hard-coded AST endpoint detection is anti-agentic

## Raw Idea

The AST extractors currently have ~1784 lines of hard-coded framework-specific endpoint detection (FastAPI decorators, Spring annotations, Express call patterns, Go http handlers, C# attributes) plus interaction detection (HTTP clients, DB access, MQ patterns). This is doing the LLM's job with brittle code — every new framework needs new AST code.

Replace all of it with agentic discovery: the LLM reads the structural store (`_index.txt`, `_calls.txt`, `_imports.txt`, `_inheritance.txt`) and interprets framework conventions to identify endpoints and interactions. Works for any language and any framework the LLM has knowledge of — zero code changes to support new ones.

The `endpoint_discoverer.py` module (209 lines) is already built but not wired into the pipeline. The interaction enricher/classifier already works agentically for target/data_hint resolution. This spec completes the migration so the entire endpoint+interaction discovery flow is agentic.

## Prior Work

- `src/ast/extractors/*.py` — 5 language extractors with `extract_endpoints()` / `extract_interactions()` (to be removed)
- `src/ast/extractors/endpoint_config.py` — YAML config loader (to be deleted)
- `src/ast/endpoint_discoverer.py` — agentic endpoint discovery (built, not wired)
- `src/ast/interaction_classifier.py` — agentic interaction classification (working)
- `src/ast/interaction_enricher.py` — agentic interaction enrichment (working)
- `src/ast/enrichment_tools.py` — shared structural store tools
- `src/ast/pipeline.py` — structural analysis pipeline (integration point)
- `haikai-profiles/default/commands/discover-endpoints/` — skill file (built)
- `haikai-profiles/default/commands/discover-interactions/` — skill file (built)
- `haikai-profiles/default/commands/enrich-interactions/` — skill file (working)
- `config/endpoint_patterns.yaml` — reference data for LLM
- `config/data_movement_patterns.yaml` — reference data for LLM

## Design Decisions

1. **AST layer = mechanical only.** Structural extraction (calls, imports, assignments, annotations). Zero framework knowledge.
2. **LLM layer = framework interpretation.** Reads structural store, identifies endpoints/interactions for any framework/language.
3. **Skill files drive strategy.** Markdown prompts that can be edited without touching Python code.
4. **Same tools for all agentic calls.** `read_calls`, `read_index`, `read_imports`, `read_inheritance`, `read_source`.
5. **Same output models.** `EndpointInfo` and `InteractionInfo` — downstream consumers unchanged.
