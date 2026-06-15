# Requirements: Agentic Diagram Generation

## Problem

1. Diagrams generate at Step 1 (inside `write_snapshot()`), before endpoints, interactions, and enrichment. They only see ctags data.
2. The existing spec (2026-04-07) proposes fixing this by adding 6 new hard-coded Python builder classes — `APISurfaceBuilder`, `InteractionFlowBuilder`, `BlastRadiusBuilder`, etc. Each reads TSV files and assembles `DiagramModel` through imperative Python.
3. **This violates the core design principle:** AST = mechanical, LLM = interpretation. We just spent weeks moving endpoint detection OUT of hard-coded extractors and INTO the agentic loop. Adding 6 new builder classes is the same anti-pattern.

## Goal

Redesign diagram generation to follow the same agentic pattern as `discover-endpoints` and `discover-interactions`:

1. Move diagram generation to the final pipeline step (same as before — correct)
2. Keep existing 8 mechanical builders unchanged (they do structural work: class diagrams from `_index.txt`, dependency graphs from `_imports.txt` — that's mechanical, not interpretation)
3. Add an **agentic diagram discoverer** that reads the full structural store and produces `DiagramModel` JSON for enrichment-dependent diagrams
4. The LLM decides which diagrams are worth generating based on what data actually exists — a Spring+Kafka app gets different diagrams than a Django+Postgres monolith

## What's Mechanical vs What's Interpretation

### Mechanical (keep as builders):
- Class diagram — group symbols by type from `_index.txt`
- Inheritance tree — read `_inheritance.txt`, draw edges
- Dependency graph — read `_imports.txt`, draw edges
- Component diagram — group imports by directory
- Package structure — group symbols by path
- Pattern map — read `_patterns.txt`
- Sequence overview — trace calls from `_calls.txt`
- Data flow — trace data stores from `_calls.txt` + keywords

These are deterministic transformations on structured data. Same inputs → same outputs. No judgment needed.

### Interpretation (agentic):
- API Surface — which endpoints group together, what controllers matter, what's the public API shape
- Interaction Flow — which services talk to what, what's the architecture, what external systems matter
- Blast Radius — what's critical, what breaks if X goes down, which dependencies are dangerous
- Any diagram that requires understanding *what the codebase does* rather than *what symbols exist*

## Design Constraints

- Same tool set as other discoverers: `read_calls`, `read_index`, `read_imports`, `read_inheritance`, `read_source`
- Plus two new tools: `read_endpoints`, `read_interactions` — expose the enrichment data
- Output: JSON array of `DiagramModel` objects (entities + relationships + diagram_type)
- Serialisers stay mechanical: `DiagramModel` → Mermaid/PlantUML/Graphviz/Metamodel
- Existing 8 builders still run first (mechanical pass)
- Agentic pass runs after, adding enrichment-dependent diagrams
- When no LLM is available: only 8 mechanical diagrams (same as today)
- Haikai skill file defines the strategy (same pattern as discover-endpoints.md)

## What We Gain

- LLM decides what diagrams are useful — doesn't blindly generate all 6 types for every repo
- LLM can produce richer, more contextual diagrams — e.g. annotating edges with data hints, grouping by domain boundaries it infers
- No new Python builder classes to maintain
- Consistent with the core design principle
- Same extensibility pattern — add a new diagram type by updating the skill prompt, not writing Python
